# Windows desktop widget host

## Design audit

The only widget remains `desktop-widget`:

```text
open_desktop_widget / tray widget-open
  -> desktop::open_widget
  -> one Tauri WebviewWindow ("desktop-widget")
  -> index.html
  -> DesktopWidgetApp
```

`show_widget`, `hide_widget`, and `close_widget` operate on that label. Close
destroys the window; opening an existing label only shows it. Locking calls
`set_resizable(!locked)`, click-through calls `set_ignore_cursor_events`, and
the React drag handle calls `startDragging()` only when both features permit
dragging. `DesktopWidgetApp` stores physical screen geometry per monitor in
`desktop.widget.v1`, clamps restoration to the monitor work area, and debounces
move/resize persistence.

The repository's disabled `workerw.rs` already contained Progman message
`0x052C`, top-level enumeration, and parent/style restoration. Its useful
parts were the local Win32 boundary and the standard discovery sequence. It
could not be enabled unchanged because it ignored the Explorer message result,
treated a valid null `SetParent` return as failure, changed child coordinate
semantics without conversion, held its state mutex across Win32 calls, and had
no bounded recovery or visible fallback state.

## Explorer hierarchy and target

The relevant Windows 10/11 hierarchy is:

```text
Progman
WorkerW
  SHELLDLL_DefView
    SysListView32 ("FolderView", desktop icons)
WorkerW                         <- selected wallpaper/desktop host
  desktop-widget               <- same existing HWND and WebView2
```

Explorer can create more than one WorkerW. Discovery therefore enumerates all
top-level windows, finds a window containing `SHELLDLL_DefView`, and selects
the next top-level `WorkerW`; it does not select an arbitrary first WorkerW.
The host is validated immediately before use and the resulting parent is
verified after every `SetParent`.

The adapter is compiled by the default `windows-desktop-host` Cargo feature.
Building with `--no-default-features` independently restores the ordinary
non-topmost window implementation. Non-Windows builds use that implementation
unchanged.

## Coordinates and DPI

Persisted values remain physical **screen** coordinates. Tauri configures the
process as DPI-aware, so Win32 screen rectangles and Tauri `PhysicalPosition`
share physical pixels at 100%, 125%, 150%, and 200% scaling. Negative virtual
desktop coordinates are valid.

After parenting, Win32 child positions are WorkerW-client coordinates.
Attachment and detachment preserve the screen rectangle by converting through
`ScreenToClient`. The two widget coordinate commands always read/write screen
coordinates, and the React persistence path uses those commands rather than
persisting temporary WorkerW-client values. Monitor selection and work-area
clamping remain in the existing React implementation.

## Failure and lifecycle

- `SendMessageTimeoutW` uses `SMTO_ABORTIFHUNG` and a one-second timeout.
- No Rust mutex is held during Win32 calls, event emission, or logging.
- Attachment is idempotent after validating both HWNDs and their relationship.
- The widget is attached on creation and explicit show. Failure is isolated:
  the existing ordinary, non-topmost widget remains usable and reports
  `desktop_host: degraded`.
- A low-frequency health monitor validates the parent only while the widget is
  visible. Recovery uses exponential backoff and stops after three consecutive
  failures. It never calls `show()`, creates a window, or changes lock,
  click-through, geometry, or content state.
- Hide remains hidden. Close detaches and destroys the widget; a destroyed
  window stops its monitor. `RunEvent::ExitRequested` detaches before process
  exit, without sending any destructive operation to Explorer.

## Validation boundary

Rust tests cover bounded recovery and host selection helpers; React tests cover
the explicit degraded-state notice. Linux compilation and mocks cannot verify
Explorer behavior. The Windows checks below remain mandatory before release:

- Windows 10 and 11: Win+D and taskbar “Show desktop”
- normal/maximized applications covering the widget
- focus, taskbar, and Alt+Tab behavior
- four lock/click-through combinations and drag persistence
- Explorer restart, sleep/resume, display hot-plug, and mixed-DPI monitors
- 20 open/close/Win+D repetitions with exactly one `desktop-widget`
