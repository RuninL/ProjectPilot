# Desktop reminders implementation notes

The desktop layer uses the official Tauri notification plugin and the existing appsettings table. Settings are a validated `desktop.reminders.v1` JSON value, so JSON export/import/replace already round-trips them with appsettings; no migration or backup whitelist change is required.

Reminder identity combines entity type, stable entity or recurrence rule/date identity, reminder kind, and scheduled timestamp. Expected and materialized recurrence entries therefore share an identity. Candidate helpers deduplicate repeated scans, group same-minute delivery, apply quiet hours and pause state, and collapse overdue work to one local Asia/Hong_Kong daily summary.

The coordinator is intentionally process-scoped and low frequency. It runs no UI-owned core timer and exposes refresh/stop hooks. A production Windows validation must confirm background scheduling after tray hide and sleep/time-change behavior.

Companion uses a separate window label and rendering entry. It reads through services/repositories, completes tasks through task service, and uses a lightweight Tauri invalidation event; event payloads only name changed domains and receivers re-read SQLite.
