use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub id: f64,
    pub name: String,
    pub src: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: f64,
    pub name: String,
    pub src: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub id: u64,
    pub name: String,
    pub bg_color: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub layers: Vec<Layer>,
    pub assets: Vec<Asset>,
    #[serde(default)]
    pub thumbnail: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BoardMetadata {
    pub id: u64,
    pub name: String,
    pub bg_color: String,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub thumbnail: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardUpdate {
    pub name: Option<String>,
    pub bg_color: Option<String>,
    pub layers: Option<Vec<Layer>>,
    pub assets: Option<Vec<Asset>>,
    pub thumbnail: Option<String>,
}

fn get_boards_dir(app: &AppHandle) -> PathBuf {
    let data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
    data_dir.join("boards")
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>()
        .to_lowercase()
}

fn get_board_path(app: &AppHandle, name: &str, id: u64) -> PathBuf {
    let sanitized = sanitize_filename(name);
    let filename = format!("{}-{}.json", sanitized, id);
    get_boards_dir(app).join(filename)
}

pub fn init_storage(app: &AppHandle) -> Result<(), String> {
    let boards_dir = get_boards_dir(app);
    fs::create_dir_all(&boards_dir).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_all_boards(app: &AppHandle) -> Result<Vec<BoardMetadata>, String> {
    let boards_dir = get_boards_dir(app);
    let mut boards = Vec::new();
    
    if let Ok(entries) = fs::read_dir(&boards_dir) {
        for entry in entries.flatten() {
            if entry.path().extension().map_or(false, |e| e == "json") {
                if let Ok(content) = fs::read_to_string(entry.path()) {
                    if let Ok(board) = serde_json::from_str::<Board>(&content) {
                        boards.push(BoardMetadata {
                            id: board.id,
                            name: board.name,
                            bg_color: board.bg_color,
                            created_at: board.created_at,
                            updated_at: board.updated_at,
                            thumbnail: board.thumbnail,
                        });
                    }
                }
            }
        }
    }
    
    Ok(boards)
}

pub fn load_board(app: &AppHandle, id: u64) -> Result<Board, String> {
    let boards_dir = get_boards_dir(app);
    
    if let Ok(entries) = fs::read_dir(&boards_dir) {
        for entry in entries.flatten() {
            if entry.path().extension().map_or(false, |e| e == "json") {
                if let Ok(content) = fs::read_to_string(entry.path()) {
                    if let Ok(board) = serde_json::from_str::<Board>(&content) {
                        if board.id == id {
                            return Ok(board);
                        }
                    }
                }
            }
        }
    }
    
    Err(format!("Board {} not found", id))
}

pub fn save_board(app: &AppHandle, board: &Board) -> Result<(), String> {
    let boards_dir = get_boards_dir(app);
    
    if let Ok(entries) = fs::read_dir(&boards_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(existing) = serde_json::from_str::<Board>(&content) {
                        if existing.id == board.id && existing.name != board.name {
                            let _ = fs::remove_file(&path);
                            break;
                        }
                    }
                }
            }
        }
    }
    
    let path = get_board_path(app, &board.name, board.id);
    let content = serde_json::to_string_pretty(board).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_board(app: &AppHandle, id: u64) -> Result<(), String> {
    let boards_dir = get_boards_dir(app);
    
    if let Ok(entries) = fs::read_dir(&boards_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(board) = serde_json::from_str::<Board>(&content) {
                        if board.id == id {
                            fs::remove_file(&path).map_err(|e| e.to_string())?;
                            return Ok(());
                        }
                    }
                }
            }
        }
    }
    
    Err(format!("Board {} not found", id))
}

pub fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}