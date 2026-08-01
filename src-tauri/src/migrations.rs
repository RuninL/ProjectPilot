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
        Migration {
            version: 4,
            description: "meeting start time, action item conversion guards, milestone date index",
            sql: include_str!("../migrations/0004_meetings_action_items.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "structured project risks for dashboard",
            sql: include_str!("../migrations/0005_dashboard_risks.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "optional descriptions for project links",
            sql: include_str!("../migrations/0006_project_links_description.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "people and independent project/task participation",
            sql: include_str!("../migrations/0007_people.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "postponed statuses and optional people fields",
            sql: include_str!("../migrations/0008_postponed_people_fields.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "recurrence rules and occurrence exceptions",
            sql: include_str!("../migrations/0009_recurrence_rules.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "allow standalone recurring meetings",
            sql: include_str!("../migrations/0010_recurrence_standalone_meetings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "virtual one-off recurrence rescheduling",
            sql: include_str!("../migrations/0011_recurrence_exceptions_reschedule.sql"),
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
