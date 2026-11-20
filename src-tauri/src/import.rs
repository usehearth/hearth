// "Bring everything from Claude", this machine's side (docs/import.md): find every Claude Code home on this computer,
// say whose it is in the person's terms, and hand the app what each holds: conversations (uploaded to the person's
// server), and skills, subagents, slash commands, output styles and plugins (sent as extensions once the app has
// checked them for secrets). Read-only, and only ever these places:
// - every Claude Code home: ~/.claude, ~/.claude-* (made with CLAUDE_CONFIG_DIR), and $CLAUDE_CONFIG_DIR itself;
//   its `projects` (conversations), `skills`, `agents`, `commands`, `output-styles` and the plugins it lists as
//   installed. Its .claude.json for the account's email and organisation only (never a token);
// - the desktop app's session indexes (%APPDATA%\Claude, %LOCALAPPDATA%\ClaudeProfiles\*), for which profile each
//   session belongs to, its title and when it was last used. Nothing else in a profile is read;
// - a project folder's own `.claude/{skills,agents,commands,output-styles}`, only for folders the latest scan found
//   conversations in;
// - a Monolith laptop archive (~/.monolith/archive), from the older importer.
// A conversation is <folder>/<uuid>.jsonl plus everything under <folder>/<uuid>/ (subagent threads, tool results).
// The app can read a file only if the latest scan found it as part of a conversation.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{Emitter, State};

#[derive(Default)]
pub struct Scanned(Mutex<ScanState>);
#[derive(Default)]
pub struct ScanState {
    /// Each conversation's copies: the source it was found in, its folder and its files. The first is the largest.
    files: HashMap<String, Vec<(String, PathBuf, Vec<(String, u64)>)>>,
    /// Project folders (repos) the latest scan found conversations in: the only ones whose .claude folder may be read.
    repos: HashSet<String>,
}

fn home() -> PathBuf {
    if let Ok(h) = std::env::var("HEARTH_IMPORT_HOME") { return PathBuf::from(h); }
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}
fn sha_hex(s: &str) -> String { Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect() }
fn fwd(p: &Path) -> String { p.to_string_lossy().replace('\\', "/") }
/// A folder's real path (a moved repo reached through a junction or link counts as where it is now).
fn real(p: &Path) -> String { fs::canonicalize(p).map(|c| fwd(&c).trim_start_matches("//?/").to_string()).unwrap_or_else(|_| fwd(p)) }
fn mtime_ms(p: &Path) -> u64 { fs::metadata(p).ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0) }
/// The names Hearth accepts for a conversation's folder and id (the server checks the same).
fn ok_folder(s: &str) -> bool { !s.is_empty() && s.len() <= 255 && s != "." && s != ".." && !s.contains('/') && !s.contains('\\') }
fn ok_uuid(s: &str) -> bool { !s.is_empty() && s.len() <= 80 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') }

// ---------- the desktop app's profiles ----------

/// Profile folders of the Claude desktop app: (name, folder). The main one is %APPDATA%\Claude ("Main").
/// HEARTH_IMPORT_PROFILES (tests): a folder whose subfolders are the profiles.
fn profile_roots() -> Vec<(String, PathBuf)> {
    let mut out = vec![];
    if let Ok(x) = std::env::var("HEARTH_IMPORT_PROFILES") {
        let mut l: Vec<_> = fs::read_dir(x).into_iter().flatten().flatten().filter(|d| d.path().is_dir()).map(|d| (d.file_name().to_string_lossy().to_string(), d.path())).collect();
        l.sort();
        return l;
    }
    if let Ok(a) = std::env::var("APPDATA") { out.push(("Main".to_string(), PathBuf::from(a).join("Claude"))); }
    if let Ok(l) = std::env::var("LOCALAPPDATA") {
        let mut l: Vec<_> = fs::read_dir(PathBuf::from(l).join("ClaudeProfiles")).into_iter().flatten().flatten().filter(|d| d.path().is_dir())
            .map(|d| (d.file_name().to_string_lossy().to_string(), d.path())).collect();
        l.sort();
        out.extend(l);
    }
    out
}

#[derive(Clone)]
struct Session { profile: String, title: Option<String> }

/// Desktop app session index: transcript id -> profile and title. Nothing else is read.
fn sessions() -> HashMap<String, Session> {
    let mut m = HashMap::new();
    fn visit(d: &Path, depth: u32, profile: &str, m: &mut HashMap<String, Session>) {
        for e in fs::read_dir(d).into_iter().flatten().flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if p.is_dir() && depth < 4 { visit(&p, depth + 1, profile, m); }
            else if name.starts_with("local_") && name.ends_with(".json") {
                let Ok(t) = fs::read_to_string(&p) else { continue };
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) else { continue };
                let Some(id) = v["cliSessionId"].as_str() else { continue };
                let title = v["title"].as_str().map(|t| t.trim().chars().take(200).collect::<String>()).filter(|t| !t.is_empty());
                m.insert(id.to_string(), Session { profile: profile.to_string(), title });
            }
        }
    }
    for (name, root) in profile_roots() { visit(&root.join("claude-code-sessions"), 0, &name, &mut m); }
    m
}

// ---------- homes ----------

#[derive(Serialize, Clone)]
pub struct ProfileUse { name: String, sessions: usize }

/// One place on this computer that holds Claude things, with what it holds and whose it is.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    /// The conversations folder (`<home>/projects`, or the archive): the id the app scans by.
    path: String,
    label: String, kind: &'static str, conversations: usize,
    /// The part after ".claude-" for homes made with CLAUDE_CONFIG_DIR ("work" for ~/.claude-work).
    account: Option<String>,
    /// The home itself (~/.claude), in the person's own form (~ for their home folder).
    home: String, home_path: String,
    /// The account signed in there (from its .claude.json): email and organisation.
    email: Option<String>, org: Option<String>,
    /// Desktop app profiles whose Code sessions are kept here, and how many sessions each.
    profiles: Vec<ProfileUse>,
    /// Sessions no desktop profile lists (started in a terminal, or from an older app).
    terminal: usize,
    /// When it was last used: the newest conversation (milliseconds since 1970).
    last_used: Option<u64>,
    /// Working folders it has conversations from.
    folders: usize,
    skills: usize, agents: usize, commands: usize, output_styles: usize, plugins: usize,
}

/// Every Claude Code home: ~/.claude, then ~/.claude-*, then $CLAUDE_CONFIG_DIR if it is somewhere else.
fn homes() -> Vec<PathBuf> {
    let h = home();
    let mut out: Vec<PathBuf> = vec![h.join(".claude")];
    let mut extra: Vec<PathBuf> = fs::read_dir(&h).into_iter().flatten().flatten()
        .filter(|d| d.file_name().to_string_lossy().starts_with(".claude-") && d.path().is_dir()).map(|d| d.path()).collect();
    extra.sort();
    out.extend(extra);
    if std::env::var("HEARTH_IMPORT_HOME").is_err() {
        if let Ok(c) = std::env::var("CLAUDE_CONFIG_DIR") {
            let c = PathBuf::from(c);
            if c.is_dir() && !out.iter().any(|o| real(o) == real(&c)) { out.push(c); }
        }
    }
    out
}

