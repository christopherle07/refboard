use tauri::{Runtime, Window};

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
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
    #[cfg(target_os = "windows")]
    {
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
                
                let _ = SetLayeredWindowAttributes(hwnd, windows::Win32::Foundation::COLORREF(0), (opacity * 255.0) as u8, LWA_ALPHA);
            } else {
                SetWindowLongPtrW(
                    hwnd,
                    GWL_EXSTYLE,
                    ex_style & !(WS_EX_TRANSPARENT.0 as isize),
                );
                
                let _ = SetLayeredWindowAttributes(hwnd, windows::Win32::Foundation::COLORREF(0), 255, LWA_ALPHA);
            }
        }
        
        Ok(())
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        window.set_always_on_top(enabled).map_err(|e| e.to_string())?;
        Ok(())
    }
}