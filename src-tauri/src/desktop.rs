use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

/// The one and only desktop widget window label. WorkerW is fully disabled
/// this round: nothing in this module (or anywhere on the runtime path)
/// touches `crate::workerw`.
pub const WIDGET_LABEL: &str = "desktop-widget";
const TRAY_ID: &str = "projectpilot-tray";
const WIDGET_STATE_EVENT: &str = "projectpilot:desktop-widget-state";

static EXIT_ON_MAIN_CLOSE: AtomicBool = AtomicBool::new(false);
static WIDGET_LOCKED: AtomicBool = AtomicBool::new(false);
static WIDGET_CLICK_THROUGH: AtomicBool = AtomicBool::new(false);

/// Real (not persisted) widget window state, read from the live window.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
pub struct WidgetStatus {
    pub exists: bool,
    pub visible: bool,
    pub locked: bool,
    pub click_through: bool,
}

fn widget_status_of(app: &AppHandle) -> WidgetStatus {
    let window = app.get_webview_window(WIDGET_LABEL);
    let exists = window.is_some();
    let visible = window
        .as_ref()
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    WidgetStatus {
        exists,
        visible,
        locked: WIDGET_LOCKED.load(Ordering::Relaxed),
        click_through: WIDGET_CLICK_THROUGH.load(Ordering::Relaxed),
    }
}

/// Notify every webview (settings page) and refresh the tray after any
/// widget state change, so UI state always derives from the real window.
fn broadcast_widget_state(app: &AppHandle) {
    let status = widget_status_of(app);
    let _ = app.emit(WIDGET_STATE_EVENT, status);
    refresh_tray(app);
}

fn show_and_focus(window: &WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        show_and_focus(&window);
    }
}

/// Create the widget window if missing, otherwise show the existing one.
/// Never creates a duplicate label and cleans up a half-created window on
/// failure so no blank window or ghost WebView is left behind.
fn open_widget(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WIDGET_LABEL) {
        window
            .show()
            .map_err(|error| format!("无法显示桌面小窗：{error}"))?;
        broadcast_widget_state(app);
        return Ok(());
    }
    let built = WebviewWindowBuilder::new(app, WIDGET_LABEL, WebviewUrl::App("index.html".into()))
        .title("ProjectPilot 桌面小窗")
        .inner_size(380.0, 540.0)
        .min_inner_size(320.0, 420.0)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .skip_taskbar(true)
        .always_on_top(false)
        .focused(false)
        .shadow(false)
        .visible(true)
        .build();
    let window = match built {
        Ok(window) => window,
        Err(error) => {
            // Defensive cleanup: destroy any partially registered window so a
            // retry can succeed instead of hitting a stale duplicate label.
            if let Some(orphan) = app.get_webview_window(WIDGET_LABEL) {
                let _ = orphan.destroy();
            }
            return Err(format!("无法创建桌面小窗：{error}"));
        }
    };
    WIDGET_LOCKED.store(false, Ordering::Relaxed);
    WIDGET_CLICK_THROUGH.store(false, Ordering::Relaxed);
    let state_app = app.clone();
    // Close means close: the window is destroyed, the main app keeps running,
    // and reopening creates a fresh window.
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed | WindowEvent::Focused(_)) {
            broadcast_widget_state(&state_app);
        }
    });
    broadcast_widget_state(app);
    Ok(())
}

#[tauri::command]
pub fn open_desktop_widget(app: AppHandle) -> Result<(), String> {
    open_widget(&app)
}

#[tauri::command]
pub fn show_desktop_widget(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(WIDGET_LABEL)
        .ok_or_else(|| "桌面小窗尚未打开。".to_string())?;
    window
        .show()
        .map_err(|error| format!("无法显示桌面小窗：{error}"))?;
    broadcast_widget_state(&app);
    Ok(())
}

#[tauri::command]
pub fn hide_desktop_widget(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(WIDGET_LABEL)
        .ok_or_else(|| "桌面小窗尚未打开。".to_string())?;
    window
        .hide()
        .map_err(|error| format!("无法隐藏桌面小窗：{error}"))?;
    broadcast_widget_state(&app);
    Ok(())
}

#[tauri::command]
pub fn close_desktop_widget(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WIDGET_LABEL) {
        window
            .destroy()
            .map_err(|error| format!("无法关闭桌面小窗：{error}"))?;
    }
    WIDGET_LOCKED.store(false, Ordering::Relaxed);
    WIDGET_CLICK_THROUGH.store(false, Ordering::Relaxed);
    broadcast_widget_state(&app);
    Ok(())
}

#[tauri::command]
pub fn desktop_widget_status(app: AppHandle) -> WidgetStatus {
    widget_status_of(&app)
}

