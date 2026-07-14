mod atomic;
mod backup;
mod error;
mod migrations;

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
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:projectpilot.db", migrations::migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            atomic::execute_batch,
            backup::get_db_path,
            backup::open_data_dir,
            backup::backup_database,
            backup::restore_database,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
