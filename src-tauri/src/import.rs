// Import wizard, this machine's side: find Claude Code conversations and hand their bytes to the app, which uploads
// them to the user's server (docs: monolith docs/claude-import.md). Read-only, and only ever these places:
// - every Claude Code config folder's `projects` (~/.claude, and ~/.claude-* made with CLAUDE_CONFIG_DIR);
// - a Monolith laptop archive (~/.monolith/archive), from the older importer;
// - the desktop app's session indexes (%APPDATA%\Claude, %LOCALAPPDATA%\ClaudeProfiles\*), for titles only.
// A conversation is <folder>/<uuid>.jsonl plus everything under <folder>/<uuid>/ (subagent threads, tool results).
// The app can read a file only if the latest scan found it as part of a conversation.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{Emitter, State};

#[derive(Default)]
pub struct Scanned(Mutex<HashMap<String, (PathBuf, Vec<(String, u64)>)>>);

fn home() -> PathBuf {
    if let Ok(h) = std::env::var("HEARTH_IMPORT_HOME") { return PathBuf::from(h); }
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}
fn sha_hex(s: &str) -> String { Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect() }
fn fwd(p: &Path) -> String { p.to_string_lossy().replace('\\', "/") }
/// A folder's real path (a moved repo reached through a junction or link counts as where it is now).
fn real(p: &Path) -> String { fs::canonicalize(p).map(|c| fwd(&c).trim_start_matches("//?/").to_string()).unwrap_or_else(|_| fwd(p)) }

#[derive(Serialize, Clone)]
pub struct Source { path: String, label: String, kind: &'static str, conversations: usize, account: Option<String> }

/// Projects folders: (path, kind). Archive roots are expanded to their per-conversation `files` folders.
fn projects_roots(src: &str) -> Vec<PathBuf> {
    let p = PathBuf::from(src);
    if p.file_name().map(|n| n == "archive").unwrap_or(false) {
        let mut out = vec![];
        for c in fs::read_dir(&p).into_iter().flatten().flatten() {
            for u in fs::read_dir(c.path()).into_iter().flatten().flatten() {
                let f = u.path().join("files");
                if f.is_dir() { out.push(f); }
            }
        }
        return out;
    }
    vec![p]
}

fn count_mains(root: &Path) -> usize {
    let mut n = 0;
    for d in fs::read_dir(root).into_iter().flatten().flatten() {
        if d.path().is_dir() {
            n += fs::read_dir(d.path()).into_iter().flatten().flatten()
                .filter(|f| f.path().extension().map(|e| e == "jsonl").unwrap_or(false) && f.path().is_file()).count();
        }
    }
    n
}

/// Places on this machine that hold Claude Code conversations, with how many each has.
pub fn sources() -> Vec<Source> {
    let h = home();
    let mut out = vec![];
    let mut cfgs: Vec<PathBuf> = vec![h.join(".claude")];
    let mut extra: Vec<PathBuf> = fs::read_dir(&h).into_iter().flatten().flatten()
        .filter(|d| d.file_name().to_string_lossy().starts_with(".claude-") && d.path().is_dir()).map(|d| d.path()).collect();
    extra.sort();
    cfgs.extend(extra);
    for c in cfgs {
        let p = c.join("projects");
        if !p.is_dir() { continue; }
        let n = count_mains(&p);
        if n == 0 { continue; }
        let name = c.file_name().unwrap().to_string_lossy().to_string();
        let account = name.strip_prefix(".claude-").map(|s| s.to_string());
        out.push(Source { path: fwd(&p), label: format!("Claude Code ({})", if account.is_some() { format!("~/{name}") } else { "~/.claude".into() }), kind: "claude-code", conversations: n, account });
    }
    let arch = h.join(".monolith").join("archive");
    if arch.is_dir() {
        let n: usize = projects_roots(&fwd(&arch)).iter().map(|r| count_mains(r)).sum();
        if n > 0 { out.push(Source { path: fwd(&arch), label: "Monolith laptop archive (older import)".into(), kind: "archive", conversations: n, account: None }); }
    }
    out
}

/// Desktop app session index: transcript id -> title. Titles only; nothing else is read.
fn titles() -> HashMap<String, String> {
    let mut m = HashMap::new();
    let mut dirs: Vec<PathBuf> = vec![];
    if let Ok(a) = std::env::var("APPDATA") { dirs.push(PathBuf::from(a).join("Claude").join("claude-code-sessions")); }
    if let Ok(l) = std::env::var("LOCALAPPDATA") {
        for p in fs::read_dir(PathBuf::from(l).join("ClaudeProfiles")).into_iter().flatten().flatten() { dirs.push(p.path().join("claude-code-sessions")); }
    }
    if let Ok(x) = std::env::var("HEARTH_IMPORT_INDEX") { dirs = std::env::split_paths(&x).collect(); }
    fn visit(d: &Path, depth: u32, m: &mut HashMap<String, String>) {
        for e in fs::read_dir(d).into_iter().flatten().flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if p.is_dir() && depth < 4 { visit(&p, depth + 1, m); }
            else if name.starts_with("local_") && name.ends_with(".json") {
                if let Ok(t) = fs::read_to_string(&p) {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                        if let (Some(id), Some(title)) = (v["cliSessionId"].as_str(), v["title"].as_str()) {
                            let t = title.trim();
                            if !t.is_empty() { m.insert(id.to_string(), t.chars().take(200).collect()); }
                        }
                    }
                }
            }
        }
    }
    for d in dirs { visit(&d, 0, &mut m); }
    m
}

