// The setup guide (docs/setup-guide.md): a small assistant that helps with first-run setup, before any server exists.
// It calls the model provider the person chose, with their key, straight from this process. Nothing in between.
//
// The key and the address it was checked against are kept together in one keychain entry. The web view can ask for a
// call to one of two fixed paths, but it can't read the key or send it anywhere else. Model calls, address checks and
// the Docker check all run here, so the web view's CSP (ws/wss only) stays as it is.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

const SERVICE: &str = "dev.usehearth.hearth";
const ENTRY: &str = "guide-provider";
const MAX_BODY: usize = 2_000_000;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Kind { Anthropic, Openai }

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Stored { kind: Kind, base_url: String, key: Option<String> }

/// What the web view may know about the guide's provider: never the key.
#[derive(Serialize, Debug)]
pub struct Status { kind: Kind, base_url: String, has_key: bool }

fn entry() -> Result<keyring::Entry, String> { keyring::Entry::new(SERVICE, ENTRY).map_err(|e| e.to_string()) }

fn load() -> Result<Option<Stored>, String> {
    match entry()?.get_password() {
        Ok(s) => serde_json::from_str(&s).map(Some).map_err(|_| "the guide's saved key is damaged; check it again".into()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// The base address, cleaned: http(s) only, no trailing slash. Anthropic's is without /v1, OpenAI-style with it.
fn clean_base(kind: &Kind, base_url: &str) -> Result<String, String> {
    let raw = base_url.trim();
    let raw = if raw.is_empty() {
        match kind { Kind::Anthropic => "https://api.anthropic.com", Kind::Openai => return Err("Enter the API address.".into()) }
    } else { raw };
    let u = reqwest::Url::parse(raw).map_err(|_| "That address doesn't look right.".to_string())?;
    if u.scheme() != "https" && u.scheme() != "http" { return Err("The address must start with https:// or http://".into()); }
    if u.query().is_some() || !u.username().is_empty() || u.password().is_some() { return Err("The address must be a plain API address.".into()); }
    Ok(u.as_str().trim_end_matches('/').to_string())
}

fn client(timeout: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(Duration::from_secs(timeout)).connect_timeout(Duration::from_secs(8))
        .user_agent("Hearth setup guide").build().map_err(|e| e.to_string())
}

fn url_for(s: &Stored, path: &str) -> String {
    match s.kind {
        Kind::Anthropic => format!("{}/v1/{path}", s.base_url),
        Kind::Openai => format!("{}/{path}", s.base_url),
    }
}

fn with_auth(s: &Stored, rb: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    match (&s.kind, &s.key) {
        (Kind::Anthropic, Some(k)) => rb.header("x-api-key", k).header("anthropic-version", "2023-06-01"),
        (Kind::Anthropic, None) => rb.header("anthropic-version", "2023-06-01"),
        (Kind::Openai, Some(k)) => rb.bearer_auth(k),
        (Kind::Openai, None) => rb,
    }
}

/// A provider's error in plain words (docs/ux-and-brand.md, Errors). The provider's own message follows when it helps.
fn plain_error(status: u16, body: &str) -> String {
    let msg = serde_json::from_str::<Value>(body).ok()
        .and_then(|v| v.pointer("/error/message").or_else(|| v.pointer("/message")).and_then(|m| m.as_str()).map(String::from))
        .unwrap_or_default();
    let low = msg.to_lowercase();
    let head = if status == 401 || status == 403 { "That key was refused." }
        else if low.contains("credit") || low.contains("billing") || low.contains("quota") || status == 402 { "That account has no credit left." }
        else if status == 404 { "That address answered, but it isn't an Anthropic or OpenAI-style API (or the model doesn't exist)." }
        else if status == 429 { "The provider is busy or rate-limited. Try again in a minute." }
        else if status >= 500 { "The provider had a problem. Try again in a minute." }
        else { "The provider refused the request." };
    if msg.is_empty() { head.to_string() } else { format!("{head} ({})", msg.chars().take(300).collect::<String>()) }
}

fn net_error(e: &reqwest::Error) -> String {
    if e.is_timeout() { "Nothing answered in time at that address.".into() }
    else if e.is_connect() { "Nothing answered at that address.".into() }
    else { format!("The request failed ({e}).") }
}

async fn read_json(r: reqwest::Response) -> Result<Value, String> {
    let status = r.status().as_u16();
    let bytes = r.bytes().await.map_err(|e| net_error(&e))?;
    if bytes.len() > MAX_BODY { return Err("The provider's answer was too large.".into()); }
    let text = String::from_utf8_lossy(&bytes);
    if !(200..300).contains(&status) { return Err(plain_error(status, &text)); }
    serde_json::from_str(&text).map_err(|_| "That address answered, but not with an API reply.".into())
}

async fn list_models(s: &Stored) -> Result<Vec<String>, String> {
    let c = client(20)?;
    let r = with_auth(s, c.get(url_for(s, "models"))).send().await.map_err(|e| net_error(&e))?;
    let v = read_json(r).await?;
    // Anthropic and OpenAI both answer { data: [{ id }] }; Ollama's OpenAI endpoint does too.
    let ids: Vec<String> = v.get("data").and_then(|d| d.as_array()).map(|a| a.iter().filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(String::from)).collect()).unwrap_or_default();
    if ids.is_empty() { return Err("That address answered, but listed no models.".into()); }
    Ok(ids)
}

#[derive(Serialize)]
pub struct Checked { models: Vec<String> }

/// Checks the key with real calls (the model list, then one tiny message to `model` when given), and only then keeps it.
/// A blank key keeps the one already saved for the same address (to change the model without typing the key again).
#[tauri::command]
pub async fn guide_check(kind: Kind, base_url: String, key: Option<String>, model: Option<String>) -> Result<Checked, String> {
    let base_url = clean_base(&kind, &base_url)?;
    let key = match key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
        Some(k) if k.len() > 512 => return Err("That key is too long.".into()),
        Some(k) => Some(k),
        None => load()?.filter(|s| s.kind == kind && s.base_url == base_url).and_then(|s| s.key),
    };
    if kind == Kind::Anthropic && key.is_none() { return Err("Paste your Anthropic API key.".into()); }
    let s = Stored { kind, base_url, key };
    let models = check_with(&s, model.as_deref()).await?;
    entry()?.set_password(&serde_json::to_string(&s).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(Checked { models })
}

const fn message_path(kind: &Kind) -> &'static str { match kind { Kind::Anthropic => "messages", Kind::Openai => "chat/completions" } }

/// The checks themselves, without the keychain: the model list, then one tiny message to `model` when given.
async fn check_with(s: &Stored, model: Option<&str>) -> Result<Vec<String>, String> {
    let models = list_models(s).await?;
    if let Some(m) = model.filter(|m| !m.is_empty()) {
        // One tiny message: catches "no credit" and a model the key can't use, which the list alone doesn't.
        // Both formats take the same minimal body.
        let body = serde_json::json!({ "model": m, "max_tokens": 16, "messages": [{ "role": "user", "content": "Say OK." }] });
        call_with(s, &body, 60).await?;
    }
    Ok(models)
}

/// One call to the provider's message path, without the keychain.
async fn call_with(s: &Stored, body: &Value, timeout: u64) -> Result<Value, String> {
    let c = client(timeout)?;
    let r = with_auth(s, c.post(url_for(s, message_path(&s.kind))).json(body)).send().await.map_err(|e| net_error(&e))?;
    read_json(r).await
}

#[tauri::command]
pub fn guide_status() -> Result<Option<Status>, String> {
    Ok(load()?.map(|s| Status { kind: s.kind, base_url: s.base_url, has_key: s.key.is_some() }))
}

/// One model call: the body is built by the web view; the address and key come from the keychain. Only the two
/// message paths are allowed.
#[tauri::command]
pub async fn guide_call(body: Value) -> Result<Value, String> {
    let s = load()?.ok_or("The guide has no model key. Check one first.")?;
    if serde_json::to_vec(&body).map(|b| b.len()).unwrap_or(usize::MAX) > MAX_BODY { return Err("The conversation is too long.".into()); }
    call_with(&s, &body, 120).await
}

#[tauri::command]
pub fn guide_forget() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---------- checks the guide can run ----------

#[derive(Serialize, Default, Debug)]
pub struct AddressCheck {
    /// The http(s) address that was tried.
    tried: String,
    /// "ok" (the server answered /healthz), "answered" (something answered, but not a Hearth server's health page),
    /// "refused", "timeout", "dns", "tls", or "error".
    result: String,
    status: Option<u16>,
    detail: Option<String>,
}

/// The ACP address (ws/wss, any path) to the server's health page (http/https, /healthz).
fn health_url(input: &str) -> Result<reqwest::Url, String> {
    let mut t = input.trim().to_string();
    if !t.contains("://") { t = format!("ws://{t}"); }
    let mut u = reqwest::Url::parse(&t).map_err(|_| "That address doesn't look right.".to_string())?;
    let scheme = match u.scheme() { "ws" | "http" => "http", "wss" | "https" => "https", _ => return Err("The address must start with ws://, wss://, http:// or https://".into()) };
    u.set_scheme(scheme).map_err(|_| "That address doesn't look right.".to_string())?;
    u.set_path("/healthz");
    u.set_query(None);
    u.set_fragment(None);
    Ok(u)
}

fn classify(e: &reqwest::Error) -> (&'static str, String) {
    // The chain of causes says which step failed (DNS, connect, TLS).
    let mut chain = e.to_string();
    let mut src = std::error::Error::source(e);
    while let Some(s) = src { chain.push_str(": "); chain.push_str(&s.to_string()); src = s.source(); }
    let low = chain.to_lowercase();
    let kind = if e.is_timeout() { "timeout" }
        else if low.contains("dns") || low.contains("resolve") || low.contains("no such host") || low.contains("name or service not known") { "dns" }
        else if low.contains("certificate") || low.contains("tls") || low.contains("handshake") { "tls" }
        else if e.is_connect() { "refused" }
        else { "error" };
    (kind, chain.chars().take(400).collect())
}

#[tauri::command]
pub async fn guide_check_address(url: String) -> Result<AddressCheck, String> {
    let u = health_url(&url)?;
    let mut out = AddressCheck { tried: u.to_string(), ..Default::default() };
    let c = reqwest::Client::builder().timeout(Duration::from_secs(8)).connect_timeout(Duration::from_secs(6))
        .redirect(reqwest::redirect::Policy::none()).build().map_err(|e| e.to_string())?;
    match c.get(u).send().await {
        Ok(r) => {
            let status = r.status().as_u16();
            out.status = Some(status);
            out.result = if status == 200 { "ok" } else { "answered" }.into();
        }
        Err(e) => { let (k, d) = classify(&e); out.result = k.into(); out.detail = Some(d); }
    }
    Ok(out)
}

#[derive(Serialize, Debug)]
pub struct DockerCheck { installed: bool, running: bool, version: Option<String>, detail: Option<String> }

/// Is Docker installed here, and is its engine running? Runs `docker version` with a time limit.
#[tauri::command]
pub async fn guide_check_docker() -> Result<DockerCheck, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut cmd = std::process::Command::new("docker");
        cmd.args(["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"]);
        #[cfg(windows)]
        { use std::os::windows::process::CommandExt; cmd.creation_flags(0x0800_0000); } // no console window
        match cmd.output() {
            Err(_) => DockerCheck { installed: false, running: false, version: None, detail: None },
            Ok(o) => {
                let text = String::from_utf8_lossy(&o.stdout).trim().to_string();
                let err = String::from_utf8_lossy(&o.stderr).trim().chars().take(300).collect::<String>();
                let mut parts = text.splitn(2, '|');
                let client = parts.next().unwrap_or("").to_string();
                let server = parts.next().unwrap_or("").to_string();
                DockerCheck {
                    installed: true,
                    running: o.status.success() && !server.is_empty(),
                    version: Some(if server.is_empty() { client } else { server }).filter(|v| !v.is_empty()),
                    detail: if err.is_empty() { None } else { Some(err) },
                }
            }
        }
    }).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_urls() {
        assert_eq!(health_url("ws://192.168.1.20:8470/acp").unwrap().as_str(), "http://192.168.1.20:8470/healthz");
        assert_eq!(health_url("wss://ai.home.example/acp").unwrap().as_str(), "https://ai.home.example/healthz");
        assert_eq!(health_url("localhost:8470").unwrap().as_str(), "http://localhost:8470/healthz");
        assert!(health_url("ftp://x").is_err());
    }

    #[test]
    fn bases() {
        assert_eq!(clean_base(&Kind::Anthropic, "").unwrap(), "https://api.anthropic.com");
        assert_eq!(clean_base(&Kind::Openai, "http://localhost:11434/v1/").unwrap(), "http://localhost:11434/v1");
        assert!(clean_base(&Kind::Openai, "").is_err());
        assert!(clean_base(&Kind::Openai, "file:///etc").is_err());
        assert!(clean_base(&Kind::Openai, "https://user:pw@x.example/v1").is_err());
        let s = Stored { kind: Kind::Anthropic, base_url: "https://api.anthropic.com".into(), key: None };
        assert_eq!(url_for(&s, "messages"), "https://api.anthropic.com/v1/messages");
    }

    // ---------- against a fake provider ----------

    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    /// What the fake provider saw: the request line and headers (lower-cased), and the body.
    #[derive(Debug, Clone)]
    struct Seen { line: String, headers: String, body: String }

    /// A one-thread HTTP server that answers each request with the next scripted (status, body). Returns its base URL.
    fn fake(replies: Vec<(u16, &'static str)>) -> (String, Arc<Mutex<Vec<Seen>>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", l.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        std::thread::spawn(move || {
            for (status, body) in replies {
                let Ok((mut c, _)) = l.accept() else { return };
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                // Read the head, then as much body as Content-Length says.
                let (head, mut rest) = loop {
                    let n = c.read(&mut chunk).unwrap_or(0);
                    if n == 0 { break (String::from_utf8_lossy(&buf).to_string(), Vec::new()); }
                    buf.extend_from_slice(&chunk[..n]);
                    if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        break (String::from_utf8_lossy(&buf[..i]).to_string(), buf[i + 4..].to_vec());
                    }
                };
                let len = head.lines().find_map(|h| h.to_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
                while rest.len() < len { let n = c.read(&mut chunk).unwrap_or(0); if n == 0 { break; } rest.extend_from_slice(&chunk[..n]); }
                let mut lines = head.lines();
                let line = lines.next().unwrap_or("").to_string();
                log.lock().unwrap().push(Seen { line, headers: lines.collect::<Vec<_>>().join("\n").to_lowercase(), body: String::from_utf8_lossy(&rest).to_string() });
                let _ = write!(c, "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            }
        });
        (base, seen)
    }

    fn run<T>(f: impl std::future::Future<Output = T>) -> T { tauri::async_runtime::block_on(f) }

    #[test]
    fn anthropic_check_lists_models_then_sends_one_tiny_message() {
        let (base, seen) = fake(vec![
            (200, r#"{"data":[{"id":"claude-haiku-5-5"},{"id":"claude-sonnet-5-5"}]}"#),
            (200, r#"{"content":[{"type":"text","text":"OK"}],"stop_reason":"end_turn"}"#),
        ]);
        let s = Stored { kind: Kind::Anthropic, base_url: base, key: Some("test-key-anthropic".into()) };
        let models = run(check_with(&s, Some("claude-haiku-5-5"))).unwrap();
        assert_eq!(models, vec!["claude-haiku-5-5", "claude-sonnet-5-5"]);
        let seen = seen.lock().unwrap().clone();
        assert_eq!(seen[0].line, "GET /v1/models HTTP/1.1");
        assert_eq!(seen[1].line, "POST /v1/messages HTTP/1.1");
        for r in &seen {
            assert!(r.headers.contains("x-api-key: test-key-anthropic"));
            assert!(r.headers.contains("anthropic-version: 2023-06-01"));
            assert!(!r.headers.contains("authorization:"));
        }
        assert!(seen[1].body.contains(r#""model":"claude-haiku-5-5""#));
    }

    #[test]
    fn openai_style_uses_bearer_and_its_own_paths() {
        let (base, seen) = fake(vec![
            (200, r#"{"data":[{"id":"gpt-5-mini"}]}"#),
            (200, r#"{"choices":[{"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}]}"#),
        ]);
        let s = Stored { kind: Kind::Openai, base_url: format!("{base}/v1"), key: Some("test-key-openai".into()) };
        assert_eq!(run(check_with(&s, None)).unwrap(), vec!["gpt-5-mini"]);
        let v = run(call_with(&s, &serde_json::json!({ "model": "gpt-5-mini", "messages": [] }), 10)).unwrap();
        assert_eq!(v.pointer("/choices/0/message/content").and_then(|c| c.as_str()), Some("hi"));
        let seen = seen.lock().unwrap().clone();
        assert_eq!(seen[0].line, "GET /v1/models HTTP/1.1");
        assert_eq!(seen[1].line, "POST /v1/chat/completions HTTP/1.1");
        assert!(seen.iter().all(|r| r.headers.contains("authorization: bearer test-key-openai") && !r.headers.contains("x-api-key")));
    }

    #[test]
    fn local_model_sends_no_key() {
        let (base, seen) = fake(vec![(200, r#"{"data":[{"id":"llama3.2:3b"}]}"#)]);
        let s = Stored { kind: Kind::Openai, base_url: format!("{base}/v1"), key: None };
        assert_eq!(run(check_with(&s, None)).unwrap(), vec!["llama3.2:3b"]);
        assert!(!seen.lock().unwrap()[0].headers.contains("authorization:"));
    }

    #[test]
    fn provider_failures_in_plain_words() {
        let (base, _) = fake(vec![
            (401, r#"{"error":{"type":"authentication_error","message":"invalid x-api-key"}}"#),
            (200, r#"{"data":[{"id":"m"}]}"#),
            (400, r#"{"error":{"message":"Your credit balance is too low to access the API."}}"#),
            (429, r#"{"error":{"message":"rate limited"}}"#),
            (200, "<html>not an api</html>"),
            (200, r#"{"data":[]}"#),
        ]);
        let s = Stored { kind: Kind::Anthropic, base_url: base, key: Some("k".into()) };
        assert!(run(check_with(&s, None)).unwrap_err().starts_with("That key was refused."));
        assert!(run(check_with(&s, Some("m"))).unwrap_err().starts_with("That account has no credit left."));
        assert!(run(call_with(&s, &serde_json::json!({}), 10)).unwrap_err().starts_with("The provider is busy"));
        assert_eq!(run(check_with(&s, None)).unwrap_err(), "That address answered, but not with an API reply.");
        assert_eq!(run(check_with(&s, None)).unwrap_err(), "That address answered, but listed no models.");
    }

    #[test]
    fn nothing_listening() {
        // Bind and drop: the port is free, so the connection is refused.
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let s = Stored { kind: Kind::Openai, base_url: format!("http://127.0.0.1:{port}/v1"), key: None };
        assert_eq!(run(check_with(&s, None)).unwrap_err(), "Nothing answered at that address.");
        let a = run(guide_check_address(format!("ws://127.0.0.1:{port}/acp"))).unwrap();
        assert_eq!(a.result, "refused");
    }

    #[test]
    fn address_check_reads_healthz() {
        let (base, seen) = fake(vec![(200, r#"{"ok":true}"#), (404, "")]);
        let addr = base.replace("http://", "ws://") + "/acp";
        assert_eq!(run(guide_check_address(addr.clone())).unwrap().result, "ok");
        let other = run(guide_check_address(addr)).unwrap();
        assert_eq!((other.result.as_str(), other.status), ("answered", Some(404)));
        assert_eq!(seen.lock().unwrap()[0].line, "GET /healthz HTTP/1.1");
    }

    /// The real keychain flow, end to end against the fake provider: check (stores), status (no key shown), a call with
    /// the stored key, a re-check with a blank key (reuses it), forget. Left alone if a real guide key is saved here.
    #[test]
    fn keychain_flow_with_a_fake_provider() {
        if load().ok().flatten().is_some() { eprintln!("skipped: a guide key is already saved on this machine"); return; }
        let (base, seen) = fake(vec![
            (200, r#"{"data":[{"id":"fake-mini"}]}"#),
            (200, r#"{"choices":[{"message":{"content":"OK"},"finish_reason":"stop"}]}"#),
            (200, r#"{"choices":[{"message":{"content":"hello"},"finish_reason":"stop"}]}"#),
            (200, r#"{"data":[{"id":"fake-mini"}]}"#),
        ]);
        let url = format!("{base}/v1/");
        let checked = run(guide_check(Kind::Openai, url.clone(), Some(" test-guide-key ".into()), Some("fake-mini".into())));
        let result = (|| -> Result<(), String> {
            assert_eq!(checked?.models, vec!["fake-mini"]);
            let st = guide_status()?.expect("stored");
            assert!(!serde_json::to_string(&st).unwrap().contains("test-guide-key"), "status must never carry the key");
            assert_eq!((st.kind, st.base_url.as_str(), st.has_key), (Kind::Openai, format!("{base}/v1").as_str(), true));
            let v = run(guide_call(serde_json::json!({ "model": "fake-mini", "messages": [] })))?;
            assert_eq!(v.pointer("/choices/0/message/content").and_then(|c| c.as_str()), Some("hello"));
            run(guide_check(Kind::Openai, url, None, None))?; // blank key: the saved one is reused
            Ok(())
        })();
        guide_forget().unwrap();
        result.unwrap();
        assert!(guide_status().unwrap().is_none());
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 4);
        assert!(seen.iter().all(|r| r.headers.contains("authorization: bearer test-guide-key")), "the key is trimmed and sent on every call");
    }

    #[test]
    fn plain_errors() {
        assert_eq!(plain_error(401, "{}"), "That key was refused.");
        assert!(plain_error(400, r#"{"error":{"message":"Your credit balance is too low"}}"#).starts_with("That account has no credit left."));
        assert!(plain_error(503, "oops").starts_with("The provider had a problem."));
    }
}
