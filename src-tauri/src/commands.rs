use crate::database::{self, Board, BoardMetadata, BoardUpdate};
use tauri::AppHandle;

#[tauri::command]
pub fn get_all_boards(app: AppHandle) -> Result<Vec<BoardMetadata>, String> {
    database::load_all_boards(&app)
}

#[tauri::command]
pub fn get_board(app: AppHandle, id: u64) -> Result<Board, String> {
    database::load_board(&app, id)
}

#[tauri::command]
pub fn create_board(app: AppHandle, name: String, bg_color: String) -> Result<Board, String> {
    let now = database::now_millis();
    let board = Board {
        id: now,
        name,
        bg_color,
        created_at: now,
        updated_at: now,
        layers: Vec::new(),
        assets: Vec::new(),
        thumbnail: None,
    };
    database::save_board(&app, &board)?;
    Ok(board)
}

#[tauri::command]
pub fn update_board(app: AppHandle, id: u64, updates: BoardUpdate) -> Result<Board, String> {
    let mut board = database::load_board(&app, id)?;
    
    if let Some(name) = updates.name {
        board.name = name;
    }
    if let Some(bg_color) = updates.bg_color {
        board.bg_color = bg_color;
    }
    if let Some(layers) = updates.layers {
        board.layers = layers;
    }
    if let Some(assets) = updates.assets {
        board.assets = assets;
    }
    if let Some(thumbnail) = updates.thumbnail {
        board.thumbnail = Some(thumbnail);
    }
    
    board.updated_at = database::now_millis();
    database::save_board(&app, &board)?;
    Ok(board)
}

#[tauri::command]
pub fn delete_board(app: AppHandle, id: u64) -> Result<(), String> {
    database::delete_board(&app, id)
}