/// The account a home is signed in with: email and organisation from its .claude.json (~/.claude.json for ~/.claude).
fn account_of(home_dir: &Path) -> (Option<String>, Option<String>) {
    let f = if home_dir == home().join(".claude") { home().join(".claude.json") } else { home_dir.join(".claude.json") };
    let Ok(t) = fs::read_to_string(f) else { return (None, None) };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) else { return (None, None) };
    let o = &v["oauthAccount"];
    (o["emailAddress"].as_str().map(String::from), o["organizationName"].as_str().map(String::from).filter(|s| !s.is_empty()))
}

/// The transcripts directly in a projects folder: (folder name, file stem, path).
fn mains(root: &Path) -> Vec<(String, String, PathBuf)> {
    let mut out = vec![];
    for d in fs::read_dir(root).into_iter().flatten().flatten() {
        if !d.path().is_dir() { continue; }
        let folder = d.file_name().to_string_lossy().to_string();
        for f in fs::read_dir(d.path()).into_iter().flatten().flatten() {
            let p = f.path();
            if p.extension().map(|e| e == "jsonl").unwrap_or(false) && p.is_file() {
                out.push((folder.clone(), p.file_stem().unwrap().to_string_lossy().to_string(), p));
            }
        }
    }
    out
}
fn count_mains(root: &Path) -> usize { mains(root).len() }

/// Projects folders: archive roots are expanded to their per-conversation `files` folders.
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

fn md_count(d: &Path, deep: bool) -> usize {
    let mut n = 0;
    for e in fs::read_dir(d).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_dir() && deep { n += md_count(&p, true); }
        else if p.extension().map(|x| x == "md").unwrap_or(false) { n += 1; }
    }
    n
}
/// Skills in a home: skills/<name>/SKILL.md, and (listed as not loadable where they are) one folder down and loose .md files.
fn skill_count(d: &Path) -> usize {
    let mut n = 0;
    for e in fs::read_dir(d).into_iter().flatten().flatten() {
        if e.file_name().to_string_lossy().starts_with('.') { continue; }
        let p = e.path();
        if p.join("SKILL.md").is_file() { n += 1; }
        else if p.is_dir() {
            n += fs::read_dir(&p).into_iter().flatten().flatten().filter(|c| { let cp = c.path(); !c.file_name().to_string_lossy().starts_with('.') && (cp.join("SKILL.md").is_file() || (cp.is_file() && cp.extension().map(|x| x == "md").unwrap_or(false))) }).count();
        } else if p.extension().map(|x| x == "md").unwrap_or(false) { n += 1; }
    }
    n
}
/// A link (symlink or junction): never followed, so every read stays inside the home or the plugin's folder.
fn is_link(e: &fs::DirEntry) -> bool { e.file_type().map(|t| t.is_symlink()).unwrap_or(true) || fs::symlink_metadata(e.path()).map(|m| m.file_type().is_symlink()).unwrap_or(true) }
fn installed_plugins(home_dir: &Path) -> Vec<(String, PathBuf)> {
    let Ok(t) = fs::read_to_string(home_dir.join("plugins").join("installed_plugins.json")) else { return vec![] };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) else { return vec![] };
    let mut out = vec![];
    if let Some(m) = v["plugins"].as_object() {
        for (id, list) in m {
            let p = list.as_array().and_then(|a| a.first()).and_then(|x| x["installPath"].as_str()).map(PathBuf::from);
            out.push((id.clone(), p.unwrap_or_default()));
        }
    }
    out.sort();
    out
}

/// Places on this computer that hold Claude Code things, with what each holds and whose it is.
pub fn sources() -> Vec<Source> {
    let h = home();
    let index = sessions();
    let mut out = vec![];
    for c in homes() {
        let p = c.join("projects");
        let ms = mains(&p);
        let skills = skill_count(&c.join("skills"));
        let agents = md_count(&c.join("agents"), false);
        let commands = md_count(&c.join("commands"), true);
        let output_styles = md_count(&c.join("output-styles"), false);
        let plugins = installed_plugins(&c).len();
        if ms.is_empty() && skills + agents + commands + output_styles + plugins == 0 { continue; }
        let mut per: BTreeMap<String, usize> = BTreeMap::new();
        let mut terminal = 0;
        let mut last = 0u64;
        let mut folders = HashSet::new();
        for (folder, stem, path) in &ms {
            folders.insert(folder.clone());
            last = last.max(mtime_ms(path));
            match index.get(stem) { Some(s) => *per.entry(s.profile.clone()).or_default() += 1, None => terminal += 1 }
        }
        let name = c.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let account = name.strip_prefix(".claude-").map(|s| s.to_string());
        let shown = match c.strip_prefix(&h) { Ok(rel) => format!("~/{}", fwd(rel)), Err(_) => fwd(&c) };
        let (email, org) = account_of(&c);
        out.push(Source {
            path: fwd(&p), label: format!("Claude Code ({shown})"), kind: "claude-code", conversations: ms.len(), account, home: shown, home_path: fwd(&c), email, org,
            profiles: per.into_iter().map(|(name, sessions)| ProfileUse { name, sessions }).collect(), terminal, last_used: if last > 0 { Some(last) } else { None },
            folders: folders.len(), skills, agents, commands, output_styles, plugins,
        });
    }
    let arch = h.join(".monolith").join("archive");
    if arch.is_dir() {
        let n: usize = projects_roots(&fwd(&arch)).iter().map(|r| count_mains(r)).sum();
        if n > 0 {
            out.push(Source { path: fwd(&arch), label: "Monolith laptop archive (older import)".into(), kind: "archive", conversations: n, account: None, home: "~/.monolith/archive".into(),
                home_path: fwd(&arch), email: None, org: None, profiles: vec![], terminal: 0, last_used: None, folders: 0, skills: 0, agents: 0, commands: 0, output_styles: 0, plugins: 0 });
        }
    }
    out
}

// ---------- conversations ----------

