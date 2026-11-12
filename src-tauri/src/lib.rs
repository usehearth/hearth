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

#[cfg(test)]
mod tests {
    use super::*;

    // Round trip through the real OS keychain with a throwaway entry, then remove it.
    #[test]
    fn keychain_round_trip() {
        let id = String::from("00000000-0000-0000-0000-0000000000ff");
        key_delete(id.clone()).unwrap();
        assert_eq!(key_get(id.clone()).unwrap(), None);
        key_set(id.clone(), "test-value-not-a-real-key".into()).unwrap();
        assert_eq!(key_get(id.clone()).unwrap().as_deref(), Some("test-value-not-a-real-key"));
        key_delete(id.clone()).unwrap();
        assert_eq!(key_get(id).unwrap(), None);
    }

    #[test]
    fn refuses_odd_ids_and_keys() {
        assert!(key_get("../other-app".into()).is_err());
        assert!(key_set("00000000-0000-0000-0000-0000000000ff".into(), String::new()).is_err());
    }
}
