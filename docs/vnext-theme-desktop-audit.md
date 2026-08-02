# vNext semantic theme and desktop workspace audit

> Audit date: 2026-08-02. This is the phase 0 implementation baseline for issue #13.

## Runtime and supported Windows baseline

- The repository builds Tauri 2 (`tauri` 2.11.5), `tauri-runtime-wry` 2.11.4 and
  `wry` 0.55.1. The lockfile resolves `webview2-com` 0.38.2. The Rust minimum is
  1.77.2.
- The documented product baseline remains Windows 10/11 x64. The NSIS bundle is
  per-user and carries the offline WebView2 installer; this work does not raise
  the OS baseline or require administrator privileges.
- Linux/jsdom checks cannot validate HWND parenting, WorkerW recovery, Win+D,
  Explorer restart, virtual desktops, display hot-plug, DPI transitions,
  lock/sleep, RDP, full-screen pausing, or idle WebView2 CPU/GPU. Those items
  remain explicit Windows manual acceptance gates and the PR must remain Draft.

## Existing architecture and reusable parts

- `App.tsx` initializes the single SQLite database, applies the selected theme,
  runs the reminder coordinator only in `main`, and dispatches the separate
  `companion` React root. Tauri's single-instance plugin focuses the existing
  main window.
- `desktop.rs` owns the tray and creates one stable `companion` WebviewWindow.
  Closing either window hides it. The companion already restores bounded
  geometry and uses service/repository reads rather than SQL in UI code.
- `CompanionApp`, `companion.service`, `calendar.service`, recurrence services,
  `todayHK`, and `projectpilot:invalidate` are the basis for shared Today,
  seven-day, and month views. Task mutations continue through `task.service`;
  the main window remains the only reminder scheduler.
- `app_settings` is a validated key/value repository. Reminder settings,
  companion geometry/view, and the bounded reminder ledger already use it.
  JSON merge/replace and SQLite backup round-trip all `app_settings` rows.
- Existing built-in themes are `light`, `dark`, `system`, `warm`, and
  `colorful`. CSS variables cover the shadcn surface/control core plus heading,
  recurrence, and the fixed six-colour task-progress palette.
- Calendar layout/recurrence remains canonical in `calendarModel`,
  `calendar.service`, and `recurrence.service`; the desktop workspace must not
  introduce a second occurrence algorithm.

## Semantic token plan

Profiles are versioned, Zod-validated JSON with a supported base theme and
strict hexadecimal colours only. Unknown properties are discarded during
normalization; missing tokens are filled from the selected built-in safe
profile. No CSS, JavaScript, selector, DOM path, or URL is accepted.

Token groups:

- common/text: app, primary surface, card, sidebar, primary/secondary text,
  page/section titles, body, metadata, link, placeholder, completed, archived,
  disabled, success, warning, and error text;
- surfaces/controls: top bar, dialog, input, hover, selection, border, divider,
  focus, overlay, primary/secondary/danger buttons and their foregrounds;
- statuses/tasks: active, archived, completed, postponed, due soon, three
  priority levels, success, warning, error, and information;
- meetings/calendar: standalone/recurring meetings, today, selected date,
  weekend, current-time marker, task/meeting bars, postponed/completed entries,
  grid, background, and outside-month date;
- desktop widget: background, primary text, secondary text, border, and overlay;
- progress palette: opt-in six colours, retaining the existing fixed safe
  palette by default.

Entity colours remain authoritative: explicitly stored project/task colours
win over semantic defaults, which win over the built-in safe fallback.

## Hard-coded colour inventory

The progress palette in `taskProgressSegments.ts` is intentional and remains
the safe default. Project sample/form defaults and calendar fallback colours
are business/entity fallbacks. Semantic candidates that should migrate to
tokens are status colours in Dashboard, Gantt and task warnings; calendar
selection/focus colours in `CompanionApp`; success messages in Files and project
links; and the startup recovery banner. This will be done incrementally to
avoid changing built-in theme appearance.

## WorkerW technical decision

No third-party wallpaper plugin is added. A plugin would expand the permission,
unsafe-code, maintenance and recovery surface, while the required operation is
small and Windows-specific. The planned project-local Rust module will:

1. obtain the Tauri desktop window HWND;
2. request creation of the WorkerW layer through Progman;
3. enumerate top-level windows to find the WorkerW sibling behind
   `SHELLDLL_DefView`;
4. record the original parent/style, validate every HWND and Win32 result, and
   attach with `SetParent`;
5. detach before mode changes and application exit;
6. retry Explorer recovery with a bounded backoff, never a tight loop;
7. return sanitized errors and optionally fall back to fixed-widget mode.

The fixed-widget and WorkerW modes use the same stable window and React UI.
Only native parenting/z-order differs. The first implementation enables one
selected display while retaining per-display geometry keyed by a stable
monitor identifier where Windows exposes one; missing displays fall back to
the primary work area.

WorkerW input is constrained by Explorer's desktop/icon hierarchy. Interactive
mode and fixed-widget fallback will remain available; no global low-level
mouse/keyboard hook, DLL injection, shell replacement, wallpaper-file change,
or permanent system setting is permitted.

## Persistence and migration decision

No migration is planned. Versioned theme profiles, selected profile ID and
desktop workspace preferences fit the existing `app_settings` repository and
are already included in JSON export/import/replace and database backup. Draft
editor state and accordion state stay in React state and are never persisted.

## Test and acceptance strategy

- Unit tests: profile validation/defaulting, injection rejection, contrast,
  six-colour safety, desktop settings fallback, mode transitions, geometry,
  shared Today/seven-day/month models, and event cleanup.
- Component tests: draft cancellation, save/apply/reset, warning confirmation,
  previews, desktop navigation, completion, quick create, and accessible
  non-colour status labels.
- Integration/regression: app-settings persistence and JSON merge/replace,
  canonical recurrence/calendar reads, task mutation synchronization, and
  reminder single-coordinator behavior.
- Quality gates: `npm ci`, format check, lint, typecheck, tests, build,
  `git diff --check`; Rust changes additionally run `cargo fmt --check` and
  `cargo check`.
- Windows manual acceptance: both modes independently cover start/hide/reopen,
  Win+D, main-window lifecycle, Explorer restart, sleep/wake, lock/unlock,
  display/DPI/virtual-desktop/full-screen/RDP changes, tray recovery,
  click-through safety, upgrade persistence, uninstall/exit cleanup, and the
  performance measurements required by the issue.