/// Locking only disables move/resize; the content stays interactive.
/// Dragging is blocked on the web side (the drag region is disabled).
#[tauri::command]
pub fn set_desktop_widget_locked(app: AppHandle, locked: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(WIDGET_LABEL)
        .ok_or_else(|| "桌面小窗尚未打开。".to_string())?;
    window
        .set_resizable(!locked)
        .map_err(|error| format!("无法更新桌面小窗锁定状态：{error}"))?;
    WIDGET_LOCKED.store(locked, Ordering::Relaxed);
    broadcast_widget_state(&app);
    Ok(())
}

#[tauri::command]
pub fn set_desktop_widget_click_through(app: AppHandle, enabled: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(WIDGET_LABEL)
        .ok_or_else(|| "桌面小窗尚未打开。".to_string())?;
    window
        .set_ignore_cursor_events(enabled)
        .map_err(|error| format!("无法更新桌面小窗点击穿透：{error}"))?;
    WIDGET_CLICK_THROUGH.store(enabled, Ordering::Relaxed);
    broadcast_widget_state(&app);
    Ok(())
}

#[tauri::command]
pub fn set_main_close_behavior(exit: bool) {
    EXIT_ON_MAIN_CLOSE.store(exit, Ordering::Relaxed);
}

#[cfg(windows)]
fn update_launch_at_login(enabled: bool) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;

    let current_exe = std::env::current_exe().map_err(|_| "无法读取当前程序路径。")?;
    let command = format!("\"{}\"", current_exe.display());
    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    let run = current_user
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            KEY_SET_VALUE,
        )
        .map_err(|_| "无法打开当前用户的启动设置。")?;
    if enabled {
        run.set_value("ProjectPilot", &command)
            .map_err(|_| "无法启用开机启动。".to_string())
    } else {
        match run.delete_value("ProjectPilot") {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err("无法关闭开机启动。".to_string()),
        }
    }
}

#[cfg(not(windows))]
fn update_launch_at_login(_enabled: bool) -> Result<(), String> {
    Err("开机启动仅支持 Windows 10/11。".to_string())
}

#[tauri::command]
pub fn set_launch_at_login(enabled: bool) -> Result<(), String> {
    update_launch_at_login(enabled)
}

/// One entry of the dynamic tray menu. `None` renders a separator.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrayEntry {
    pub id: &'static str,
    pub label: &'static str,
}

/// Pure, testable tray menu layout. Invalid commands for the current widget
/// state are omitted (not merely disabled) and groups are separated by
/// separators. There is no WorkerW, no month calendar, no view switching and
/// no duplicated open/hide entry.
pub fn tray_menu_spec(status: WidgetStatus) -> Vec<Option<TrayEntry>> {
    let mut entries: Vec<Option<TrayEntry>> = vec![Some(TrayEntry {
        id: "open",
        label: "打开 ProjectPilot",
    })];
    entries.push(None);
    if !status.exists {
        entries.push(Some(TrayEntry {
            id: "widget-open",
            label: "打开桌面小窗",
        }));
    } else if status.visible {
        entries.push(Some(TrayEntry {
            id: "widget-hide",
            label: "隐藏桌面小窗",
        }));
    } else {
        entries.push(Some(TrayEntry {
            id: "widget-show",
            label: "显示桌面小窗",
        }));
    }
    if status.exists {
        entries.push(Some(TrayEntry {
            id: "widget-close",
            label: "关闭桌面小窗",
        }));
        entries.push(None);
        entries.push(Some(if status.locked {
            TrayEntry {
                id: "widget-unlock",
                label: "解除小窗位置锁定",
            }
        } else {
            TrayEntry {
                id: "widget-lock",
                label: "锁定小窗位置",
            }
        }));
        entries.push(Some(if status.click_through {
            TrayEntry {
                id: "widget-click-through-off",
                label: "关闭点击穿透",
            }
        } else {
            TrayEntry {
                id: "widget-click-through-on",
                label: "开启点击穿透",
            }
        }));
    }
    entries.push(None);
    entries.push(Some(TrayEntry {
        id: "pause",
        label: "暂停通知",
    }));
    entries.push(Some(TrayEntry {
        id: "settings",
        label: "通知与提醒设置",
    }));
    entries.push(None);
    entries.push(Some(TrayEntry {
        id: "quit",
        label: "退出 ProjectPilot",
    }));
    entries
}

fn build_tray_menu(app: &AppHandle, status: WidgetStatus) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    for entry in tray_menu_spec(status) {
        match entry {
            Some(item) => menu.append(&MenuItem::with_id(
                app,
                item.id,
                item.label,
                true,
                None::<&str>,
            )?)?,
            None => menu.append(&PredefinedMenuItem::separator(app)?)?,
        }
    }
    Ok(menu)
}

