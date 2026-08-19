use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha384};
use tauri_plugin_sql::{Migration, MigrationKind};

const V1_2_LAST_MIGRATION: i64 = 11;

// v1.00 embedded LF bytes, while the v1.2.0 Windows build embedded CRLF bytes.
// Keep both official histories strict without changing any user's SQLx metadata.
fn release_v1_2_sql(sql: &'static str) -> &'static str {
    Box::leak(sql.replace('\n', "\r\n").into_boxed_str())
}

fn uses_release_v1_2_line_endings(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let Ok(connection) = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return false;
    };
    let has_history = connection
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM sqlite_master
               WHERE type = 'table' AND name = '_sqlx_migrations'
             )",
            [],
            |row| row.get::<_, bool>(0),
        )
        .unwrap_or(false);
    if !has_history {
        return false;
    }
    let Ok(stored_checksum) = connection.query_row(
        "SELECT checksum FROM _sqlx_migrations WHERE version = 1 AND success = 1",
        [],
        |row| row.get::<_, Vec<u8>>(0),
    ) else {
        return false;
    };
    let release_sql = include_str!("../migrations/0001_init.sql").replace('\n', "\r\n");
    stored_checksum == Sha384::digest(release_sql.as_bytes()).as_slice()
}

/// All schema migrations, applied in order by tauri-plugin-sql (once each, by version).
/// SQL lives in external files under `src-tauri/migrations/` and is embedded at compile time.
pub fn migrations(path: &Path) -> Vec<Migration> {
    let release_v1_2 = uses_release_v1_2_line_endings(path);
    let historical_sql = |version: i64, sql: &'static str| {
        if release_v1_2 && version <= V1_2_LAST_MIGRATION {
            release_v1_2_sql(sql)
        } else {
            sql
        }
    };
    vec![
        Migration {
            version: 1,
            description: "initial schema: 8 tables + indexes + triggers",
            sql: historical_sql(1, include_str!("../migrations/0001_init.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "task lifecycle columns, indexes and hierarchy guards",
            sql: historical_sql(2, include_str!("../migrations/0002_task_lifecycle.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "finish-to-start dependency guards: same-project and reverse-edge",
            sql: historical_sql(3, include_str!("../migrations/0003_task_dependencies.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "meeting start time, action item conversion guards, milestone date index",
            sql: historical_sql(
                4,
                include_str!("../migrations/0004_meetings_action_items.sql"),
            ),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "structured project risks for dashboard",
            sql: historical_sql(5, include_str!("../migrations/0005_dashboard_risks.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "optional descriptions for project links",
            sql: historical_sql(
                6,
                include_str!("../migrations/0006_project_links_description.sql"),
            ),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "people and independent project/task participation",
            sql: historical_sql(7, include_str!("../migrations/0007_people.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "postponed statuses and optional people fields",
            sql: historical_sql(
                8,
                include_str!("../migrations/0008_postponed_people_fields.sql"),
            ),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "recurrence rules and occurrence exceptions",
            sql: historical_sql(9, include_str!("../migrations/0009_recurrence_rules.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "allow standalone recurring meetings",
            sql: historical_sql(
                10,
                include_str!("../migrations/0010_recurrence_standalone_meetings.sql"),
            ),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "virtual one-off recurrence rescheduling",
            sql: historical_sql(
                11,
                include_str!("../migrations/0011_recurrence_exceptions_reschedule.sql"),
            ),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "v1.3 productivity models",
            sql: include_str!("../migrations/0012_v13_productivity.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "relax meeting URL storage constraints",
            sql: include_str!("../migrations/0013_relax_meeting_urls.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "sectioned named orders and task archive provenance",
            sql: include_str!("../migrations/0014_sort_sections_task_archive.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "task to meeting association links",
            sql: include_str!("../migrations/0015_task_meetings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "stable meeting anchors for recurring series associations",
            sql: include_str!("../migrations/0016_recurrence_meeting_anchors.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use rusqlite::{params, Connection};
    use sha2::{Digest, Sha384};

    use super::migrations;

    fn temporary_database(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("projectpilot-{name}-{nonce}.db"))
    }

    fn migration_one_checksum(sql: &str) -> Vec<u8> {
        Sha384::digest(sql.as_bytes()).to_vec()
    }

    fn database_with_checksum(checksum: &[u8]) -> std::path::PathBuf {
        let path = temporary_database("migration-lineage");
        let connection = Connection::open(&path).expect("test database should open");
        connection
            .execute_batch(
                "CREATE TABLE _sqlx_migrations (
                   version BIGINT PRIMARY KEY,
                   description TEXT NOT NULL,
                   installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                   success BOOLEAN NOT NULL,
                   checksum BLOB NOT NULL,
                   execution_time BIGINT NOT NULL
                 );",
            )
            .expect("migration history table should be created");
        connection
            .execute(
                "INSERT INTO _sqlx_migrations
                   (version, description, success, checksum, execution_time)
                 VALUES (1, 'initial schema', 1, ?1, 0)",
                params![checksum],
            )
            .expect("migration history should be inserted");
        path
    }

    #[test]
    fn selects_exact_v1_and_v1_2_release_checksums_without_rewriting_history() {
        let canonical_sql = include_str!("../migrations/0001_init.sql");
        let v1_checksum = migration_one_checksum(canonical_sql);
        assert_eq!(
            format!("{:x}", Sha384::digest(canonical_sql.as_bytes())),
            "e624a8804ab5e17182facdd88eb8f9ab2e1d479b9d286c10ff1280001c7994e8624ef873df1caf99b7b7fa6d7411d29c"
        );
        let v1_path = database_with_checksum(&v1_checksum);
        let v1_migrations = migrations(&v1_path);
        assert_eq!(
            migration_one_checksum(v1_migrations[0].sql),
            v1_checksum,
            "v1.00 databases must retain the LF checksum"
        );

        let v1_2_sql = canonical_sql.replace('\n', "\r\n");
        let v1_2_checksum = migration_one_checksum(&v1_2_sql);
        assert_eq!(
            format!("{:x}", Sha384::digest(v1_2_sql.as_bytes())),
            "6d97a6406f85a9d41bcb444b2f45b01c5d98834243651a2721d9eace9e5d541714a10a92dd3e9ed2384182a265d933ee"
        );
        let v1_2_path = database_with_checksum(&v1_2_checksum);
        let v1_2_migrations = migrations(&v1_2_path);
        assert_eq!(
            migration_one_checksum(v1_2_migrations[0].sql),
            v1_2_checksum,
            "v1.2.0 databases must retain the released CRLF checksum"
        );
        assert_eq!(
            migration_one_checksum(v1_2_migrations[10].sql),
            migration_one_checksum(
                &include_str!("../migrations/0011_recurrence_exceptions_reschedule.sql")
                    .replace('\n', "\r\n")
            )
        );
        assert!(!v1_2_migrations[11].sql.contains('\r'));

        fs::remove_file(v1_path).expect("v1 test database should be removed");
        fs::remove_file(v1_2_path).expect("v1.2 test database should be removed");
    }

    #[test]
    fn unknown_checksum_is_left_for_sqlx_to_reject() {
        let path = database_with_checksum(b"unknown released checksum");
        let selected = migrations(&path);
        assert_eq!(selected[0].sql, include_str!("../migrations/0001_init.sql"));
        fs::remove_file(path).expect("test database should be removed");
    }
}
