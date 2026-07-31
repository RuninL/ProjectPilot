# ProjectPilot contributor guidance

## Scope and stack

ProjectPilot is a local-first Simplified-Chinese Windows desktop project manager. It uses Tauri 2 (Rust), React 18, TypeScript 5 strict mode, Vite, Tailwind/shadcn, React Router 6, Zustand, React Hook Form + Zod, and SQLite through `@tauri-apps/plugin-sql`. Main areas are `src/features`, `src/stores`, `src/services`, `src/repositories`, `src/db`, `src/lib`, `src-tauri`, and `tests`.

## Architecture and data

- Follow UI -> store/service -> repository -> SQLite. Components and Zustand stores must not contain SQL. Repositories parse database rows through the current schemas; services own business validation and composition.
- Keep TypeScript strict: no `any`, `@ts-ignore`, `@ts-nocheck`, or weakened tests. Validate external, form, and import data with Zod at the schema/service boundary.
- Multi-write operations must be atomic through the existing Rust transaction/repository path. Do not alter existing migrations; add one only when schema work is explicitly in scope.
- JSON snapshots, merge/replace import, and Rust SQLite backup/restore must round-trip `recurrence_rules` and `recurrence_exceptions`; replace validates before FK-safe replacement and backup restore validates its table whitelist and creates a safety copy.

## Dates, calendar, recurrence

- Business dates are date-only `YYYY-MM-DD` text in `Asia/Hong_Kong`; use `todayHK()` for business today and UTC ISO timestamps only for audit fields. Date ranges are inclusive.
- Preserve both Calendar views: normal month and colour-bar month grid. They share navigation, Today highlighting, and scroll behaviour. Colour bars split by week and use deterministic independent first-fit lane packing per week.
- Tasks, meetings, milestones, and recurrence occurrences share calendar layout. Weekly expansion is bounded to 500; preserve expected/materialized identity via `(source_rule_id, source_occurrence_date)` and one-off skip/reschedule/materialize behaviour.

## Delivery discipline

- Migration, data-transfer, and recurrence changes need targeted regressions. Tauri/Rust changes require Rust checks and Windows/Tauri manual acceptance; UI changes require screenshots and manual acceptance.
- Notifications, tray, background residence, startup launch, secondary windows, and multi-window sync are deferred unless explicitly reopened.
- Each Issue gets a fresh branch and PR. Never commit to `main`, reuse historical `copilot/*` branches, force-push, auto-merge, or claim unrun checks. Avoid unrelated refactors, dependency upgrades, mass formatting, and test rewrites.
- Run applicable `npm ci`, format, lint, typecheck, test, build, and `git diff --check`; for Rust changes also run cargo fmt and cargo check.