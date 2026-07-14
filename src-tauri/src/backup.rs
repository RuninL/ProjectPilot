use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::atomic::db_path;
use crate::error::{CommandError, CommandResult};

/// Return the absolute path of the SQLite database file (for the settings page).
#[tauri::command]
pub fn get_db_path(app: AppHandle) -> CommandResult<String> {
    Ok(db_path(&app)?.to_string_lossy().into_owned())
}

/// Open the app data directory in the OS file manager.
#[tauri::command]
pub fn open_data_dir(app: AppHandle) -> CommandResult<()> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| CommandError::Path(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| CommandError::Invalid(e.to_string()))?;
    Ok(())
}

/// Copy the live database to `dest_path`. Phase 1 stub: plain file copy.
/// Phase 6 will add SQLite online-backup semantics, WAL checkpointing and file locking.
#[tauri::command]
pub fn backup_database(app: AppHandle, dest_path: String) -> CommandResult<String> {
    let src = db_path(&app)?;
    if !src.exists() {
        return Err(CommandError::Invalid("database file does not exist".into()));
    }
    std::fs::copy(&src, &dest_path)?;
    Ok(dest_path)
}

/// Restore the database from `src_path`. Phase 1 stub: auto pre-backup then overwrite.
/// Phase 6 will close the pooled connection first and re-open afterwards; here we only
/// guarantee the pre-backup + copy so the shape of the command is stable for the frontend.
#[tauri::command]
pub fn restore_database(app: AppHandle, src_path: String) -> CommandResult<String> {
    let dst = db_path(&app)?;
    if !std::path::Path::new(&src_path).exists() {
        return Err(CommandError::Invalid("backup file does not exist".into()));
    }
    if dst.exists() {
        let pre_backup = dst.with_extension("db.pre-restore");
        std::fs::copy(&dst, &pre_backup)?;
    }
    std::fs::copy(&src_path, &dst)?;
    Ok(dst.to_string_lossy().into_owned())
}
