use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

pub const COMPANION_LABEL: &str = "companion";
static EXIT_ON_MAIN_CLOSE: AtomicBool = AtomicBool::new(false);

fn show_and_focus(window: &WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        show_and_focus(&window);
    }
}

pub fn show_companion(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(COMPANION_LABEL) {
        show_and_focus(&window);
        return Ok(());
    }

    let window =
        WebviewWindowBuilder::new(app, COMPANION_LABEL, WebviewUrl::App("index.html".into()))
            .title("ProjectPilot 桌面小窗")
            .inner_size(380.0, 520.0)
            .min_inner_size(320.0, 420.0)
            .resizable(true)
            .decorations(false)
            .transparent(true)
            .skip_taskbar(true)
            .always_on_bottom(true)
            .shadow(false)
            .visible(true)
            .build()?;
    let companion = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = companion.hide();
        }
    });
    Ok(())
}

#[tauri::command]
pub fn set_desktop_workspace_mode(app: AppHandle, mode: String) -> Result<(), String> {
    if mode == "off" {
        crate::workerw::detach()?;
        if let Some(window) = app.get_webview_window(COMPANION_LABEL) {
            window.hide().map_err(|_| "无法隐藏桌面工作区。")?;
        }
        return Ok(());
    }
    show_companion(&app).map_err(|_| "无法创建桌面工作区窗口。")?;
    let window = app
        .get_webview_window(COMPANION_LABEL)
        .ok_or_else(|| "桌面工作区窗口不可用。".to_string())?;
    match mode.as_str() {
        "widget" => {
            crate::workerw::detach()?;
            window
                .set_always_on_bottom(true)
                .map_err(|_| "无法设置桌面固定层级。")?;
        }
        "workerw" => {
            window
                .set_always_on_bottom(false)
                .map_err(|_| "无法准备 WorkerW 窗口。")?;
            crate::workerw::attach(&window)?;
        }
        _ => return Err("不支持的桌面工作区模式。".to_string()),
    }
    window.show().map_err(|_| "无法显示桌面工作区。")?;
    Ok(())
}

#[tauri::command]
pub fn set_desktop_workspace_locked(app: AppHandle, locked: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(COMPANION_LABEL)
        .ok_or_else(|| "桌面工作区窗口尚未创建。".to_string())?;
    window
        .set_resizable(!locked)
        .map_err(|_| "无法更新桌面工作区锁定状态。".to_string())
}

#[tauri::command]
pub fn set_desktop_workspace_click_through(app: AppHandle, enabled: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(COMPANION_LABEL)
        .ok_or_else(|| "桌面工作区窗口尚未创建。".to_string())?;
    window
        .set_ignore_cursor_events(enabled)
        .map_err(|_| "无法更新桌面工作区点击穿透。".to_string())
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

pub fn setup_desktop(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "打开 ProjectPilot", true, None::<&str>)?;
    let companion = MenuItem::with_id(app, "companion", "打开桌面小窗", true, None::<&str>)?;
    let workspace_hide =
        MenuItem::with_id(app, "workspace-hide", "隐藏桌面工作区", true, None::<&str>)?;
    let workspace_today = MenuItem::with_id(
        app,
        "workspace-today",
        "桌面工作区：今日",
        true,
        None::<&str>,
    )?;
    let workspace_week = MenuItem::with_id(
        app,
        "workspace-week",
        "桌面工作区：七天",
        true,
        None::<&str>,
    )?;
    let workspace_calendar = MenuItem::with_id(
        app,
        "workspace-calendar",
        "桌面工作区：月历",
        true,
        None::<&str>,
    )?;
    let workspace_widget = MenuItem::with_id(
        app,
        "workspace-widget",
        "切换为桌面固定组件",
        true,
        None::<&str>,
    )?;
    let workspace_workerw = MenuItem::with_id(
        app,
        "workspace-workerw",
        "切换为 WorkerW 模式",
        true,
        None::<&str>,
    )?;
    let workspace_interactive = MenuItem::with_id(
        app,
        "workspace-interactive",
        "临时启用交互",
        true,
        None::<&str>,
    )?;
    let workspace_refresh = MenuItem::with_id(
        app,
        "workspace-refresh",
        "刷新桌面工作区",
        true,
        None::<&str>,
    )?;
    let today = MenuItem::with_id(app, "today", "查看今日概览", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "暂停通知", true, None::<&str>)?;
    let pause_hour = MenuItem::with_id(app, "pause-hour", "暂停通知 1 小时", true, None::<&str>)?;
    let pause_tomorrow =
        MenuItem::with_id(app, "pause-tomorrow", "暂停通知至明天", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "通知与提醒设置", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 ProjectPilot", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &companion,
            &workspace_hide,
            &workspace_today,
            &workspace_week,
            &workspace_calendar,
            &workspace_widget,
            &workspace_workerw,
            &workspace_interactive,
            &workspace_refresh,
            &today,
            &pause,
            &pause_hour,
            &pause_tomorrow,
            &settings,
            &quit,
        ],
    )?;
    let app_handle = app.clone();
    let mut tray = TrayIconBuilder::with_id("projectpilot-tray")
        .menu(&menu)
        .on_menu_event(move |_, event| match event.id.as_ref() {
            "open" => show_main(&app_handle),
            "companion" => {
                let _ = show_companion(&app_handle);
            }
            "today" => {
                let _ = show_companion(&app_handle);
            }
            "workspace-hide" => {
                if let Some(window) = app_handle.get_webview_window(COMPANION_LABEL) {
                    let _ = window.hide();
                }
            }
            "workspace-today" | "workspace-week" | "workspace-calendar" | "workspace-refresh" => {
                let _ = show_companion(&app_handle);
                let _ = app_handle.emit("projectpilot:workspace-command", event.id.as_ref());
            }
            "workspace-widget" => {
                let _ = set_desktop_workspace_mode(app_handle.clone(), "widget".to_string());
                let _ = app_handle.emit("projectpilot:workspace-command", event.id.as_ref());
            }
            "workspace-workerw" => {
                let _ = set_desktop_workspace_mode(app_handle.clone(), "workerw".to_string());
                let _ = app_handle.emit("projectpilot:workspace-command", event.id.as_ref());
            }
            "workspace-interactive" => {
                let _ = set_desktop_workspace_click_through(app_handle.clone(), false);
                let _ = app_handle.emit("projectpilot:workspace-command", event.id.as_ref());
            }
            "pause" | "pause-hour" | "pause-tomorrow" | "settings" => {
                show_main(&app_handle);
                let _ = app_handle.emit("projectpilot:tray-command", event.id.as_ref());
            }
            "quit" => {
                let _ = crate::workerw::detach();
                app_handle.exit(0);
            }
            _ => {}
        });
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
                    let _ = crate::workerw::detach();
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
