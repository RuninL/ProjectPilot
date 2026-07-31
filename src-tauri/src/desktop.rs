use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const COMPANION_LABEL: &str = "companion";

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

pub fn setup_desktop(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "打开 ProjectPilot", true, None::<&str>)?;
    let companion = MenuItem::with_id(app, "companion", "打开桌面小窗", true, None::<&str>)?;
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
            "pause" | "pause-hour" | "pause-tomorrow" | "settings" => {
                show_main(&app_handle);
                let _ = app_handle.emit("projectpilot:tray-command", event.id.as_ref());
            }
            "quit" => app_handle.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    if let Some(window) = app.get_webview_window("main") {
        let main = window.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = main.hide();
            }
        });
    }
    Ok(())
}
