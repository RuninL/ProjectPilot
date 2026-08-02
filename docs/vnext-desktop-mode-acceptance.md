# vNext dual desktop mode comparison and acceptance

> Status: both implementations remain in this Draft PR. Linux/jsdom and a
> Windows-target compile are not substitutes for the required Windows 10/11
> hands-on decision.

## Implemented comparison

| Area             | Desktop fixed widget                                                                            | WorkerW wallpaper layer                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| React UI/data    | Shared Today, seven-day and month workspace; shared repositories/services/events                | Exactly the same window and React tree                                                                                                       |
| Native placement | Borderless transparent, taskbar-hidden, resizable Tauri window with always-on-bottom            | Same HWND parented to Explorer WorkerW with original parent/style restoration                                                                |
| Interaction      | Full WebView interaction; optional independent click-through                                    | Attempts full WebView interaction; Explorer icon-layer limitations require real-machine confirmation                                         |
| Recovery         | Stable `companion` label prevents duplicates; safe display geometry; tray show/hide/interaction | Validates WorkerW parent every 30 seconds while visible and on visibility resume; bounded attach timeout and automatic fixed-widget fallback |
| Exit             | Hide-on-close; explicit tray exit releases process                                              | Detaches and restores parent/style before explicit exit/mode switch                                                                          |
| Displays         | One selected display; geometry is keyed by name and coordinates, with primary-display fallback  | Same selection and geometry; WorkerW behavior per selected display is pending hands-on verification                                          |

No administrator rights, DLL injection, global input hook, Explorer modification,
remote page, shell replacement, wallpaper-file change, or wildcard capability is
used. Login launch writes/removes only the current-user
`Software\Microsoft\Windows\CurrentVersion\Run\ProjectPilot` value.

## Automated evidence

- TypeScript strict check, ESLint, focused Vitest workspace/settings/model tests.
- Rust host check and `x86_64-pc-windows-gnu` compile check.
- WorkerW bindings validate HWNDs, use a one-second `SendMessageTimeoutW`, check
  parent/style operations, and keep unsafe code in `workerw.rs`.
- Settings/profile JSON is Zod validated and stored in existing `app_settings`;
  no migration or second database is introduced.

These checks do **not** establish real desktop z-order, Explorer recovery,
WorkerW input routing, Win+D behavior, or idle WebView2 resource use.

## Required Windows 10/11 hands-on matrix

Run every row once per mode and record OS build, WebView2 version, GPU, display
layout/DPI, power source and result:

1. Enable mode, hide, show, close, reopen twice, and confirm one `companion`
   window/WebView only.
2. Exercise Today, seven-day, month, recurring meeting, complete/reopen, quick
   task, detail navigation, refresh, theme update and import/replace refresh.
3. Use Win+D; minimize/close/restore the main window; verify the workspace does
   not cover normal applications or steal focus.
4. Restart Explorer from Task Manager. For WorkerW, time detach/failure and
   automatic reattachment/fallback; ensure desktop icons remain visible.
5. Sleep/wake, lock/unlock, RDP connect/disconnect, virtual-desktop switch,
   full-screen application and Windows sign-out/shutdown.
6. Test unlocked resize/drag, locked content interaction, click-through, tray
   “临时启用交互”, and settings recovery. Confirm no unrecoverable state.
7. Test primary/secondary selection, display removal/reconnect, 100/125/150/200%
   DPI and resolution/orientation changes. Confirm no off-screen geometry.
8. Enable/disable login launch and inspect only the current-user Run value.
   Upgrade over the previous release and confirm theme/mode/layout persistence.
9. Exit from tray and verify WorkerW detaches, no ghost window/process remains,
   Explorer is unaffected, and the normal system wallpaper is unchanged.
10. Keyboard-only and screen-reader pass at 200% scaling, Windows high contrast
    and reduced motion. Record WorkerW-specific input/accessibility differences.

## Performance recording template

Use the same data set for both modes (record project/task/meeting/recurrence
counts). Measure after five idle minutes and once during each action.

| Metric                      | Fixed widget                  | WorkerW                       | Environment/result                                 |
| --------------------------- | ----------------------------- | ----------------------------- | -------------------------------------------------- |
| Idle CPU / GPU              | Not measured in Linux sandbox | Not measured in Linux sandbox | Windows Task Manager + WebView2 process list       |
| Working set / WebView count | Not measured                  | Not measured                  | Record main hidden and visible                     |
| First show / view switch    | Not measured                  | Not measured                  | Performance marks/DevTools                         |
| Refresh / month render      | Not measured                  | Not measured                  | Small and large data sets                          |
| Attach / Explorer recovery  | N/A                           | Not measured                  | Record median and worst observed                   |
| Full-screen/battery idle    | Not measured                  | Not measured                  | Verify no animation loop/high-frequency DB polling |

## User decision

After completing the matrix, choose one of: keep fixed widget only, keep WorkerW
only, or retain both. Do not remove either implementation before this decision.
