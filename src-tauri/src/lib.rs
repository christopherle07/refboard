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
            commands::update_asset,
            commands::get_tag_presets,
            commands::save_tag_presets,
            commands::save_image_file,
            commands::save_media_file_from_path,
            commands::get_images_dir,
            commands::get_image_file_path,
            commands::fetch_page_html,
            commands::fetch_image_url,
        ])
        .setup(|app| {
            database::init_storage(app.handle())?;

            // Enable rounded corners for macOS windows
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                use cocoa::appkit::{NSWindow, NSWindowStyleMask};
                use cocoa::base::{id, YES};
                use objc::{msg_send, sel, sel_impl};

                if let Some(window) = app.get_webview_window("main") {
                    let ns_window = window.ns_window().unwrap() as id;

                    unsafe {
                        // Get current style mask
                        let current_style: NSWindowStyleMask = msg_send![ns_window, styleMask];

                        // Set the proper style mask: titled + full-size content view
                        // This gives us rounded corners like VS Code
                        let new_style = current_style
                            | NSWindowStyleMask::NSTitledWindowMask
                            | NSWindowStyleMask::NSFullSizeContentViewWindowMask;
                        let _: () = msg_send![ns_window, setStyleMask: new_style];

                        // Make title bar transparent and hide it completely
                        let _: () = msg_send![ns_window, setTitlebarAppearsTransparent: YES];
                        let _: () = msg_send![ns_window, setTitleVisibility: 1]; // NSWindowTitleHidden

                        // Hide the traffic light buttons (close, minimize, maximize)
                        let close_button: id = msg_send![ns_window, standardWindowButton: 0]; // NSWindowCloseButton
                        let miniaturize_button: id = msg_send![ns_window, standardWindowButton: 1]; // NSWindowMiniaturizeButton
                        let zoom_button: id = msg_send![ns_window, standardWindowButton: 2]; // NSWindowZoomButton

                        let _: () = msg_send![close_button, setHidden: YES];
                        let _: () = msg_send![miniaturize_button, setHidden: YES];
                        let _: () = msg_send![zoom_button, setHidden: YES];

                        // Update window shadow to match new shape
                        let _: () = msg_send![ns_window, invalidateShadow];
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}