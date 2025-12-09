mod commands;
mod database;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_all_boards,
            commands::get_board,
            commands::create_board,
            commands::update_board,
            commands::delete_board,
            commands::get_all_assets,
            commands::add_to_all_assets,
            commands::delete_from_all_assets,
            commands::delete_board_asset,
        ])
        .setup(|app| {
            database::init_storage(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}