#[derive(Serialize, Clone)]
pub struct FileOut {
    rel: String, size: u64,
    /// The main transcript's content hash (sha256, hex), read in the same pass as its facts. The server compares it
    /// with the hash it stored, so a file whose date changed but whose words didn't is "already here".
    #[serde(skip_serializing_if = "Option::is_none")]
    sha256: Option<String>,
}
#[derive(Serialize, Clone)]
pub struct Unit {
    id: String, folder: String, uuid: String, source: &'static str, fingerprint: String,
    cwd: Option<String>, repo: Option<String>, title: String, started: Option<String>, ended: Option<String>,
    messages: u64, threads: u64, bytes: u64, files: Vec<FileOut>, from: String,
    /// The projects folder it was found in (for the app's own display; never sent to the server).
    root: String,
    /// The desktop app profile whose session this was (None: started in a terminal).
    profile: Option<String>,
    /// Nothing in it at all (an empty transcript file and nothing beside it).
    empty: bool,
    /// Why its transcript could not be read, if it couldn't.
    unreadable: Option<String>,
    /// Other places the same conversation was found (their `from`): this copy is the bigger one.
    also: Vec<String>,
    /// The copies in those places, each as it is there (its own files, sizes and content hash), so the app can send
    /// the copy from a home that is kept when the home with the bigger copy is left out.
    copies: Vec<Copy>,
}
/// Another copy of a conversation: what differs between copies.
#[derive(Serialize, Clone)]
pub struct Copy {
    from: String, root: String, fingerprint: String, started: Option<String>, ended: Option<String>,
    messages: u64, threads: u64, bytes: u64, files: Vec<FileOut>, empty: bool, unreadable: Option<String>,
}
/// One copy as the scan found it, before the copies of a conversation are put together.
struct Found { from: String, root: PathBuf, mrel: String, msize: u64, files: Vec<(String, u64, u128)>, bytes: u64, f: Facts }
impl Found {
    fn fingerprint(&self) -> String {
        // Changed or not: names, sizes and the main transcript's content, never modified times (a copy, a restore or a
        // sync tool touches those without changing a word: 212 transcripts on 12 Nov 2026).
        let mut fp: Vec<String> = self.files.iter().map(|(r, s, _)| format!("{r}:{s}")).collect();
        fp.sort();
        fp.push(format!("main:{}", self.f.sha256.as_deref().unwrap_or("unread")));
        sha_hex(&fp.join("\n"))[..32].to_string()
    }
    fn files_out(&self) -> Vec<FileOut> { self.files.iter().map(|(r, s, _)| FileOut { rel: r.clone(), size: *s, sha256: if *r == self.mrel { self.f.sha256.clone() } else { None } }).collect() }
    fn threads(&self) -> u64 { self.files.iter().filter(|(r, _, _)| r.contains("/subagents/") && r.ends_with(".jsonl")).count() as u64 }
    fn empty(&self) -> bool { self.msize == 0 && self.files.len() == 1 }
}
/// A transcript Hearth can't take (an id or folder name the server would refuse), named for the receipt.
#[derive(Serialize, Clone)]
pub struct Odd { from: String, rel: String, reason: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOut { home: String, units: Vec<Unit>, other_files: u64, titles: usize, odd: Vec<Odd> }

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

struct Facts { cwd: Option<String>, started: Option<String>, ended: Option<String>, messages: u64, custom: Option<String>, ai: Option<String>, first_user: Option<String>, unreadable: Option<String>, sha256: Option<String> }

fn facts(file: &Path) -> Facts {
    let mut f = Facts { cwd: None, started: None, ended: None, messages: 0, custom: None, ai: None, first_user: None, unreadable: None, sha256: None };
    let h = match fs::File::open(file) { Ok(h) => h, Err(e) => { f.unreadable = Some(e.to_string()); return f } };
    let mut r = BufReader::with_capacity(1 << 20, h);
    let mut buf = Vec::new();
    let mut hash = Sha256::new();
    loop {
        buf.clear();
        match r.read_until(b'\n', &mut buf) { Ok(0) => break, Err(e) => { f.unreadable = Some(e.to_string()); break } _ => {} }
        hash.update(&buf);
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
    if f.unreadable.is_none() { f.sha256 = Some(hash.finalize().iter().map(|b| format!("{b:02x}")).collect()); }
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
    let index = sessions();
    let mut repo_cache = HashMap::new();
    // Every copy of every conversation, in the order found (the folder, folder and uuid for each id).
    let mut found: HashMap<String, (String, String, Vec<Found>)> = HashMap::new();
    let mut other = 0u64;
    let mut odd = vec![];
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
            let mut claimed = HashSet::new();
            for (mrel, msize, _) in &mains {
                let uuid = mrel.rsplit('/').next().unwrap().trim_end_matches(".jsonl").to_string();
                done += 1;
                if done % 25 == 0 { progress(done, total); }
                if !ok_folder(&folder) || !ok_uuid(&uuid) {
                    claimed.insert(mrel.clone());
                    odd.push(Odd { from: from.clone(), rel: mrel.clone(), reason: "its file name is not one Hearth can use as an id".into() });
                    continue;
                }
                let prefix = format!("{folder}/{uuid}/");
                let mut files: Vec<(String, u64, u128)> = all.iter().filter(|(r, _, _)| r == mrel || r.starts_with(&prefix)).cloned().collect();
                files.sort_by(|a, b| (a.0 != *mrel).cmp(&(b.0 != *mrel)).then(a.0.cmp(&b.0))); // main thread first
                for f in &files { claimed.insert(f.0.clone()); }
                let id = sha_hex(&format!("{folder}/{uuid}"))[..24].to_string();
                let bytes: u64 = files.iter().map(|f| f.1).sum();
                // The same conversation in two places (e.g. two homes, or the archive and ~/.claude): every copy is
                // read, so the app can send the one from a home that is kept. Twice in one source: the larger.
                let e = found.entry(id).or_insert_with(|| (folder.clone(), uuid.clone(), vec![]));
                if let Some(i) = e.2.iter().position(|c| c.from == from) {
                    if e.2[i].bytes >= bytes { continue; }
                    e.2.remove(i);
                }
                let f = facts(&root.join(mrel));
                e.2.push(Found { from: from.clone(), root: root.clone(), mrel: mrel.clone(), msize: *msize, files, bytes, f });
            }
            other += all.iter().filter(|(r, _, _)| !claimed.contains(r)).count() as u64;
        }
    }
    progress(total, total);
    let mut units: Vec<Unit> = vec![];
    let mut reg: HashMap<String, Vec<(String, PathBuf, Vec<(String, u64)>)>> = HashMap::new();
    for (id, (folder, uuid, mut cs)) in found {
        // The largest copy describes the conversation (the first found, if two are the same size); the others go with it.
        let mut best = 0;
        for (i, c) in cs.iter().enumerate() { if c.bytes > cs[best].bytes { best = i; } }
        let p = cs.remove(best);
        let s = index.get(&uuid);
        let title = s.and_then(|s| s.title.clone()).or(p.f.custom.clone()).or(p.f.ai.clone()).or(p.f.first_user.clone()).unwrap_or_else(|| "Untitled conversation".into());
        let repo = p.f.cwd.as_deref().and_then(|c| repo_of(&c.replace('\\', "/").split("/.claude/worktrees/").next().unwrap_or(c).to_string(), &h, &mut repo_cache));
        let mut copies = vec![(p.from.clone(), p.root.clone(), p.files.iter().map(|(r, s, _)| (r.clone(), *s)).collect::<Vec<_>>())];
        copies.extend(cs.iter().map(|c| (c.from.clone(), c.root.clone(), c.files.iter().map(|(r, s, _)| (r.clone(), *s)).collect())));
        reg.insert(id.clone(), copies);
        units.push(Unit {
            id, folder, uuid, source: "claude-code", fingerprint: p.fingerprint(), cwd: p.f.cwd.clone(), repo, title, started: p.f.started.clone(), ended: p.f.ended.clone(),
            messages: p.f.messages, threads: p.threads(), bytes: p.bytes, files: p.files_out(), from: p.from.clone(), root: fwd(&p.root),
            profile: s.map(|s| s.profile.clone()), empty: p.empty(), unreadable: p.f.unreadable.clone(), also: cs.iter().map(|c| c.from.clone()).collect(),
            copies: cs.iter().map(|c| Copy { from: c.from.clone(), root: fwd(&c.root), fingerprint: c.fingerprint(), started: c.f.started.clone(), ended: c.f.ended.clone(),
                messages: c.f.messages, threads: c.threads(), bytes: c.bytes, files: c.files_out(), empty: c.empty(), unreadable: c.f.unreadable.clone() }).collect(),
        });
    }
    let repos: HashSet<String> = units.iter().filter_map(|u| u.repo.clone()).collect();
    *st.0.lock().unwrap() = ScanState { files: reg, repos };
    let mut list: Vec<Unit> = units;
    list.sort_by(|a, b| b.ended.cmp(&a.ended));
    Ok(ScanOut { home: fwd(&h), units: list, other_files: other, titles: index.len(), odd })
}