#[derive(Serialize, Clone)]
pub struct FileOut { rel: String, size: u64 }
#[derive(Serialize, Clone)]
pub struct Unit {
    id: String, folder: String, uuid: String, source: &'static str, fingerprint: String,
    cwd: Option<String>, repo: Option<String>, title: String, started: Option<String>, ended: Option<String>,
    messages: u64, threads: u64, bytes: u64, files: Vec<FileOut>, from: String,
    /// The projects folder it was found in (for the app's own display; never sent to the server).
    root: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOut { home: String, units: Vec<Unit>, other_files: u64, titles: usize }

fn walk(dir: &Path, base: &Path, out: &mut Vec<(String, u64, u128)>) {
    for e in fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = e.path();
        let Ok(md) = e.metadata() else { continue };
        if md.is_dir() { walk(&p, base, out); }
        else if md.is_file() {
            let rel = fwd(p.strip_prefix(base).unwrap_or(&p));
            let mt = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
            out.push((rel, md.len(), mt));
        }
    }
}

struct Facts { cwd: Option<String>, started: Option<String>, ended: Option<String>, messages: u64, custom: Option<String>, ai: Option<String>, first_user: Option<String> }

fn facts(file: &Path) -> Facts {
    let mut f = Facts { cwd: None, started: None, ended: None, messages: 0, custom: None, ai: None, first_user: None };
    let Ok(h) = fs::File::open(file) else { return f };
    let mut r = BufReader::with_capacity(1 << 20, h);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match r.read_until(b'\n', &mut buf) { Ok(0) | Err(_) => break, _ => {} }
        // Huge records are tool output; the facts never live there.
        if buf.len() > 512 * 1024 { continue; }
        let Ok(v) = serde_json::from_slice::<serde_json::Value>(&buf) else { continue };
        if f.cwd.is_none() { if let Some(c) = v["cwd"].as_str() { f.cwd = Some(c.to_string()); } }
        if let Some(t) = v["timestamp"].as_str() { if f.started.is_none() { f.started = Some(t.to_string()); } f.ended = Some(t.to_string()); }
        let ty = v["type"].as_str().unwrap_or("");
        if ty == "custom-title" { if let Some(t) = v["customTitle"].as_str() { f.custom = Some(t.to_string()); } }
        if ty == "ai-title" { if let Some(t) = v["aiTitle"].as_str().or(v["title"].as_str()) { f.ai = Some(t.to_string()); } }
        if (ty == "user" || ty == "assistant") && !v["isMeta"].as_bool().unwrap_or(false) && !v["isSidechain"].as_bool().unwrap_or(false) {
            let c = &v["message"]["content"];
            let text = if let Some(s) = c.as_str() { s.to_string() } else if let Some(a) = c.as_array() {
                a.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("\n")
            } else { String::new() };
            let t = text.trim();
            if !t.is_empty() {
                f.messages += 1;
                if ty == "user" && f.first_user.is_none() && !t.starts_with("<command") && !t.starts_with("<local-command") && !t.starts_with("<system") {
                    f.first_user = Some(t.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect());
                }
            }
        }
    }
    f
}

