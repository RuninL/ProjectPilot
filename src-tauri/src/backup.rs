use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::backup::Backup;
use rusqlite::{Connection, OpenFlags};
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

fn open_read_only(path: &Path) -> CommandResult<Connection> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| CommandError::Invalid("所选文件不是有效的 SQLite 数据库".into()))
}

pub(crate) fn validate_database(path: &Path) -> CommandResult<Connection> {
    if !path.is_file() {
        return Err(CommandError::Invalid("数据库文件不存在".into()));
    }
    let conn = open_read_only(path)?;
    let check: String = conn
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|_| CommandError::Invalid("所选文件不是有效的 SQLite 数据库".into()))?;
    if check != "ok" {
        return Err(CommandError::Invalid(format!(
            "数据库完整性检查失败：{check}"
        )));
    }
    let required = [
        "projects",
        "tasks",
        "task_dependencies",
        "milestones",
        "meetings",
        "action_items",
        "project_links",
        "app_settings",
        "risks",
        "people",
        "project_participants",
        "task_participants",
        "recurrence_rules",
        "recurrence_exceptions",
    ];
    for table in required {
        let exists: i64 = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                [table],
                |row| row.get(0),
            )
            .map_err(|_| CommandError::Invalid("无法读取数据库结构".into()))?;
        if exists != 1 {
            return Err(CommandError::Invalid(format!(
                "数据库缺少必要的数据表：{table}"
            )));
        }
    }
    Ok(conn)
}

pub(crate) fn copy_database(source: &Connection, destination: &Path) -> CommandResult<()> {
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut target = Connection::open(destination)?;
    target.busy_timeout(Duration::from_secs(5))?;
    let backup = Backup::new(source, &mut target)?;
    backup.run_to_completion(64, Duration::from_millis(25), None)?;
    Ok(())
}

pub(crate) fn pre_restore_path(database: &Path) -> CommandResult<PathBuf> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| CommandError::Invalid(e.to_string()))?
        .as_secs();
    Ok(database.with_file_name(format!("projectpilot-pre-restore-{timestamp}.db")))
}

pub(crate) fn pre_migration_checksum_path(database: &Path) -> CommandResult<PathBuf> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| CommandError::Invalid(e.to_string()))?
        .as_secs();
    Ok(database.with_file_name(format!(
        "projectpilot-pre-migration-checksum-{timestamp}.db"
    )))
}

/// Create a consistent SQLite online backup at `dest_path`.
#[tauri::command]
pub fn backup_database(app: AppHandle, dest_path: String) -> CommandResult<String> {
    let src = db_path(&app)?;
    if !src.exists() {
        return Err(CommandError::Invalid("数据库文件不存在".into()));
    }
    let destination = PathBuf::from(&dest_path);
    if destination == src {
        return Err(CommandError::Invalid("备份路径不能是当前数据库文件".into()));
    }
    let source = Connection::open(&src)?;
    copy_database(&source, &destination)?;
    Ok(dest_path)
}

/// Validate and restore a database through SQLite's online-backup API.
/// The current database is first saved to a timestamped safety copy.
#[tauri::command]
pub fn restore_database(app: AppHandle, src_path: String) -> CommandResult<String> {
    let dst = db_path(&app)?;
    let source_path = PathBuf::from(&src_path);
    if source_path == dst {
        return Err(CommandError::Invalid("不能从当前数据库文件还原".into()));
    }
    let source = validate_database(&source_path)?;
    if dst.exists() {
        let current = Connection::open(&dst)?;
        copy_database(&current, &pre_restore_path(&dst)?)?;
    }
    copy_database(&source, &dst)?;
    Ok(dst.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::validate_database;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn rejects_non_sqlite_restore_file() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("projectpilot-invalid-{suffix}.db"));
        std::fs::write(&path, b"not a sqlite database").expect("fixture should be writable");

        let result = validate_database(&path);
        std::fs::remove_file(path).expect("fixture should be removable");

        assert!(result.is_err());
    }
}
