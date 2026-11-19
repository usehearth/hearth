// Hearth desktop shell. The app is the same web UI; the shell adds one thing the web can't do safely:
// keeping each server's device key in the operating system's keychain (Windows Credential Manager,
// macOS Keychain, Secret Service on Linux). Keys never touch Hearth's own files, and chat content is never stored.

mod guide;
mod import;

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

// ---------- admin key (admin threads, docs: monolith app-design 5a) ----------
// One Ed25519 key per install, made once, kept in the keychain like the device keys. Its public key is pinned by hand in
// the laptop runner's admin.json; the runner then runs an admin thread's prompts and card answers only when this key
// signed them. The secret never leaves the keychain and this process; the web view gets signatures only, and only over
// Hearth's own admin messages.
const ADMIN_ENTRY: &str = "admin-key";
const ADMIN_PREFIX: &str = "hearth-admin-v1\n";

fn admin_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ADMIN_ENTRY).map_err(|e| e.to_string())
}

fn admin_secret() -> Result<Option<ed25519_dalek::SigningKey>, String> {
    use base64::Engine;
    match admin_entry()?.get_password() {
        Ok(s) => {
            let bytes = base64::engine::general_purpose::STANDARD.decode(s.trim()).map_err(|_| "admin key is damaged".to_string())?;
            let seed: [u8; 32] = bytes.try_into().map_err(|_| "admin key is damaged".to_string())?;
            Ok(Some(ed25519_dalek::SigningKey::from_bytes(&seed)))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn public_of(k: &ed25519_dalek::SigningKey) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(k.verifying_key().to_bytes())
}

/// The admin key's public half (base64 of 32 bytes), or none if this install has no admin key.
#[tauri::command]
fn admin_key_public() -> Result<Option<String>, String> {
    Ok(admin_secret()?.map(|k| public_of(&k)))
}

/// Make the admin key (once). Refuses to replace an existing one: a new key must be pinned again by hand.
#[tauri::command]
fn admin_key_create() -> Result<String, String> {
    use base64::Engine;
    if let Some(k) = admin_secret()? { return Ok(public_of(&k)); }
    let mut seed = [0u8; 32];
    getrandom::getrandom(&mut seed).map_err(|e| e.to_string())?;
    let k = ed25519_dalek::SigningKey::from_bytes(&seed);
    admin_entry()?.set_password(&base64::engine::general_purpose::STANDARD.encode(seed)).map_err(|e| e.to_string())?;
    Ok(public_of(&k))
}

/// Sign one admin message ("hearth-admin-v1 / kind / thread / digest / time / counter", one per line). Nothing else is signed.
#[tauri::command]
fn admin_sign(message: String) -> Result<String, String> {
    if !message.starts_with(ADMIN_PREFIX) || message.len() > 512 || message.split('\n').count() != 6 {
        return Err("not an admin message".into());
    }
    let k = admin_secret()?.ok_or("this install has no admin key")?;
    Ok(sign_with(&k, &message))
}

fn sign_with(k: &ed25519_dalek::SigningKey, message: &str) -> String {
    use base64::Engine;
    use ed25519_dalek::Signer;
    base64::engine::general_purpose::STANDARD.encode(k.sign(message.as_bytes()).to_bytes())
}

/// Release builds: look for a newer signed release once at start; install it in the background and say so (the new
/// version runs from the next start). Any failure is quiet: the app works the same without it.
#[cfg(feature = "updater")]
fn check_for_update(app: tauri::AppHandle) {
    use tauri_plugin_notification::NotificationExt;
    use tauri_plugin_updater::UpdaterExt;
    tauri::async_runtime::spawn(async move {
        let Ok(updater) = app.updater() else { return };
        let Ok(Some(update)) = updater.check().await else { return };
        let version = update.version.clone();
        if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
            let _ = app.notification().builder().title("Hearth updated")
                .body(format!("Version {version} is ready. Restart Hearth to use it.")).show();
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(feature = "updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .setup(|_app| {
            #[cfg(feature = "updater")]
            check_for_update(_app.handle().clone());
            Ok(())
        })
        .manage(import::Scanned::default())
        .invoke_handler(tauri::generate_handler![key_get, key_set, key_delete, admin_key_public, admin_key_create, admin_sign, import::import_sources, import::import_scan, import::import_read, import::import_config,
            guide::guide_check, guide::guide_status, guide::guide_call, guide::guide_forget, guide::guide_check_address, guide::guide_check_docker])
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

    // The same key and message as the runner's test vector (monolith runner/src/admin.ts signedText): Ed25519 is
    // deterministic, so the bytes must match what the runner verifies.
    #[test]
    fn admin_signature_matches_the_runner() {
        let seed: [u8; 32] = core::array::from_fn(|i| (i + 1) as u8);
        let k = ed25519_dalek::SigningKey::from_bytes(&seed);
        assert_eq!(public_of(&k), "ebVWLo/mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ=");
        let msg = "hearth-admin-v1\nprompt\n11111111-2222-3333-4444-555555555555\n256b6b57ce64c1384e44f872b53ab13a7233ef9f7cc75ab105db5b34d22da90f\n1700000000000\n1700000000001";
        assert_eq!(sign_with(&k, msg), "wcmzUipJyZC9ZF+3wBs7RFwtmdTvz7rIhdfseNK6FBtl2BkxJRy6ktRqJZAFK7lxE299oQKV3T190b39Qsa7Bg==");
    }

    #[test]
    fn admin_sign_refuses_anything_but_admin_messages() {
        assert!(admin_sign("hello".into()).is_err());
        assert!(admin_sign("hearth-admin-v1\nprompt\nx".into()).is_err());
    }

    #[test]
    fn refuses_odd_ids_and_keys() {
        assert!(key_get("../other-app".into()).is_err());
        assert!(key_set("00000000-0000-0000-0000-0000000000ff".into(), String::new()).is_err());
    }
}
