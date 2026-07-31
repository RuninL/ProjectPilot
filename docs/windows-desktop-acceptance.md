# ProjectPilot 1.3 Windows acceptance

## Build

1. Run `npm ci`.
2. Run `cargo check --manifest-path src-tauri/Cargo.toml`.
3. Run `npm run tauri build`.
4. Install the generated NSIS package from `src-tauri/target/release/bundle/nsis`.

## Manual Windows 10/11 checklist

- Verify a ProjectPilot-named native notification and its installed-package icon.
- Grant and deny notification permission; test the notification button in Settings.
- Verify a real timed-meeting reminder, date-only meeting summary, due-task reminder, and project/milestone lead reminder in the Asia/Hong_Kong business day.
- Verify quiet hours spanning midnight, pause/one-hour/tomorrow tray actions, and the summary after resuming notifications.
- Close the main window: it hides to tray; use tray Open to restore/focus it.
- Verify tray Open companion and Quit. Quit must end the process and reminders.
- Open companion twice; it must reuse one window. Close companion; it must hide.
- Verify Today and Calendar tabs, persisted last view, empty/error/retry state, task completion, and main-window refresh.
- Verify recurrence changes refresh both windows without duplicate occurrence display.
- Launch the exe a second time and verify it focuses the existing instance.
- Test monitor disconnect/reconnect, persisted/recovered companion geometry, always-on-top setting, and 125%, 150%, and 200% scaling.

Capture three screenshots: native notification, tray menu, and companion Today/Calendar views.

## Known limitations

- Windows notification click deep links are not claimed until installed-package verification.
- Cloud validation cannot establish final Windows toast identity, tray lifetime, monitor recovery, or idle CPU use.
- Existing repository-wide Prettier failures are intentionally not mass-formatted in this change.