fn refresh_tray(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Ok(menu) = build_tray_menu(app, widget_status_of(app)) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

fn handle_tray_command(app: &AppHandle, id: &str) {
    match id {
        "open" => show_main(app),
        "widget-open" | "widget-show" => {
            let _ = open_widget(app);
        }
        "widget-hide" => {
            let _ = hide_desktop_widget(app.clone());
        }
        "widget-close" => {
            let _ = close_desktop_widget(app.clone());
        }
        "widget-lock" => {
            let _ = set_desktop_widget_locked(app.clone(), true);
        }
        "widget-unlock" => {
            let _ = set_desktop_widget_locked(app.clone(), false);
        }
        "widget-click-through-on" => {
            let _ = set_desktop_widget_click_through(app.clone(), true);
        }
        "widget-click-through-off" => {
            let _ = set_desktop_widget_click_through(app.clone(), false);
        }
        "pause" | "settings" => {
            show_main(app);
            let _ = app.emit("projectpilot:tray-command", id);
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    }
}

pub fn setup_desktop(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_tray_menu(app, widget_status_of(app))?;
    let app_handle = app.clone();
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .on_menu_event(move |_, event| handle_tray_command(&app_handle, event.id.as_ref()));
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    if let Some(window) = app.get_webview_window("main") {
        let main = window.clone();
        let exit_app = app.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if EXIT_ON_MAIN_CLOSE.load(Ordering::Relaxed) {
                    exit_app.exit(0);
                } else {
                    api.prevent_close();
                    let _ = main.hide();
                }
            }
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(status: WidgetStatus) -> Vec<&'static str> {
        tray_menu_spec(status)
            .into_iter()
            .flatten()
            .map(|entry| entry.id)
            .collect()
    }

    fn status(exists: bool, visible: bool, locked: bool, click_through: bool) -> WidgetStatus {
        WidgetStatus {
            exists,
            visible,
            locked,
            click_through,
        }
    }

    #[test]
    fn tray_without_widget_offers_only_open() {
        assert_eq!(
            ids(status(false, false, false, false)),
            vec!["open", "widget-open", "pause", "settings", "quit"],
        );
    }

    #[test]
    fn tray_with_visible_widget_offers_hide_close_lock_click_through() {
        assert_eq!(
            ids(status(true, true, false, false)),
            vec![
                "open",
                "widget-hide",
                "widget-close",
                "widget-lock",
                "widget-click-through-on",
                "pause",
                "settings",
                "quit",
            ],
        );
    }

    #[test]
    fn tray_with_hidden_widget_offers_show_and_close() {
        let ids = ids(status(true, false, false, false));
        assert!(ids.contains(&"widget-show"));
        assert!(ids.contains(&"widget-close"));
        assert!(!ids.contains(&"widget-open"));
        assert!(!ids.contains(&"widget-hide"));
    }

    #[test]
    fn tray_toggles_lock_and_click_through_labels() {
        let ids = ids(status(true, true, true, true));
        assert!(ids.contains(&"widget-unlock"));
        assert!(ids.contains(&"widget-click-through-off"));
        assert!(!ids.contains(&"widget-lock"));
        assert!(!ids.contains(&"widget-click-through-on"));
    }

    #[test]
    fn tray_never_contains_workerw_month_or_duplicate_entries() {
        for exists in [false, true] {
            for visible in [false, true] {
                for locked in [false, true] {
                    for click_through in [false, true] {
                        let spec = tray_menu_spec(status(exists, visible, locked, click_through));
                        let ids: Vec<&str> = spec.iter().flatten().map(|entry| entry.id).collect();
                        let labels: Vec<&str> =
                            spec.iter().flatten().map(|entry| entry.label).collect();
                        let unique: std::collections::HashSet<&&str> = ids.iter().collect();
                        assert_eq!(unique.len(), ids.len(), "duplicate tray ids: {ids:?}");
                        for label in labels {
                            assert!(!label.contains("WorkerW"));
                            assert!(!label.contains("月历"));
                            assert!(!label.contains("工作区"));
                            assert!(!label.contains("刷新"));
                            assert!(!label.contains("切换"));
                            assert!(!label.contains("临时"));
                        }
                        // At most one open/show/hide entry for the widget.
                        let toggles = ids
                            .iter()
                            .filter(|id| {
                                ["widget-open", "widget-show", "widget-hide"].contains(&&***id)
                            })
                            .count();
                        assert_eq!(toggles, 1);
                    }
                }
            }
        }
    }
}