/// Bytes [offset, offset+length) of one file of a scanned conversation (at most 8 MB), from the copy found in `from`
/// (the largest copy when not named).
pub fn read(id: &str, from: Option<&str>, rel: &str, offset: u64, length: u64, st: &Scanned) -> Result<Vec<u8>, String> {
    let g = st.0.lock().unwrap();
    let copies = g.files.get(id).ok_or("not a conversation from the latest scan; scan again")?;
    let (_, root, files) = match from { Some(f) => copies.iter().find(|(c, _, _)| c == f).ok_or("no copy of that conversation there")?, None => &copies[0] };
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

// ---------- skills, subagents, slash commands, output styles, plugins ----------

/// One skill, subagent, slash command, output style or plugin hook set. The app checks the content for secrets and
/// client names before anything leaves this computer.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConfigItem {
    /// Stable across runs: `<home>/<origin>/<kind>/<name>`, or `repo:<folder>/<kind>/<name>`.
    key: String,
    /// The source it belongs to: a home's conversations folder (as in sources()), or "repos".
    source: String,
    /// `user` (the home itself), `plugin:<name>`, or `repo`.
    origin: String,
    /// For a project folder's own: that folder.
    repo: Option<String>,
    /// skill, agent, command, output_style, hook; "plugin" for an installed plugin whose folder is missing.
    kind: &'static str, name: String, description: Option<String>, bytes: u64,
    content: Option<String>,
    /// A skill's other text files, relative path -> text.
    files: Option<BTreeMap<String, String>>,
    /// Files of a skill left out: binary, too big, backups, too many.
    left_out: Vec<String>,
    /// Why it can't be read, if it couldn't.
    problem: Option<String>,
    /// Found where Claude Code doesn't load it (a skill one folder down, a loose file in skills/): where it is.
    /// The app lists it and brings it only when the person ticks it.
    nested: Option<String>,
    /// Its own name, when it goes by another here: a name with no letters Hearth can use, or one that two items share
    /// once made into an extension name (the second is kept as name-2). Never dropped for its name.
    renamed: Option<String>,
    /// The name as found (folder or file name), for the checks above.
    #[serde(skip)]
    raw: String,
}
#[derive(Serialize)]
pub struct ConfigOut { items: Vec<ConfigItem> }

const MAX_FILE: u64 = 100_000;
const MAX_FILES: usize = 100;
const MAX_TOTAL: usize = 500_000;

/// lowercase letters, digits and dashes, at most 64 (what Hearth's extensions accept).
fn ext_name(s: &str) -> String {
    let mut out = String::new();
    for c in s.to_lowercase().chars() { if c.is_ascii_alphanumeric() || c == '-' { out.push(c) } else if !out.ends_with('-') { out.push('-') } }
    let t: String = out.trim_matches('-').chars().take(64).collect();
    t.trim_end_matches('-').to_string()
}
fn read_text(f: &Path) -> Option<String> {
    let md = fs::metadata(f).ok()?;
    if !md.is_file() || md.len() > MAX_FILE { return None; }
    let b = fs::read(f).ok()?;
    if b.contains(&0) { return None; } // binary
    String::from_utf8(b).ok()
}
/// The description line of a markdown file's front matter.
fn desc_of(md: &str) -> Option<String> {
    let rest = md.strip_prefix("---")?;
    let end = rest.find("\n---")?;
    for line in rest[..end].lines() {
        if let Some(v) = line.trim().strip_prefix("description:") {
            let v = v.trim().trim_matches(|c| c == '"' || c == '\'').trim();
            if !v.is_empty() { return Some(v.chars().take(300).collect()); }
        }
    }
    None
}
fn skip_file(rel: &str) -> bool {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    name.starts_with('.') || rel.contains("__pycache__/") || name.ends_with(".pyc") || name.contains(".bak") || name == "LICENSE" || name == "LICENSE.txt"
}
/// A skill folder: SKILL.md plus its other text files (references, scripts, assets).
fn read_skill(dir: &Path) -> Option<(String, BTreeMap<String, String>, Vec<String>, usize)> {
    let content = read_text(&dir.join("SKILL.md"))?;
    let mut files = BTreeMap::new();
    let mut left = vec![];
    let mut total = content.len();
    fn go(d: &Path, base: &Path, depth: u32, files: &mut BTreeMap<String, String>, left: &mut Vec<String>, total: &mut usize) {
        let mut es: Vec<_> = fs::read_dir(d).into_iter().flatten().flatten().collect();
        es.sort_by_key(|e| e.file_name());
        for e in es {
            let p = e.path();
            let rel = fwd(p.strip_prefix(base).unwrap_or(&p));
            let name = e.file_name().to_string_lossy().to_string();
            if is_link(&e) { left.push(format!("{rel} (a link, not followed)")); continue; }
            if p.is_dir() { if depth < 4 && !name.starts_with('.') && name != "__pycache__" && name != "node_modules" { go(&p, base, depth + 1, files, left, total); } continue; }
            if !p.is_file() || rel == "SKILL.md" { continue; }
            if skip_file(&rel) { left.push(rel); continue; }
            match read_text(&p) {
                Some(t) if files.len() < MAX_FILES && *total + t.len() <= MAX_TOTAL => { *total += t.len(); files.insert(rel, t); }
                _ => left.push(rel),
            }
        }
    }
    go(dir, dir, 0, &mut files, &mut left, &mut total);
    Some((content, files, left, total))
}

