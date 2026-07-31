use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

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
            .title("ProjectPilot Companion")
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
    let open = MenuItem::with_id(app, "open", "Open ProjectPilot", true, None::<&str>)?;
    let companion = MenuItem::with_id(app, "companion", "Open companion", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit ProjectPilot", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &companion, &quit])?;
    let app_handle = app.clone();
    TrayIconBuilder::with_id("projectpilot-tray")
        .menu(&menu)
        .on_menu_event(move |_, event| match event.id.as_ref() {
            "open" => show_main(&app_handle),
            "companion" => {
                let _ = show_companion(&app_handle);
            }
            "quit" => app_handle.exit(0),
            _ => {}
        })
        .build(app)?;

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
