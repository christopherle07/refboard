use tauri::{Runtime, Window};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowLongPtrW, GetWindowLongPtrW, SetLayeredWindowAttributes,
    GWL_EXSTYLE, WS_EX_TRANSPARENT, WS_EX_LAYERED, LWA_ALPHA
};

#[tauri::command]
pub async fn set_overlay_mode<R: Runtime>(
    window: Window<R>,
    enabled: bool,
    opacity: f64,
) -> Result<(), String> {
    window.set_always_on_top(enabled).map_err(|e| e.to_string())?;
    
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let hwnd = HWND(hwnd.0 as isize);
    
    unsafe {
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        
        if enabled {
            SetWindowLongPtrW(
                hwnd,
                GWL_EXSTYLE,
                ex_style | WS_EX_TRANSPARENT.0 as isize | WS_EX_LAYERED.0 as isize,
            );
            
            SetLayeredWindowAttributes(hwnd, 0, (opacity * 255.0) as u8, LWA_ALPHA);
        } else {
            SetWindowLongPtrW(
                hwnd,
                GWL_EXSTYLE,
                ex_style & !(WS_EX_TRANSPARENT.0 as isize),
            );
            
            SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);
        }
    }
    
    Ok(())
}

#[tauri::command]
pub fn get_overlay_mode<R: Runtime>(window: Window<R>) -> Result<bool, String> {
    window.is_always_on_top().map_err(|e| e.to_string())
}