/// One Claude Code layout (a home, a plugin's folder, or a project folder's .claude).
fn read_layout(root: &Path, source: &str, origin: &str, key_base: &str, repo: Option<&str>, hooks: bool, out: &mut Vec<ConfigItem>) {
    let mut push_at = |kind: &'static str, raw: &str, content: Option<String>, files: Option<BTreeMap<String, String>>, left: Vec<String>, bytes: usize, desc: Option<String>, problem: Option<String>, nested: Option<String>| {
        // A name with no letters Hearth can use (all in another script, say) keeps the item, under a stand-in name.
        let made = ext_name(raw);
        let (name, renamed) = if made.is_empty() { (format!("{}-{}", kind.replace('_', "-"), &sha_hex(raw)[..8]), Some(raw.to_string())) } else { (made, None) };
        let key = match &nested { Some(at) => format!("{key_base}/{kind}-elsewhere/{at}"), None => format!("{key_base}/{kind}/{name}") };
        out.push(ConfigItem { key, source: source.to_string(), origin: origin.to_string(), repo: repo.map(String::from), kind, name,
            description: desc.or_else(|| content.as_deref().and_then(desc_of)), bytes: bytes as u64, content, files, left_out: left, problem, nested, renamed, raw: raw.to_string() });
    };
    macro_rules! push { ($($a:expr),*) => { push_at($($a),*, None) } }
    fn md_files(d: &Path, prefix: &str, deep: bool, out: &mut Vec<(String, PathBuf)>) {
        let mut es: Vec<_> = fs::read_dir(d).into_iter().flatten().flatten().collect();
        es.sort_by_key(|e| e.file_name());
        for e in es {
            let p = e.path();
            let n = e.file_name().to_string_lossy().to_string();
            if is_link(&e) { continue; }
            if p.is_dir() && deep { md_files(&p, &format!("{prefix}{n}-"), true, out); }
            else if p.is_file() && n.ends_with(".md") { out.push((format!("{prefix}{}", &n[..n.len() - 3]), p)); }
        }
    }
    for (sub, kind, deep) in [("commands", "command", true), ("agents", "agent", false), ("output-styles", "output_style", false)] {
        let mut l = vec![];
        md_files(&root.join(sub), "", deep, &mut l);
        for (n, p) in l {
            match read_text(&p) {
                Some(t) => { let b = t.len(); push!(kind, &n, Some(t), None, vec![], b, None, None) }
                None => push!(kind, &n, None, None, vec![], fs::metadata(&p).map(|m| m.len() as usize).unwrap_or(0), None, Some("it could not be read as text (too big, or not text)".into())),
            }
        }
    }
    // Skills: skills/<name>/SKILL.md. A folder without one is looked into once more (skills/development/<name>/SKILL.md),
    // and loose .md files are listed too: Claude Code doesn't load either from there, so they come only if ticked.
    let mut skills: Vec<_> = fs::read_dir(root.join("skills")).into_iter().flatten().flatten().collect();
    skills.sort_by_key(|e| e.file_name());
    let mut elsewhere: Vec<(String, PathBuf, bool)> = vec![]; // (where, path, is a skill folder)
    for s in skills {
        let n = s.file_name().to_string_lossy().to_string();
        if n.starts_with('.') { continue; }
        let p = s.path();
        if is_link(&s) {
            // A skill folder that is a link to somewhere else: named, not read (reads stay inside the home or plugin folder).
            push!("skill", &n, None, None, vec![], 0, None, Some("it is a link to a folder elsewhere, so it wasn't read: copy the folder here to bring it".into()));
            continue;
        }
        if p.is_dir() && p.join("SKILL.md").exists() {
            match read_skill(&p) {
                Some((c, f, l, total)) => push!("skill", &n, Some(c), if f.is_empty() { None } else { Some(f) }, l, total, None, None),
                None => push!("skill", &n, None, None, vec![], 0, None, Some("its SKILL.md could not be read as text".into())),
            }
        } else if p.is_dir() {
            let mut inner: Vec<_> = fs::read_dir(&p).into_iter().flatten().flatten().collect();
            inner.sort_by_key(|e| e.file_name());
            for c in inner {
                let cn = c.file_name().to_string_lossy().to_string();
                if cn.starts_with('.') { continue; }
                let cp = c.path();
                if cp.is_dir() && cp.join("SKILL.md").exists() { elsewhere.push((format!("skills/{n}/{cn}"), cp, true)); }
                else if cp.is_file() && cn.ends_with(".md") { elsewhere.push((format!("skills/{n}/{cn}"), cp, false)); }
            }
        } else if p.is_file() && n.ends_with(".md") { elsewhere.push((format!("skills/{n}"), p, false)); }
    }
    for (at, p, folder) in elsewhere {
        let raw = p.file_stem().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
        if folder {
            match read_skill(&p) {
                Some((c, f, l, total)) => push_at("skill", &raw, Some(c), if f.is_empty() { None } else { Some(f) }, l, total, None, None, Some(at)),
                None => push_at("skill", &raw, None, None, vec![], 0, None, Some("its SKILL.md could not be read as text".into()), Some(at)),
            }
        } else {
            match read_text(&p) {
                Some(t) => { let b = t.len(); push_at("skill", &raw, Some(t), None, vec![], b, None, None, Some(at)) }
                None => push_at("skill", &raw, None, None, vec![], 0, None, Some("it could not be read as text".into()), Some(at)),
            }
        }
    }
    if hooks {
        let f = root.join("hooks").join("hooks.json");
        if f.is_file() {
            let n = format!("{}-hooks", origin.strip_prefix("plugin:").unwrap_or(origin));
            match read_text(&f).and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()) {
                Some(j) => { let c = serde_json::to_string(j.get("hooks").unwrap_or(&j)).unwrap_or_default(); let b = c.len(); push!("hook", &n, Some(c), None, vec![], b, Some(format!("Hooks from {}", origin.strip_prefix("plugin:").unwrap_or(origin))), None) }
                None => push!("hook", &n, None, None, vec![], 0, None, Some("its hooks.json is not valid JSON".into())),
            }
        }
    }
}

/// Everything in the given homes (from sources(): their `homePath`) and project folders (from the latest scan).
/// Never reads settings.json, credentials, or a project folder's hooks.
pub fn config(homes_in: &[String], repos: &[String], st: &Scanned) -> Result<ConfigOut, String> {
    let srcs = sources();
    let known: HashSet<String> = st.0.lock().unwrap().repos.clone();
    let mut items = vec![];
    for hp in homes_in {
        let s = srcs.iter().find(|s| &s.home_path == hp && s.kind == "claude-code").ok_or_else(|| format!("not a Claude Code home this app found: {hp}"))?;
        let root = PathBuf::from(&s.home_path);
        read_layout(&root, &s.path, "user", &format!("{}/user", s.home_path), None, false, &mut items);
        for (id, p) in installed_plugins(&root) {
            let mut name = id.split('@').next().unwrap_or(&id).to_string();
            if let Some(n) = fs::read_to_string(p.join(".claude-plugin").join("plugin.json")).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()).and_then(|v| v["name"].as_str().map(String::from)) { name = n; }
            let origin = format!("plugin:{}", ext_name(&name));
            // installed_plugins.json is read as data: a folder outside this home's plugins folder is not read.
            let inside = match (fs::canonicalize(&p), fs::canonicalize(root.join("plugins"))) { (Ok(a), Ok(b)) => a.starts_with(&b), _ => false };
            if p.is_dir() && !inside {
                items.push(ConfigItem { key: format!("{}/{origin}", s.home_path), source: s.path.clone(), origin: origin.clone(), repo: None, kind: "plugin", name: ext_name(&name), description: None, bytes: 0,
                    content: None, files: None, left_out: vec![], problem: Some("its folder is outside this home's plugins folder, so it wasn't read".into()), nested: None, renamed: None, raw: name.clone() });
                continue;
            }
            if !p.is_dir() {
                items.push(ConfigItem { key: format!("{}/{origin}", s.home_path), source: s.path.clone(), origin: origin.clone(), repo: None, kind: "plugin", name: ext_name(&name), description: None, bytes: 0,
                    content: None, files: None, left_out: vec![], problem: Some("the plugin is listed as installed, but its folder is not on this computer".into()), nested: None, renamed: None, raw: name.clone() });
                continue;
            }
            read_layout(&p, &s.path, &origin, &format!("{}/{origin}", s.home_path), None, true, &mut items);
        }
    }
    for r in repos {
        if !known.contains(r) { return Err(format!("not a project folder from the latest scan: {r}")); }
        let root = PathBuf::from(r).join(".claude");
        if root.is_dir() { read_layout(&root, "repos", "repo", &format!("repo:{r}"), Some(r), false, &mut items); }
    }
    // Two items that become the same extension name ("My Skill" and "my-skill"): both kept, the second as name-2.
    let mut seen: HashMap<String, usize> = HashMap::new();
    for it in items.iter_mut() {
        let n = seen.entry(it.key.clone()).or_insert(0);
        *n += 1;
        if *n > 1 {
            it.key = format!("{}-{}", it.key, n);
            it.renamed = Some(it.raw.clone());
            it.name = format!("{}-{}", it.name.chars().take(60).collect::<String>(), n);
        }
    }
    Ok(ConfigOut { items })
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
pub fn import_read(id: String, from: Option<String>, rel: String, offset: u64, length: u64, state: State<'_, Scanned>) -> Result<tauri::ipc::Response, String> {
    read(&id, from.as_deref(), &rel, offset, length, &state).map(tauri::ipc::Response::new)
}