/// The repo a working folder belongs to: walk up to the folder holding `.git` (a worktree's `.git` file points back
/// to its main repo). None if the folder is gone or isn't in a repo.
fn repo_of(cwd: &str, home: &Path, cache: &mut HashMap<String, Option<String>>) -> Option<String> {
    if let Some(r) = cache.get(cwd) { return r.clone(); }
    let mut found = None;
    let mut p = PathBuf::from(cwd);
    while p.exists() {
        if p == home { break; }
        let g = p.join(".git");
        if g.is_dir() { found = Some(real(&p)); break; }
        if g.is_file() {
            // "gitdir: C:/x/repo/.git/worktrees/name"
            found = fs::read_to_string(&g).ok().and_then(|t| t.trim().strip_prefix("gitdir:").map(|s| s.trim().replace('\\', "/")))
                .and_then(|s| s.find("/.git/").map(|i| real(Path::new(&s[..i])))).or(Some(real(&p)));
            break;
        }
        if !p.pop() { break; }
    }
    cache.insert(cwd.to_string(), found.clone());
    found
}

/// Every conversation in the given sources (which must be ones `sources()` lists). Emits "import-scan" progress.
pub fn scan(progress: &dyn Fn(usize, usize), paths: &[String], st: &Scanned) -> Result<ScanOut, String> {
    let allowed: Vec<String> = sources().into_iter().map(|s| s.path).collect();
    for p in paths { if !allowed.contains(p) { return Err(format!("not a Claude folder this app found: {p}")); } }
    let h = home();
    let index = titles();
    let mut repo_cache = HashMap::new();
    let mut units: HashMap<String, Unit> = HashMap::new();
    let mut reg: HashMap<String, (PathBuf, Vec<(String, u64)>)> = HashMap::new();
    let mut other = 0u64;
    let roots: Vec<(String, PathBuf)> = paths.iter().flat_map(|s| projects_roots(s).into_iter().map(move |r| (s.clone(), r))).collect();
    // Count first, for progress.
    let total: usize = roots.iter().map(|(_, r)| count_mains(r)).sum();
    let mut done = 0usize;
    for (from, root) in roots {
        let mut folders: Vec<PathBuf> = fs::read_dir(&root).into_iter().flatten().flatten().map(|d| d.path()).filter(|p| p.is_dir()).collect();
        folders.sort();
        for fdir in folders {
            let folder = fdir.file_name().unwrap().to_string_lossy().to_string();
            let mut all = vec![];
            walk(&fdir, &root, &mut all);
            let mains: Vec<_> = all.iter().filter(|(rel, _, _)| rel.matches('/').count() == 1 && rel.ends_with(".jsonl")).cloned().collect();
            let mut claimed = std::collections::HashSet::new();
            for (mrel, _, _) in &mains {
                let uuid = mrel.rsplit('/').next().unwrap().trim_end_matches(".jsonl").to_string();
                let prefix = format!("{folder}/{uuid}/");
                let mut files: Vec<(String, u64, u128)> = all.iter().filter(|(r, _, _)| r == mrel || r.starts_with(&prefix)).cloned().collect();
                files.sort_by(|a, b| (a.0 != *mrel).cmp(&(b.0 != *mrel)).then(a.0.cmp(&b.0))); // main thread first
                for f in &files { claimed.insert(f.0.clone()); }
                let mut fp: Vec<String> = files.iter().map(|(r, s, m)| format!("{r}:{s}:{m}")).collect();
                fp.sort();
                let id = sha_hex(&format!("{folder}/{uuid}"))[..24].to_string();
                let bytes: u64 = files.iter().map(|f| f.1).sum();
                done += 1;
                if done % 25 == 0 { progress(done, total); }
                // The same conversation in two places (e.g. the archive and ~/.claude): keep the larger copy.
                if let Some(had) = units.get(&id) { if had.bytes >= bytes { continue; } }
                let f = facts(&root.join(mrel));
                let title = index.get(&uuid).cloned().or(f.custom.clone()).or(f.ai.clone()).or(f.first_user.clone()).unwrap_or_else(|| "Untitled conversation".into());
                let repo = f.cwd.as_deref().and_then(|c| repo_of(&c.replace('\\', "/").split("/.claude/worktrees/").next().unwrap_or(c).to_string(), &h, &mut repo_cache));
                let threads = files.iter().filter(|(r, _, _)| r.contains("/subagents/") && r.ends_with(".jsonl")).count() as u64;
                units.insert(id.clone(), Unit {
                    id: id.clone(), folder: folder.clone(), uuid: uuid.clone(), source: "claude-code", fingerprint: sha_hex(&fp.join("\n"))[..32].to_string(),
                    cwd: f.cwd, repo, title, started: f.started, ended: f.ended, messages: f.messages, threads, bytes,
                    files: files.iter().map(|(r, s, _)| FileOut { rel: r.clone(), size: *s }).collect(), from: from.clone(), root: fwd(&root),
                });
                reg.insert(id, (root.clone(), files.iter().map(|(r, s, _)| (r.clone(), *s)).collect()));
            }
            other += all.iter().filter(|(r, _, _)| !claimed.contains(r)).count() as u64;
        }
    }
    progress(total, total);
    *st.0.lock().unwrap() = reg;
    let mut list: Vec<Unit> = units.into_values().collect();
    list.sort_by(|a, b| b.ended.cmp(&a.ended));
    Ok(ScanOut { home: fwd(&h), units: list, other_files: other, titles: index.len() })
}

