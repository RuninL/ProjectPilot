# Codex cloud handoff — 2026-07-31

Baseline: GitHub `main` at `5e43bdd687633364f4872d8a86ed2687244e3667`. This handoff changes guidance only; it contains no product, dependency, migration, Tauri, UI, or desktop-capability change.

## Current state

ProjectPilot is a local-first Windows Tauri application with projects, two-level tasks, milestones, meetings/action items, people, risks/dashboard, Gantt/dependency views, Files & Links, JSON/CSV transfer, and SQLite backup/restore. Calendar has normal and colour-bar month views; weekly/biweekly meeting recurrence supports bounded expected occurrences, materialization, exceptions, and data-transfer/backup coverage. Highest migration: `0011_recurrence_exceptions_reschedule.sql`.

Stack and architecture: Tauri 2/Rust, React 18, strict TypeScript, Vite, Tailwind/shadcn, React Router 6, Zustand, React Hook Form/Zod, and SQLite. UI flows through stores/services and repositories to SQLite; Rust exposes atomic batch and backup commands.

## Verification and debt

The existing Phase B record reports 697 Vitest tests and benchmark tests (`releaseBenchmark`, `parallelGanttBenchmark`), with no separate committed numeric baseline. Historical documentation records passing Node/Rust gates, but this cloud handoff environment did not provide an executable Cloud workspace, so no Cloud npm, Rust, GUI, or Windows/Tauri checks are claimed. Existing format check is known to fail on many pre-existing files; this PR adds formatted Markdown only and intentionally does not mass-format.

Known debt: React Router 6 upgrade/security risk, Router future-flag and some `act(...)` test warnings, a >500 kB build chunk warning, and weekly/biweekly single-weekday recurrence rather than full RRULE. Notifications, tray, background residence, startup launch, secondary windows, and multi-window sync remain deferred.

## 1.3 entry workflow

Start from clean latest `main`: Issue -> cloud task branch -> scoped tests and PR -> local Windows/Tauri test plus screenshots for UI -> human review and manual merge. Do not auto-merge. Retain `.github/copilot-instructions.md` as historical guidance; `AGENTS.md` is the durable Codex workflow.
