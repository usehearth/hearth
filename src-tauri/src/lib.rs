// Hearth desktop shell. The app is the same web UI; the shell adds one thing the web can't do safely:
// keeping each server's device key in the operating system's keychain (Windows Credential Manager,
// macOS Keychain, Secret Service on Linux). Keys never touch Hearth's own files, and chat content is never stored.

const SERVICE: &str = "dev.usehearth.hearth";

fn entry(server_id: &str) -> Result<keyring::Entry, String> {
    // Server ids are UUIDs made by the app; refuse anything else so the keychain only holds Hearth's own entries.
    if server_id.len() > 64 || !server_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("bad server id".into());
    }
    keyring::Entry::new(SERVICE, server_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn key_get(server_id: String) -> Result<Option<String>, String> {
    match entry(&server_id)?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn key_set(server_id: String, key: String) -> Result<(), String> {
    if key.is_empty() || key.len() > 512 {
        return Err("bad key".into());
    }
    entry(&server_id)?.set_password(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn key_delete(server_id: String) -> Result<(), String> {
    match entry(&server_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![key_get, key_set, key_delete])
        .run(tauri::generate_context!())
        .expect("error while running Hearth");
}
