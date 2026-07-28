use tauri_plugin_sql::{Migration, MigrationKind};

/// All schema migrations, applied in order by tauri-plugin-sql (once each, by version).
/// SQL lives in external files under `src-tauri/migrations/` and is embedded at compile time.
pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial schema: 8 tables + indexes + triggers",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "task lifecycle columns, indexes and hierarchy guards",
            sql: include_str!("../migrations/0002_task_lifecycle.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "finish-to-start dependency guards: same-project and reverse-edge",
            sql: include_str!("../migrations/0003_task_dependencies.sql"),
            kind: MigrationKind::Up,
        },
    ]
}