#[tauri::command]
pub async fn import_config(homes: Vec<String>, repos: Vec<String>, state: State<'_, Scanned>) -> Result<ConfigOut, String> {
    config(&homes, &repos, &state)
}

#[cfg(test)]
mod tests {
    use super::*;
    /// The tests set process-wide variables (HEARTH_IMPORT_HOME, ..._PROFILES): one at a time.
    static ENV: Mutex<()> = Mutex::new(());

    fn line(cwd: &Path, t: &str, ty: &str) -> String {
        format!("{{\"type\":\"{ty}\",\"cwd\":{},\"timestamp\":\"2026-10-01T09:00:00Z\",\"message\":{{\"role\":\"{ty}\",\"content\":\"{t}\"}}}}\n", serde_json::to_string(&fwd(cwd)).unwrap())
    }
    fn session(dir: &Path, n: u32, cli: &str, title: &str) {
        let d = dir.join("claude-code-sessions").join("acct").join("org");
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join(format!("local_{n}.json")), format!("{{\"cliSessionId\":\"{cli}\",\"title\":\"{title}\",\"lastActivityAt\":1}}")).unwrap();
    }

    // A fixture home: a repo with a worktree, a conversation in each, a subagent thread, a memory file, an archive copy.
    #[test]
    fn fixture_scan() {
        let _g = ENV.lock().unwrap_or_else(|e| e.into_inner());
        let base = std::env::temp_dir().join(format!("hearth-import-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let home = base.join("home");
        let repo = base.join("repo");
        let wt = base.join("wt");
        fs::create_dir_all(repo.join(".git").join("worktrees").join("wt")).unwrap();
        fs::create_dir_all(repo.join("sub")).unwrap();
        fs::create_dir_all(&wt).unwrap();
        fs::write(wt.join(".git"), format!("gitdir: {}/.git/worktrees/wt", fwd(&repo))).unwrap();
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
        fs::write(a.join("u1.jsonl"), "{}\n").unwrap();
        std::env::set_var("HEARTH_IMPORT_HOME", &home);
        std::env::set_var("HEARTH_IMPORT_PROFILES", base.join("none"));
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
        assert_eq!(u1.also.len(), 1, "the archive copy is named as another place it was found");
        assert_eq!(read(&u1.id, None, "repo-sub/u1.jsonl", 0, 5, &st).unwrap(), b"{\"typ".to_vec());
        assert!(read(&u1.id, None, "repo-sub/memory/note.md", 0, 5, &st).is_err(), "only a conversation's own files");
        assert!(scan(&|_, _| {}, &[fwd(&base)], &Scanned::default()).is_err(), "only folders sources() lists");
        let _ = fs::remove_dir_all(&base);
    }

    // Two homes, two desktop profiles sharing the first, a third home with only skills, the account each is signed in
    // with, a duplicate, an empty transcript, an odd file name; then the skills and the like of each home and of a
    // project folder, and nothing outside them.
    #[test]
    fn discovery_and_config() {
        let _g = ENV.lock().unwrap_or_else(|e| e.into_inner());
        let base = std::env::temp_dir().join(format!("hearth-discover-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let home = base.join("home");
        let repo = base.join("garden");
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::create_dir_all(repo.join(".claude").join("skills").join("watering")).unwrap();
        fs::write(repo.join(".claude").join("skills").join("watering").join("SKILL.md"), "---\ndescription: Water the beds\n---\nWater at 6.").unwrap();
        fs::create_dir_all(repo.join(".claude").join("hooks")).unwrap();
        fs::write(repo.join(".claude").join("settings.json"), "{\"hooks\":{}}").unwrap();
        let c1 = home.join(".claude");
        let p1 = c1.join("projects").join("garden");
        fs::create_dir_all(&p1).unwrap();
        fs::write(p1.join("aaa.jsonl"), line(&repo, "personal one", "user")).unwrap();
        fs::write(p1.join("bbb.jsonl"), line(&repo, "work one", "user")).unwrap();
        fs::write(p1.join("ccc.jsonl"), line(&repo, "from the terminal", "user")).unwrap();
        fs::write(p1.join("empty.jsonl"), "").unwrap();
        fs::write(p1.join("bad id!.jsonl"), line(&repo, "odd", "user")).unwrap();
        fs::write(home.join(".claude.json"), "{\"oauthAccount\":{\"emailAddress\":\"sam@example.com\",\"organizationName\":\"Sam's org\"},\"primaryApiKey\":\"never-read\"}").unwrap();
        // Skills and the like in the first home, and a plugin with a skill and hooks.
        fs::create_dir_all(c1.join("skills").join("tidy").join("refs")).unwrap();
        fs::write(c1.join("skills").join("tidy").join("SKILL.md"), "---\nname: tidy\ndescription: \"Tidy up\"\n---\nTidy.").unwrap();
        fs::write(c1.join("skills").join("tidy").join("refs").join("a.md"), "ref").unwrap();
        fs::write(c1.join("skills").join("tidy").join("logo.png"), [0u8, 1, 2]).unwrap();
        // Skills one folder down, a loose file, Claude's own synced ones, and a .trash folder (skipped).
        fs::create_dir_all(c1.join("skills").join("development").join("upgrade")).unwrap();
        fs::write(c1.join("skills").join("development").join("upgrade").join("SKILL.md"), "---\ndescription: Upgrade a site\n---\nUpgrade.").unwrap();
        fs::write(c1.join("skills").join("development").join("notes.md"), "Loose notes.").unwrap();
        fs::write(c1.join("skills").join("loose.md"), "A loose skill file.").unwrap();
        // A name with no letters Hearth can use, and two names that become the same one.
        fs::create_dir_all(c1.join("skills").join("日本語")).unwrap();
        fs::write(c1.join("skills").join("日本語").join("SKILL.md"), "Japanese.").unwrap();
        fs::create_dir_all(c1.join("agents")).unwrap();
        fs::write(c1.join("agents").join("Code Review.md"), "One.").unwrap();
        fs::write(c1.join("agents").join("code-review.md"), "Two.").unwrap();
        fs::create_dir_all(c1.join("skills").join(".trash").join("old")).unwrap();
        fs::write(c1.join("skills").join(".trash").join("old").join("SKILL.md"), "Old.").unwrap();
        fs::create_dir_all(c1.join("agents")).unwrap();
        fs::write(c1.join("agents").join("Reviewer.md"), "Review things.").unwrap();
        fs::create_dir_all(c1.join("commands").join("git")).unwrap();
        fs::write(c1.join("commands").join("git").join("ship.md"), "Ship it.").unwrap();
        fs::write(c1.join("settings.json"), "{\"env\":{\"TOKEN\":\"never-read\"}}").unwrap();
        let plug = c1.join("plugins").join("cache").join("helper");
        let outside = base.join("elsewhere").join("sneaky");
        fs::create_dir_all(outside.join("skills").join("grab")).unwrap();
        fs::write(outside.join("skills").join("grab").join("SKILL.md"), "Outside.").unwrap();
        fs::create_dir_all(plug.join("skills").join("helping")).unwrap();
        fs::create_dir_all(plug.join(".claude-plugin")).unwrap();
        fs::create_dir_all(plug.join("hooks")).unwrap();
        fs::write(plug.join(".claude-plugin").join("plugin.json"), "{\"name\":\"Helper\"}").unwrap();
        fs::write(plug.join("skills").join("helping").join("SKILL.md"), "Help.").unwrap();
        fs::write(plug.join("hooks").join("hooks.json"), "{\"hooks\":{\"Stop\":[]}}").unwrap();
        fs::create_dir_all(c1.join("plugins")).unwrap();
        fs::write(c1.join("plugins").join("installed_plugins.json"), format!("{{\"plugins\":{{\"helper@market\":[{{\"installPath\":{}}}],\"gone@market\":[{{\"installPath\":\"{}\"}}],\"sneaky@market\":[{{\"installPath\":{}}}]}}}}",
            serde_json::to_string(&fwd(&plug)).unwrap(), fwd(&c1.join("plugins").join("cache").join("nowhere")), serde_json::to_string(&fwd(&outside)).unwrap())).unwrap();
        // A home that holds only skills one folder down is still listed.
        fs::create_dir_all(home.join(".claude-nested").join("skills").join("development").join("deep")).unwrap();
        fs::write(home.join(".claude-nested").join("skills").join("development").join("deep").join("SKILL.md"), "Deep.").unwrap();
        // A skill folder that is a link elsewhere (where links can be made): named, not read.
        #[cfg(unix)] let linked = std::os::unix::fs::symlink(&outside.join("skills").join("grab"), c1.join("skills").join("linked")).is_ok();
        #[cfg(windows)] let linked = std::os::windows::fs::symlink_dir(&outside.join("skills").join("grab"), c1.join("skills").join("linked")).is_ok();
        // A second home with the same conversation as the first (a copy) and one of its own.
        let c2 = home.join(".claude-work");
        let p2 = c2.join("projects").join("garden");
        fs::create_dir_all(&p2).unwrap();
        fs::write(p2.join("aaa.jsonl"), line(&repo, "personal", "user")).unwrap(); // a shorter copy
        fs::write(p2.join("ddd.jsonl"), line(&repo, "only here", "user")).unwrap();
        fs::write(c2.join(".claude.json"), "{\"oauthAccount\":{\"emailAddress\":\"sam@work.example\"}}").unwrap();
        // A third home with only a slash command; an empty home (left out).
        fs::create_dir_all(home.join(".claude-tools").join("commands")).unwrap();
        fs::write(home.join(".claude-tools").join("commands").join("hi.md"), "Hi.").unwrap();
        fs::create_dir_all(home.join(".claude-empty")).unwrap();
        // Two desktop profiles, both keeping their Code sessions in ~/.claude.
        let profiles = base.join("profiles");
        session(&profiles.join("Personal"), 1, "aaa", "Personal one, titled by the app");
        session(&profiles.join("Work"), 1, "bbb", "Work one");
        std::env::set_var("HEARTH_IMPORT_HOME", &home);
        std::env::set_var("HEARTH_IMPORT_PROFILES", &profiles);

        let src = sources();
        let names: Vec<_> = src.iter().map(|s| s.home.clone()).collect();
        assert_eq!(names, vec!["~/.claude", "~/.claude-nested", "~/.claude-tools", "~/.claude-work"], "every home that holds something (skills one folder down too), none that is empty");
        let h1 = &src[0];
        assert_eq!(h1.conversations, 5);
        assert_eq!(h1.profiles.iter().map(|p| (p.name.as_str(), p.sessions)).collect::<Vec<_>>(), vec![("Personal", 1), ("Work", 1)], "two profiles share this home");
        assert_eq!(h1.terminal, 3);
        assert_eq!((h1.email.as_deref(), h1.org.as_deref()), (Some("sam@example.com"), Some("Sam's org")));
        assert_eq!((h1.agents, h1.commands, h1.plugins, h1.folders), (3, 1, 3, 1));
        assert!(h1.skills >= 5, "tidy, 日本語, two one folder down and a loose file (and the link where made): {}", h1.skills);
        assert!(h1.last_used.is_some());
        let at = |h: &str| src.iter().find(|s| s.home == h).unwrap();
        assert_eq!((at("~/.claude-tools").conversations, at("~/.claude-tools").commands), (0, 1));
        assert_eq!((at("~/.claude-nested").conversations, at("~/.claude-nested").skills), (0, 1));
        assert_eq!(at("~/.claude-work").email.as_deref(), Some("sam@work.example"));
        // The copy of a Personal session in the second home still counts as Personal's; its own one as the terminal's.
        assert_eq!((at("~/.claude-work").profiles.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), at("~/.claude-work").terminal), (vec!["Personal"], 1));

        let st = Scanned::default();
        let out = scan(&|_, _| {}, &src.iter().map(|s| s.path.clone()).collect::<Vec<_>>(), &st).unwrap();
        let by = |u: &str| out.units.iter().find(|x| x.uuid == u).unwrap();
        assert_eq!(by("aaa").profile.as_deref(), Some("Personal"));
        assert_eq!(by("aaa").title, "Personal one, titled by the app");
        assert_eq!(by("bbb").profile.as_deref(), Some("Work"));
        assert_eq!(by("ccc").profile, None, "a terminal session");
        assert_eq!(by("aaa").also.len(), 1, "the copy in the second home is named, not counted twice");
        // That copy as it is in the second home: its own size and hash, and read from there when asked for.
        let work = at("~/.claude-work").path.clone();
        let (a, c) = (by("aaa"), &by("aaa").copies[0]);
        assert_eq!((a.copies.len(), c.from.as_str()), (1, work.as_str()));
        assert!(c.bytes < a.bytes && c.fingerprint != a.fingerprint, "the bigger copy describes it; the other keeps its own");
        let mine = fs::read(p2.join("aaa.jsonl")).unwrap();
        let want2: String = Sha256::digest(&mine).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(c.files[0].sha256.as_deref(), Some(want2.as_str()));
        assert_eq!(read(&a.id, Some(&work), &c.files[0].rel, 0, 1 << 20, &st).unwrap(), mine, "read from the copy in the second home");
        assert_eq!(read(&a.id, None, &a.files[0].rel, 0, 1 << 20, &st).unwrap(), fs::read(p1.join("aaa.jsonl")).unwrap(), "the bigger copy by default");
        assert!(read(&a.id, Some("C:/nowhere"), &a.files[0].rel, 0, 10, &st).is_err(), "only a place it was found in");
        assert!(by("empty").empty);
        // The main transcript's content hash, read in the same pass; the fingerprint ignores modified times.
        let a = by("aaa");
        let want: String = Sha256::digest(fs::read(p1.join("aaa.jsonl")).unwrap()).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(a.files[0].sha256.as_deref(), Some(want.as_str()));
        let before = a.fingerprint.clone();
        fs::File::options().write(true).open(p1.join("aaa.jsonl")).unwrap().set_modified(std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000)).unwrap();
        let again = scan(&|_, _| {}, &src.iter().map(|s| s.path.clone()).collect::<Vec<_>>(), &Scanned::default()).unwrap();
        assert_eq!(again.units.iter().find(|x| x.uuid == "aaa").unwrap().fingerprint, before, "a new date alone is not a change");
        fs::write(p1.join("aaa.jsonl"), line(&repo, "personal ONE", "user")).unwrap(); // same size, different words
        let changed = scan(&|_, _| {}, &src.iter().map(|s| s.path.clone()).collect::<Vec<_>>(), &Scanned::default()).unwrap();
        assert_ne!(changed.units.iter().find(|x| x.uuid == "aaa").unwrap().fingerprint, before, "different words are a change, even at the same size");
        fs::write(p1.join("aaa.jsonl"), line(&repo, "personal one", "user")).unwrap();
        assert!(!by("aaa").empty);
        assert_eq!(out.odd.len(), 1, "an odd file name is named, not dropped silently");
        assert_eq!(out.units.len(), 5);

        let cfg = config(&[src[0].home_path.clone()], &[real(&repo)], &st).unwrap();
        let keys: Vec<String> = cfg.items.iter().filter(|i| i.renamed.is_none() && !i.name.starts_with("code-review") && i.origin != "plugin:sneaky" && i.name != "linked").map(|i| format!("{}:{}:{}", i.origin, i.kind, i.name)).collect();
        assert_eq!(keys, vec!["user:command:git-ship", "user:agent:reviewer", "user:skill:tidy", "user:skill:notes", "user:skill:upgrade", "user:skill:loose", "plugin:gone:plugin:gone", "plugin:helper:skill:helping", "plugin:helper:hook:helper-hooks", "repo:skill:watering"], "{keys:?}");
        let sneaky = cfg.items.iter().find(|i| i.origin == "plugin:sneaky").expect("named");
        assert!(sneaky.problem.as_deref().unwrap_or("").contains("outside this home"), "{:?}", sneaky.problem);
        assert!(!cfg.items.iter().any(|i| i.content.as_deref() == Some("Outside.")), "nothing read from outside the home");
        if linked {
            let l = cfg.items.iter().find(|i| i.name == "linked").expect("a linked skill folder is named");
            assert!(l.content.is_none() && l.problem.as_deref().unwrap_or("").contains("link"));
        }
        let jp = cfg.items.iter().find(|i| i.renamed.as_deref() == Some("日本語")).expect("kept under a stand-in name");
        assert!(jp.name.starts_with("skill-") && jp.content.is_some());
        let reviews: Vec<_> = cfg.items.iter().filter(|i| i.kind == "agent" && i.name.starts_with("code-review")).map(|i| (i.name.clone(), i.renamed.clone())).collect();
        assert_eq!(reviews.len(), 2, "both kept: {reviews:?}");
        assert!(reviews.iter().any(|(n, r)| n == "code-review-2" && r.is_some()), "{reviews:?}");
        let keys: HashSet<_> = cfg.items.iter().map(|i| i.key.clone()).collect();
        assert_eq!(keys.len(), cfg.items.len(), "every key is its own");
        let nested: Vec<_> = cfg.items.iter().filter_map(|i| i.nested.clone()).collect();
        assert_eq!(nested, vec!["skills/development/notes.md", "skills/development/upgrade", "skills/loose.md"], "found where Claude Code doesn't load them, and said so");
        assert_eq!(cfg.items.iter().find(|i| i.name == "upgrade").unwrap().description.as_deref(), Some("Upgrade a site"));
        assert!(cfg.items.iter().find(|i| i.name == "tidy").unwrap().nested.is_none());
        let tidy = cfg.items.iter().find(|i| i.name == "tidy").unwrap();
        assert_eq!(tidy.description.as_deref(), Some("Tidy up"));
        assert_eq!(tidy.files.as_ref().unwrap().keys().collect::<Vec<_>>(), vec!["refs/a.md"]);
        assert_eq!(tidy.left_out, vec!["logo.png"], "binary files are left out and named");
        assert!(cfg.items.iter().find(|i| i.origin == "plugin:gone").unwrap().problem.is_some());
        let water = cfg.items.iter().find(|i| i.name == "watering").unwrap();
        assert_eq!((water.repo.as_deref(), water.source.as_str()), (Some(real(&repo).as_str()), "repos"));
        assert!(!serde_json::to_string(&cfg.items).unwrap().contains("never-read"), "settings, credentials and account keys are never read");
        assert!(config(&[fwd(&base)], &[], &st).is_err(), "only homes sources() lists");
        assert!(config(&[], &[fwd(&base)], &st).is_err(), "only project folders the scan found");
        let _ = fs::remove_dir_all(&base);
    }

    // Real data on the developer machine: HEARTH_IMPORT_REAL=1 cargo test real_scan -- --nocapture
    #[test]
    fn real_scan() {
        if std::env::var("HEARTH_IMPORT_REAL").is_err() { return; }
        let _g = ENV.lock().unwrap_or_else(|e| e.into_inner());
        let src = sources();
        for s in &src { println!("source {} {} {} profiles {:?} terminal {}", s.label, s.path, s.conversations, s.profiles.iter().map(|p| (&p.name, p.sessions)).collect::<Vec<_>>(), s.terminal); }
        let st = Scanned::default();
        let t = std::time::Instant::now();
        let out = scan(&|_, _| {}, &src.iter().map(|s| s.path.clone()).collect::<Vec<_>>(), &st).unwrap();
        println!("units {} other {} titles {} odd {} in {:?}", out.units.len(), out.other_files, out.titles, out.odd.len(), t.elapsed());
        if let Ok(f) = std::env::var("HEARTH_IMPORT_DUMP") { fs::write(f, serde_json::to_string(&out).unwrap()).unwrap(); }
        let u = &out.units[0];
        let b = read(&u.id, None, &u.files[0].rel, 0, 64, &st).unwrap();
        assert!(!b.is_empty());
        assert!(read(&u.id, None, "../../etc/passwd", 0, 10, &st).is_err());
    }
}
