use std::path::Path;

use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha384};
use tauri::AppHandle;

use crate::atomic::db_path;
use crate::backup::{copy_database, pre_migration_checksum_path, validate_database};
use crate::error::{CommandError, CommandResult};

const CURRENT_MIGRATION_COUNT: i64 = 11;

const CURRENT_MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../migrations/0001_init.sql")),
    (2, include_str!("../migrations/0002_task_lifecycle.sql")),
    (3, include_str!("../migrations/0003_task_dependencies.sql")),
    (
        4,
        include_str!("../migrations/0004_meetings_action_items.sql"),
    ),
    (5, include_str!("../migrations/0005_dashboard_risks.sql")),
    (
        6,
        include_str!("../migrations/0006_project_links_description.sql"),
    ),
    (7, include_str!("../migrations/0007_people.sql")),
    (
        8,
        include_str!("../migrations/0008_postponed_people_fields.sql"),
    ),
    (9, include_str!("../migrations/0009_recurrence_rules.sql")),
    (
        10,
        include_str!("../migrations/0010_recurrence_standalone_meetings.sql"),
    ),
    (
        11,
        include_str!("../migrations/0011_recurrence_exceptions_reschedule.sql"),
    ),
];

#[derive(Debug, Serialize)]
pub struct MigrationChecksumRepair {
    pub repaired: bool,
    pub backup_path: Option<String>,
}

fn current_migration_checksums() -> Vec<(i64, Vec<u8>)> {
    CURRENT_MIGRATIONS
        .iter()
        .map(|(version, source)| (*version, Sha384::digest(source.as_bytes()).to_vec()))
        .collect()
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
    let mismatches = current_migration_checksums()
        .into_iter()
        .map(|(version, expected_checksum)| {
            let stored_checksum: Vec<u8> = verified.query_row(
                "SELECT checksum FROM _sqlx_migrations WHERE version = ?1 AND success = 1",
                [version],
                |row| row.get(0),
            )?;
            Ok((version, expected_checksum, stored_checksum))
        })
        .collect::<CommandResult<Vec<_>>>()?
        .into_iter()
        .filter_map(|(version, expected_checksum, stored_checksum)| {
            (stored_checksum != expected_checksum).then_some((version, expected_checksum))
        })
        .collect::<Vec<_>>();
    if mismatches.is_empty() {
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
    let changed = mismatches
        .iter()
        .try_fold(0usize, |count, (version, checksum)| {
            transaction
                .execute(
                    "UPDATE _sqlx_migrations SET checksum = ?1 WHERE version = ?2 AND success = 1",
                    params![checksum, version],
                )
                .map(|updated| count + updated)
        })?;
    if changed != mismatches.len() {
        return Err(CommandError::Invalid(
            "migration metadata was not fully updated; database was left unchanged".into(),
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
    use super::{current_migration_checksums, reconcile_database};
    use rusqlite::{params, Connection};
    use std::path::Path;

    fn create_current_database(path: &std::path::Path, mismatched_versions: &[i64]) {
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
        for (version, expected_checksum) in current_migration_checksums() {
            let checksum = if mismatched_versions.contains(&version) {
                vec![0; 48]
            } else {
                expected_checksum
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
    fn backs_up_and_repairs_changed_metadata_for_the_current_complete_history() {
        let path = std::env::temp_dir().join(format!(
            "projectpilot-checksum-repair-{}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        create_current_database(&path, &[1, 2]);

        let repaired = reconcile_database(&path).expect("checksum should be repaired safely");
        assert!(repaired.repaired);
        assert!(repaired
            .backup_path
            .as_deref()
            .is_some_and(|value| Path::new(value).is_file()));
        let connection = Connection::open(&path).expect("repaired database should open");
        let checksum: Vec<u8> = connection
            .query_row(
                "SELECT checksum FROM _sqlx_migrations WHERE version = 2",
                [],
                |row| row.get(0),
            )
            .expect("checksum should be readable");
        let expected = current_migration_checksums()
            .into_iter()
            .find_map(|(version, checksum)| (version == 2).then_some(checksum))
            .expect("migration 2 checksum should exist");
        assert_eq!(checksum, expected);

        let _ = std::fs::remove_file(&path);
        if let Some(backup) = repaired.backup_path {
            let _ = std::fs::remove_file(backup);
        }
    }
}