/// Bytes [offset, offset+length) of one file of a scanned conversation (at most 8 MB).
pub fn read(id: &str, rel: &str, offset: u64, length: u64, st: &Scanned) -> Result<Vec<u8>, String> {
    let g = st.0.lock().unwrap();
    let (root, files) = g.get(id).ok_or("not a conversation from the latest scan; scan again")?;
    let (_, size) = files.iter().find(|(r, _)| r == rel).ok_or("no such file in that conversation")?;
    let len = length.min(8 << 20).min(size.saturating_sub(offset));
    let mut f = fs::File::open(root.join(rel)).map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; len as usize];
    let mut got = 0;
    while got < buf.len() { match f.read(&mut buf[got..]) { Ok(0) => break, Ok(n) => got += n, Err(e) => return Err(e.to_string()) } }
    buf.truncate(got);
    Ok(buf)
}

#[tauri::command]
pub fn import_sources() -> Vec<Source> { sources() }

#[tauri::command]
pub async fn import_scan(app: tauri::AppHandle, paths: Vec<String>, state: State<'_, Scanned>) -> Result<ScanOut, String> {
    // Off the main thread: a big history takes a while to read.
    let st = Scanned::default();
    let app2 = app.clone();
    let (out, reg) = tauri::async_runtime::spawn_blocking(move || { let r = scan(&|d, t| { let _ = app2.emit("import-scan", (d, t)); }, &paths, &st); (r, st) }).await.map_err(|e| e.to_string())?;
    let reg = reg.0.into_inner().unwrap();
    *state.0.lock().unwrap() = reg;
    out
}

