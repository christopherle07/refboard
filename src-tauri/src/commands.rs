use crate::database::{self, Board, BoardMetadata, BoardUpdate, Asset};
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
        view_state: None,
        strokes: None,
        objects: None,
        groups: None,
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
    if let Some(view_state) = updates.view_state {
        board.view_state = Some(view_state);
    }
    if let Some(strokes) = updates.strokes {
        board.strokes = Some(strokes);
    }
    if let Some(objects) = updates.objects {
        board.objects = Some(objects);
    }
    if let Some(groups) = updates.groups {
        board.groups = Some(groups);
    }

    board.updated_at = database::now_millis();
    database::save_board(&app, &board)?;
    Ok(board)
}

#[tauri::command]
pub fn delete_board(app: AppHandle, id: u64) -> Result<(), String> {
    database::delete_board(&app, id)
}

#[tauri::command]
pub fn get_all_assets(app: AppHandle) -> Result<Vec<Asset>, String> {
    database::load_all_assets(&app)
}

#[tauri::command]
pub fn add_to_all_assets(
    app: AppHandle,
    name: String,
    src: String,
    tags: Option<Vec<String>>,
    metadata: Option<serde_json::Value>,
) -> Result<Asset, String> {
    database::add_to_all_assets(&app, name, src, tags, metadata)
}

#[tauri::command]
pub fn delete_from_all_assets(app: AppHandle, id: f64) -> Result<(), String> {
    database::delete_from_all_assets(&app, id)
}

#[tauri::command]
pub fn delete_board_asset(app: AppHandle, board_id: u64, asset_id: f64) -> Result<Board, String> {
    database::delete_board_asset(&app, board_id, asset_id)
}

#[tauri::command]
pub fn update_asset(app: AppHandle, asset: Asset) -> Result<(), String> {
    database::update_asset(&app, asset)
}

#[tauri::command]
pub fn get_tag_presets(app: AppHandle) -> Result<Vec<String>, String> {
    database::load_tag_presets(&app)
}

#[tauri::command]
pub fn save_tag_presets(app: AppHandle, presets: Vec<String>) -> Result<(), String> {
    database::save_tag_presets(&app, presets)
}