use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::backup::{pre_restore_path, validate_database};

const REQUIRED_TABLES: [&str; 12] = [
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
];

fn temp_path(label: &str) -> std::path::PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be valid")
        .as_nanos();
    std::env::temp_dir().join(format!("projectpilot-{label}-{nonce}.db"))
}

fn create_database(path: &Path, tables: &[&str]) -> Connection {
    let connection = Connection::open(path).expect("test database should open");
    for table in tables {
        connection
            .execute(&format!("CREATE TABLE {table} (id TEXT PRIMARY KEY)"), [])
            .expect("required table should be created");
    }
    connection
}

#[test]
fn rejects_valid_sqlite_missing_required_table_with_chinese_error() {
    let path = temp_path("missing-table");
    let connection = create_database(&path, &REQUIRED_TABLES[..11]);
    drop(connection);

    let error = validate_database(&path).expect_err("incomplete schema must be rejected");

    assert!(error.to_string().contains("数据库缺少必要的数据表"));
    std::fs::remove_file(path).expect("test database should be removable");
}

#[test]
fn rejects_database_when_quick_check_fails() {
    let path = temp_path("quick-check");
    let connection = create_database(&path, &REQUIRED_TABLES);
    connection
        .execute_batch(
            "PRAGMA writable_schema = ON;
             UPDATE sqlite_master SET rootpage = 999999 WHERE name = 'projects';
             PRAGMA writable_schema = OFF;",
        )
        .expect("test schema should be corruptible");
    drop(connection);

    let error = validate_database(&path).expect_err("corrupt database must be rejected");

    assert!(
        error.to_string().contains("数据库完整性检查失败")
            || error
                .to_string()
                .contains("所选文件不是有效的 SQLite 数据库")
    );
    std::fs::remove_file(path).expect("test database should be removable");
}

#[test]
fn accepts_valid_database_with_all_required_tables() {
    let path = temp_path("complete-schema");
    let connection = create_database(&path, &REQUIRED_TABLES);
    drop(connection);

    let validated = validate_database(&path).expect("complete database should pass");

    drop(validated);
    std::fs::remove_file(path).expect("test database should be removable");
}

#[test]
fn pre_restore_filename_contains_unix_timestamp() {
    let path = pre_restore_path(Path::new("/tmp/projectpilot.db"))
        .expect("pre-restore path should be generated");
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .expect("filename should be UTF-8");
    let timestamp = filename
        .strip_prefix("projectpilot-pre-restore-")
        .and_then(|value| value.strip_suffix(".db"))
        .expect("filename should use the documented format");

    assert!(timestamp.parse::<u64>().is_ok());
}