#[tauri::command]
pub fn import_read(id: String, rel: String, offset: u64, length: u64, state: State<'_, Scanned>) -> Result<tauri::ipc::Response, String> {
    read(&id, &rel, offset, length, &state).map(tauri::ipc::Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;
    // A fixture home: a repo with a worktree, a conversation in each, a subagent thread, a memory file, an archive copy.
    #[test]
    fn fixture_scan() {
        let base = std::env::temp_dir().join(format!("hearth-import-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let home = base.join("home");
        let repo = base.join("repo");
        let wt = base.join("wt");
        fs::create_dir_all(repo.join(".git").join("worktrees").join("wt")).unwrap();
        fs::create_dir_all(repo.join("sub")).unwrap();
        fs::create_dir_all(&wt).unwrap();
        fs::write(wt.join(".git"), format!("gitdir: {}/.git/worktrees/wt", fwd(&repo))).unwrap();
        let line = |cwd: &Path, t: &str, ty: &str| format!("{{\"type\":\"{ty}\",\"cwd\":{},\"timestamp\":\"2026-10-01T09:00:00Z\",\"message\":{{\"role\":\"{ty}\",\"content\":\"{t}\"}}}}
", serde_json::to_string(&fwd(cwd)).unwrap());
        let proj = home.join(".claude").join("projects");
        let f1 = proj.join("repo-sub");
        fs::create_dir_all(f1.join("u1").join("subagents")).unwrap();
        fs::write(f1.join("u1.jsonl"), line(&repo.join("sub"), "hello", "user") + &line(&repo, "hi", "assistant")).unwrap();
        fs::write(f1.join("u1").join("subagents").join("a.jsonl"), line(&repo, "sub", "user")).unwrap();
        fs::create_dir_all(f1.join("memory")).unwrap();
        fs::write(f1.join("memory").join("note.md"), "not a conversation").unwrap();
        let f2 = home.join(".claude-work").join("projects").join("wt");
        fs::create_dir_all(&f2).unwrap();
        fs::write(f2.join("u2.jsonl"), line(&wt, "in the worktree", "user")).unwrap();
        // The same conversation as u1 in an archive, smaller: the original wins.
        let a = home.join(".monolith").join("archive").join("acme").join("x").join("files").join("repo-sub");
        fs::create_dir_all(&a).unwrap();
        fs::write(a.join("u1.jsonl"), "{}
").unwrap();
        std::env::set_var("HEARTH_IMPORT_HOME", &home);
        std::env::set_var("HEARTH_IMPORT_INDEX", base.join("none"));
        let src = sources();
        assert_eq!(src.len(), 3, "{:?}", src.iter().map(|s| &s.label).collect::<Vec<_>>());
        let st = Scanned::default();
        let out = scan(&|_, _| {}, &src.iter().map(|s| s.path.clone()).collect::<Vec<_>>(), &st).unwrap();
        assert_eq!(out.units.len(), 2);
        let u1 = out.units.iter().find(|u| u.uuid == "u1").unwrap();
        let u2 = out.units.iter().find(|u| u.uuid == "u2").unwrap();
        let real_repo = real(&repo);
        assert_eq!(u1.repo.as_deref(), Some(real_repo.as_str()), "subfolder of a repo -> the repo");
        assert_eq!(u2.repo.as_deref(), Some(real_repo.as_str()), "a worktree -> its main repo");
        assert_eq!(u1.files.len(), 2);
        assert_eq!(u1.files[0].rel, "repo-sub/u1.jsonl");
        assert_eq!(u1.threads, 1);
        assert_eq!(u1.title, "hello");
        assert_eq!(u1.id, sha_hex("repo-sub/u1")[..24].to_string());
        assert_eq!(out.other_files, 1);
        assert!(u1.bytes > 3, "the bigger copy wins over the archive one");
        assert_eq!(read(&u1.id, "repo-sub/u1.jsonl", 0, 5, &st).unwrap(), b"{\"typ".to_vec());
        assert!(read(&u1.id, "repo-sub/memory/note.md", 0, 5, &st).is_err(), "only a conversation's own files");
        assert!(scan(&|_, _| {}, &[fwd(&base)], &Scanned::default()).is_err(), "only folders sources() lists");
        let _ = fs::remove_dir_all(&base);
    }

    // Real data on the developer machine: HEARTH_IMPORT_REAL=1 cargo test real_scan -- --nocapture
    #[test]
    fn real_scan() {
        if std::env::var("HEARTH_IMPORT_REAL").is_err() { return; }
        let src = sources();
        for s in &src { println!("source {} {} {}", s.label, s.path, s.conversations); }
        let st = Scanned::default();
        let t = std::time::Instant::now();
        let out = scan(&|_, _| {}, &src.iter().map(|s| s.path.clone()).collect::<Vec<_>>(), &st).unwrap();
        println!("units {} other {} titles {} in {:?}", out.units.len(), out.other_files, out.titles, t.elapsed());
        if let Ok(f) = std::env::var("HEARTH_IMPORT_DUMP") { fs::write(f, serde_json::to_string(&out).unwrap()).unwrap(); }
        let mut by: std::collections::BTreeMap<String, usize> = Default::default();
        for u in &out.units { *by.entry(u.repo.clone().unwrap_or_else(|| format!("(cwd) {}", u.cwd.clone().unwrap_or_default()))).or_default() += 1; }
        for (k, v) in by { println!("{v:5}  {k}"); }
        let u = &out.units[0];
        let b = read(&u.id, &u.files[0].rel, 0, 64, &st).unwrap();
        assert!(!b.is_empty());
        assert!(read(&u.id, "../../etc/passwd", 0, 10, &st).is_err());
    }
}
