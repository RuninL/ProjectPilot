mod atomic;
mod backup;
#[cfg(test)]
mod backup_tests;
mod desktop;
mod error;
mod migrations;
mod project_links;
// WorkerW is fully disabled this round: the module is kept only for source
// isolation. Nothing may call into it — no entry point, no timer, no
// auto-start and no health check.
#[allow(unused)]
mod workerw;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:projectpilot.db", migrations::migrations())
                .build(),
        )
        .setup(|app| Ok(desktop::setup_desktop(app.handle())?))
        .invoke_handler(tauri::generate_handler![
            atomic::execute_batch,
            backup::get_db_path,
            backup::open_data_dir,
            backup::backup_database,
            backup::restore_database,
            project_links::local_path_exists,
            project_links::open_local_path,
            desktop::open_desktop_widget,
            desktop::show_desktop_widget,
            desktop::hide_desktop_widget,
            desktop::close_desktop_widget,
            desktop::desktop_widget_status,
            desktop::set_desktop_widget_locked,
            desktop::set_desktop_widget_click_through,
            desktop::set_main_close_behavior,
            desktop::set_launch_at_login,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
