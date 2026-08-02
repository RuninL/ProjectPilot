#[cfg(not(windows))]
use tauri::WebviewWindow;

#[cfg(windows)]
mod platform {
    use std::sync::Mutex;
    use tauri::WebviewWindow;
    use windows::core::{w, BOOL};
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FindWindowExW, FindWindowW, GetParent, GetWindowLongPtrW, IsWindow,
        SendMessageTimeoutW, SetParent, SetWindowLongPtrW, SetWindowPos, GWL_STYLE,
        SEND_MESSAGE_TIMEOUT_FLAGS, SMTO_ABORTIFHUNG, SWP_FRAMECHANGED, SWP_NOMOVE,
        SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER, WINDOW_STYLE, WS_CHILD, WS_POPUP,
    };

    #[derive(Clone, Copy)]
    struct Attachment {
        child: isize,
        parent: Option<isize>,
        worker: isize,
        style: isize,
    }

    static ATTACHMENT: Mutex<Option<Attachment>> = Mutex::new(None);
    const SPAWN_WORKER_MESSAGE: u32 = 0x052C;

    fn hwnd(value: isize) -> HWND {
        HWND(value as *mut core::ffi::c_void)
    }

    unsafe extern "system" fn find_worker(parent: HWND, result: LPARAM) -> BOOL {
        // SAFETY: Explorer owns `parent`; it is supplied by EnumWindows and is
        // valid for this callback. `result` points to the stack slot passed to
        // EnumWindows and lives until enumeration returns.
        let has_def_view =
            unsafe { FindWindowExW(Some(parent), None, w!("SHELLDLL_DefView"), None) }.is_ok();
        if !has_def_view {
            return true.into();
        }
        if let Ok(worker) = unsafe { FindWindowExW(None, Some(parent), w!("WorkerW"), None) } {
            let output = result.0 as *mut Option<HWND>;
            if !output.is_null() {
                unsafe { *output = Some(worker) };
                return false.into();
            }
        }
        true.into()
    }

    fn locate_worker() -> Result<HWND, String> {
        // SAFETY: All calls are synchronous. The Progman handle is checked by
        // the windows crate and EnumWindows receives a live stack pointer only
        // for the duration of the call.
        unsafe {
            let progman =
                FindWindowW(w!("Progman"), None).map_err(|_| "无法找到 Windows 桌面 Progman。")?;
            let mut message_result = 0usize;
            let _ = SendMessageTimeoutW(
                progman,
                SPAWN_WORKER_MESSAGE,
                WPARAM(0),
                LPARAM(0),
                SEND_MESSAGE_TIMEOUT_FLAGS(SMTO_ABORTIFHUNG.0),
                1_000,
                Some(&mut message_result),
            );
            let mut worker = None;
            EnumWindows(
                Some(find_worker),
                LPARAM((&mut worker as *mut Option<HWND>) as isize),
            )
            .map_err(|_| "无法枚举 Windows 桌面窗口。")?;
            worker.ok_or_else(|| "未找到可用的 WorkerW 壁纸层。".to_string())
        }
    }

    pub fn attach(window: &WebviewWindow) -> Result<(), String> {
        let child = window.hwnd().map_err(|_| "无法取得桌面工作区窗口句柄。")?;
        // SAFETY: `child` belongs to the live Tauri WebviewWindow. WorkerW is
        // found and validated immediately before parenting. Every fallible
        // Win32 operation is checked and the original parent/style are saved.
        unsafe {
            if !IsWindow(Some(child)).as_bool() {
                return Err("桌面工作区窗口句柄已失效。".to_string());
            }
            let worker = locate_worker()?;
            if !IsWindow(Some(worker)).as_bool() {
                return Err("WorkerW 句柄已失效。".to_string());
            }
            let mut guard = ATTACHMENT
                .lock()
                .map_err(|_| "WorkerW 状态锁不可用。".to_string())?;
            if let Some(state) = *guard {
                let current_parent = GetParent(child).ok();
                if state.child == child.0 as isize
                    && IsWindow(Some(hwnd(state.worker))).as_bool()
                    && current_parent.is_some_and(|parent| parent == hwnd(state.worker))
                {
                    return Ok(());
                }
                if state.child == child.0 as isize {
                    let _ = SetParent(child, state.parent.map(hwnd));
                    SetWindowLongPtrW(child, GWL_STYLE, state.style);
                }
                *guard = None;
            }
            let original_parent = GetParent(child).ok().map(|value| value.0 as isize);
            let original_style = GetWindowLongPtrW(child, GWL_STYLE);
            let child_style = WINDOW_STYLE(original_style as u32);
            SetWindowLongPtrW(
                child,
                GWL_STYLE,
                ((child_style & !WS_POPUP) | WS_CHILD).0 as isize,
            );
            if SetParent(child, Some(worker)).is_err() {
                SetWindowLongPtrW(child, GWL_STYLE, original_style);
                return Err("WorkerW 附着失败，窗口已恢复。".to_string());
            }
            SetWindowPos(
                child,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED,
            )
            .map_err(|_| "WorkerW 附着后无法刷新窗口样式。")?;
            *guard = Some(Attachment {
                child: child.0 as isize,
                parent: original_parent,
                worker: worker.0 as isize,
                style: original_style,
            });
        }
        Ok(())
    }

    pub fn detach() -> Result<(), String> {
        let mut guard = ATTACHMENT
            .lock()
            .map_err(|_| "WorkerW 状态锁不可用。".to_string())?;
        let Some(state) = guard.take() else {
            return Ok(());
        };
        let child = hwnd(state.child);
        // SAFETY: The stored HWND is checked before use. Restoring a missing
        // original parent to the desktop top level is represented by None.
        unsafe {
            if !IsWindow(Some(child)).as_bool() {
                return Ok(());
            }
            let parent = state.parent.map(hwnd);
            SetParent(child, parent).map_err(|_| "无法从 WorkerW 安全分离窗口。")?;
            SetWindowLongPtrW(child, GWL_STYLE, state.style);
            SetWindowPos(
                child,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED,
            )
            .map_err(|_| "分离 WorkerW 后无法恢复窗口样式。")?;
        }
        Ok(())
    }
}

#[cfg(windows)]
pub use platform::{attach, detach};

#[cfg(not(windows))]
pub fn attach(_window: &WebviewWindow) -> Result<(), String> {
    Err("WorkerW 模式仅支持 Windows 10/11。".to_string())
}

#[cfg(not(windows))]
pub fn detach() -> Result<(), String> {
    Ok(())
}
