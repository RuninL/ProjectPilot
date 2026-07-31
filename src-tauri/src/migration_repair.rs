use std::path::Path;

use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha384};
use tauri::AppHandle;

use crate::atomic::db_path;
use crate::backup::{copy_database, pre_migration_checksum_path, validate_database};
use crate::error::{CommandError, CommandResult};

const CURRENT_MIGRATION_COUNT: i64 = 11;

#[derive(Debug, Serialize)]
pub struct MigrationChecksumRepair {
    pub repaired: bool,
    pub backup_path: Option<String>,
}

fn migration_one_checksum() -> Vec<u8> {
    Sha384::digest(include_str!("../migrations/0001_init.sql").as_bytes()).to_vec()
}

fn validated_complete_history(connection: &Connection) -> CommandResult<()> {
    let successful_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM _sqlx_migrations WHERE success = 1 AND version BETWEEN 1 AND ?1",
        [CURRENT_MIGRATION_COUNT],
        |row| row.get(0),
    )?;
    let total_successful: i64 = connection.query_row(
        "SELECT COUNT(*) FROM _sqlx_migrations WHERE success = 1",
        [],
        |row| row.get(0),
    )?;
    if successful_count != CURRENT_MIGRATION_COUNT || total_successful != CURRENT_MIGRATION_COUNT {
        return Err(CommandError::Invalid(
            "migration history is incomplete; checksum repair was not applied".into(),
        ));
    }
    Ok(())
}

pub(crate) fn reconcile_database(path: &Path) -> CommandResult<MigrationChecksumRepair> {
    if !path.exists() {
        return Ok(MigrationChecksumRepair {
            repaired: false,
            backup_path: None,
        });
    }

    let verified = validate_database(path)?;
    validated_complete_history(&verified)?;
    let stored_checksum: Vec<u8> = verified.query_row(
        "SELECT checksum FROM _sqlx_migrations WHERE version = 1 AND success = 1",
        [],
        |row| row.get(0),
    )?;
    let expected_checksum = migration_one_checksum();
    if stored_checksum == expected_checksum {
        return Ok(MigrationChecksumRepair {
            repaired: false,
            backup_path: None,
        });
    }

    let backup_path = pre_migration_checksum_path(path)?;
    copy_database(&verified, &backup_path)?;
    drop(verified);

    let mut writable = Connection::open(path)?;
    let transaction = writable.transaction()?;
    let changed = transaction.execute(
        "UPDATE _sqlx_migrations SET checksum = ?1 WHERE version = 1 AND success = 1",
        params![expected_checksum],
    )?;
    if changed != 1 {
        return Err(CommandError::Invalid(
            "migration 1 metadata was not updated; database was left unchanged".into(),
        ));
    }
    transaction.commit()?;

    Ok(MigrationChecksumRepair {
        repaired: true,
        backup_path: Some(backup_path.to_string_lossy().into_owned()),
    })
}

#[tauri::command]
pub fn reconcile_migration_checksum(app: AppHandle) -> CommandResult<MigrationChecksumRepair> {
    reconcile_database(&db_path(&app)?)
}

#[cfg(test)]
mod tests {
    use super::{migration_one_checksum, reconcile_database};
    use rusqlite::{params, Connection};
    use std::path::Path;

    fn create_current_database(path: &std::path::Path) {
        let connection = Connection::open(path).expect("test database should open");
        for table in [
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
        ] {
            connection
                .execute(&format!("CREATE TABLE {table} (id TEXT)"), [])
                .expect("required table should be created");
        }
        connection
            .execute(
                "CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY, success INTEGER NOT NULL, checksum BLOB NOT NULL)",
                [],
            )
            .expect("migration table should be created");
        for version in 1..=11 {
            let checksum = if version == 1 {
                vec![0; 48]
            } else {
                vec![version as u8]
            };
            connection
                .execute(
                    "INSERT INTO _sqlx_migrations (version, success, checksum) VALUES (?1, 1, ?2)",
                    params![version, checksum],
                )
                .expect("migration metadata should be inserted");
        }
    }

    #[test]
    fn backs_up_and_repairs_only_the_current_complete_history() {
        let path = std::env::temp_dir().join(format!(
            "projectpilot-checksum-repair-{}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        create_current_database(&path);

        let repaired = reconcile_database(&path).expect("checksum should be repaired safely");
        assert!(repaired.repaired);
        assert!(repaired
            .backup_path
            .as_deref()
            .is_some_and(|value| Path::new(value).is_file()));
        let connection = Connection::open(&path).expect("repaired database should open");
        let checksum: Vec<u8> = connection
            .query_row(
                "SELECT checksum FROM _sqlx_migrations WHERE version = 1",
                [],
                |row| row.get(0),
            )
            .expect("checksum should be readable");
        assert_eq!(checksum, migration_one_checksum());

        let _ = std::fs::remove_file(&path);
        if let Some(backup) = repaired.backup_path {
            let _ = std::fs::remove_file(backup);
        }
    }
}
