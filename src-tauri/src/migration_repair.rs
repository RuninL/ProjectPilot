use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha384};
use tauri::AppHandle;

use crate::atomic::db_path;
use crate::backup::{
    copy_database, migration_failure_path, pre_migration_checksum_path, validate_database,
    validate_sqlite_file,
};
use crate::error::{CommandError, CommandResult};

const CURRENT_MIGRATION_COUNT: i64 = 12;

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
    (
        12,
        include_str!("../migrations/0012_v13_productivity.sql"),
    ),
];

#[derive(Debug, Serialize)]
pub struct MigrationChecksumRepair {
    pub repaired: bool,
    pub backup_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MigrationFailureRecovery {
    pub archived_path: String,
    pub snapshot_path: Option<String>,
}

fn current_migration_checksums() -> Vec<(i64, Vec<u8>)> {
    CURRENT_MIGRATIONS
        .iter()
        .map(|(version, source)| (*version, Sha384::digest(source.as_bytes()).to_vec()))
        .collect()
}

/// Return the applied prefix only when it is continuous, successful and known.
/// A valid database from an older release is intentionally allowed to have a
/// short prefix: sqlx can then apply the later migrations normally.
fn applied_migration_versions(connection: &Connection) -> CommandResult<Vec<i64>> {
    let migration_table_exists: i64 = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations')",
        [],
        |row| row.get(0),
    )?;
    if migration_table_exists == 0 {
        return Ok(Vec::new());
    }

    let mut statement =
        connection.prepare("SELECT version, success FROM _sqlx_migrations ORDER BY version ASC")?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, bool>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (index, (version, success)) in rows.iter().enumerate() {
        let expected_version = index as i64 + 1;
        if *version != expected_version || *version > CURRENT_MIGRATION_COUNT || !success {
            return Err(CommandError::Invalid(
                "migration history is not a complete successful prefix; checksum repair was not applied".into(),
            ));
        }
    }
    Ok(rows.into_iter().map(|(version, _)| version).collect())
}

pub(crate) fn reconcile_database(path: &Path) -> CommandResult<MigrationChecksumRepair> {
    if !path.exists() {
        return Ok(MigrationChecksumRepair {
            repaired: false,
            backup_path: None,
        });
    }

    let verified = validate_sqlite_file(path)?;
    let applied_versions = applied_migration_versions(&verified)?;
    if applied_versions.len() == CURRENT_MIGRATION_COUNT as usize {
        // A current database must still satisfy the full schema whitelist
        // before changing metadata for an old development checksum.
        validate_database(path)?;
    }
    let mismatches = current_migration_checksums()
        .into_iter()
        .filter(|(version, _)| applied_versions.contains(version))
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

fn sibling_with_suffix(path: &Path, suffix: &str) -> CommandResult<PathBuf> {
    let file_name = path
        .file_name()
        .ok_or_else(|| CommandError::Path("database path has no file name".into()))?;
    Ok(path.with_file_name(format!("{}{suffix}", file_name.to_string_lossy())))
}

/// Preserve a database that sqlx cannot migrate, then leave the default path
/// empty so the application can create and run against a clean local database.
pub(crate) fn isolate_failed_database(path: &Path) -> CommandResult<MigrationFailureRecovery> {
    if !path.exists() {
        return Err(CommandError::Invalid(
            "migration recovery requires an existing database file".into(),
        ));
    }

    let archived_path = migration_failure_path(path)?;
    let snapshot_path = sibling_with_suffix(&archived_path, ".snapshot")?;
    let snapshot = Connection::open(path).ok().and_then(|source| {
        copy_database(&source, &snapshot_path)
            .ok()
            .map(|_| snapshot_path.clone())
    });

    std::fs::rename(path, &archived_path)?;
    for suffix in ["-wal", "-shm"] {
        let sidecar = sibling_with_suffix(path, suffix)?;
        if sidecar.exists() {
            let archived_sidecar = sibling_with_suffix(&archived_path, suffix)?;
            let _ = std::fs::rename(sidecar, archived_sidecar);
        }
    }

    Ok(MigrationFailureRecovery {
        archived_path: archived_path.to_string_lossy().into_owned(),
        snapshot_path: snapshot.map(|value| value.to_string_lossy().into_owned()),
    })
}

#[tauri::command]
pub fn reconcile_migration_checksum(app: AppHandle) -> CommandResult<MigrationChecksumRepair> {
    reconcile_database(&db_path(&app)?)
}

#[tauri::command]
pub fn isolate_failed_migration_database(
    app: AppHandle,
) -> CommandResult<MigrationFailureRecovery> {
    isolate_failed_database(&db_path(&app)?)
}

#[cfg(test)]
mod tests {
    use super::{current_migration_checksums, isolate_failed_database, reconcile_database};
    use rusqlite::{params, Connection};
    use std::path::Path;

    fn create_database_with_history(
        path: &std::path::Path,
        applied_versions: &[i64],
        mismatched_versions: &[i64],
    ) {
        let connection = Connection::open(path).expect("test database should open");
        if applied_versions.len() == 11 {
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
        }
        connection
            .execute(
                "CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY, success INTEGER NOT NULL, checksum BLOB NOT NULL)",
                [],
            )
            .expect("migration table should be created");
        for (version, expected_checksum) in current_migration_checksums()
            .into_iter()
            .filter(|(version, _)| applied_versions.contains(version))
        {
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
    fn backs_up_and_repairs_changed_metadata_for_a_current_complete_history() {
        let path = std::env::temp_dir().join(format!(
            "projectpilot-checksum-repair-{}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        create_database_with_history(&path, &(1..=11).collect::<Vec<_>>(), &[1, 2]);

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

    #[test]
    fn repairs_a_valid_partial_history_without_blocking_a_normal_upgrade() {
        let path = std::env::temp_dir().join(format!(
            "projectpilot-partial-checksum-repair-{}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        create_database_with_history(&path, &[1, 2], &[2]);

        let repaired = reconcile_database(&path).expect("partial history should be repaired");
        assert!(repaired.repaired);

        let _ = std::fs::remove_file(&path);
        if let Some(backup) = repaired.backup_path {
            let _ = std::fs::remove_file(backup);
        }
    }

    #[test]
    fn isolates_an_unmigratable_database_without_deleting_it() {
        let path = std::env::temp_dir().join(format!(
            "projectpilot-migration-failure-{}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        Connection::open(&path)
            .expect("fixture database should open")
            .execute("CREATE TABLE preserved_data (id TEXT)", [])
            .expect("fixture table should be created");

        let recovery = isolate_failed_database(&path).expect("database should be isolated");
        assert!(!path.exists());
        assert!(Path::new(&recovery.archived_path).is_file());
        assert!(recovery
            .snapshot_path
            .as_deref()
            .is_some_and(|value| Path::new(value).is_file()));

        let _ = std::fs::remove_file(recovery.archived_path);
        if let Some(snapshot) = recovery.snapshot_path {
            let _ = std::fs::remove_file(snapshot);
        }
    }
}
