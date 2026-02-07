use crate::database::{self, Board, BoardMetadata, BoardUpdate, Asset};
use tauri::AppHandle;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use reqwest::blocking::Client;
use std::time::Duration;

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

#[tauri::command]
pub fn save_image_file(app: AppHandle, data: String, name: String) -> Result<String, String> {
    database::save_image_file(&app, data, name)
}

#[tauri::command]
pub fn save_media_file_from_path(app: AppHandle, source_path: String, name: String) -> Result<String, String> {
    database::save_media_file_from_path(&app, source_path, name)
}

#[tauri::command]
pub fn get_images_dir(app: AppHandle) -> Result<String, String> {
    let dir = database::get_images_dir(&app);
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_image_file_path(app: AppHandle, filename: String) -> Result<String, String> {
    database::get_image_file_path(&app, filename)
}

#[tauri::command]
pub fn fetch_page_html(url: String) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .send()
        .map_err(|e| format!("Failed to fetch URL: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }

    response.text().map_err(|e| format!("Failed to read response: {}", e))
}

#[tauri::command]
pub fn fetch_image_url(url: String) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .header("Accept", "image/*,*/*;q=0.8")
        .header("Referer", &url)
        .send()
        .map_err(|e| format!("Failed to fetch URL: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .split(';')
        .next()
        .unwrap_or("image/png")
        .to_string();

    let bytes = response
        .bytes()
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let base64_data = BASE64.encode(&bytes);
    let data_url = format!("data:{};base64,{}", content_type, base64_data);

    Ok(data_url)
}