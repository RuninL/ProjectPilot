use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::WebviewWindow;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopHostStatus {
    Unsupported,
    Disabled,
    Attached,
    Degraded,
}

#[derive(Clone, Copy, Debug)]
struct Attachment {
    child: isize,
    parent: Option<isize>,
    worker: isize,
    style: isize,
}

#[derive(Clone, Copy)]
struct HostState {
    attachment: Option<Attachment>,
    status: DesktopHostStatus,
}

#[cfg(not(windows))]
const INITIAL_STATUS: DesktopHostStatus = DesktopHostStatus::Unsupported;
#[cfg(all(windows, not(feature = "windows-desktop-host")))]
const INITIAL_STATUS: DesktopHostStatus = DesktopHostStatus::Disabled;
#[cfg(all(windows, feature = "windows-desktop-host"))]
const INITIAL_STATUS: DesktopHostStatus = DesktopHostStatus::Degraded;

static STATE: Mutex<HostState> = Mutex::new(HostState {
    attachment: None,
    status: INITIAL_STATUS,
});
static OPERATION_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

struct OperationGuard;

impl OperationGuard {
    fn acquire() -> Result<Self, String> {
        OPERATION_IN_PROGRESS
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .map(|_| Self)
            .map_err(|_| "桌面宿主正在更新，请稍后重试。".to_string())
    }
}

impl Drop for OperationGuard {
    fn drop(&mut self) {
        OPERATION_IN_PROGRESS.store(false, Ordering::Release);
    }
}

pub fn status() -> DesktopHostStatus {
    STATE
        .lock()
        .map(|state| state.status)
        .unwrap_or(DesktopHostStatus::Degraded)
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RecoveryBudget {
    failures: u8,
}

impl RecoveryBudget {
    pub const MAX_FAILURES: u8 = 3;

    pub fn from_initial_failure(failed: bool) -> Self {
        Self {
            failures: u8::from(failed),
        }
    }

    pub fn record_failure(&mut self) -> bool {
        self.failures = self.failures.saturating_add(1);
        self.failures < Self::MAX_FAILURES
    }

    pub fn delay_seconds(self) -> u64 {
        5_u64.saturating_mul(1_u64 << self.failures.min(Self::MAX_FAILURES))
    }
}

#[cfg(all(windows, feature = "windows-desktop-host"))]
mod platform {
    use super::Attachment;
    use std::ffi::c_void;
    use tauri::WebviewWindow;
    use windows::core::{w, BOOL};
    use windows::Win32::Foundation::{
        GetLastError, SetLastError, HWND, LPARAM, POINT, RECT, WIN32_ERROR, WPARAM,
    };
    use windows::Win32::Graphics::Gdi::ScreenToClient;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FindWindowExW, FindWindowW, GetParent, GetWindowLongPtrW, GetWindowRect,
        IsWindow, SendMessageTimeoutW, SetWindowLongPtrW, SetWindowPos, GWL_STYLE,
        SEND_MESSAGE_TIMEOUT_FLAGS, SMTO_ABORTIFHUNG, SWP_FRAMECHANGED, SWP_NOOWNERZORDER,
        SWP_NOSIZE, SWP_NOZORDER, WINDOW_STYLE, WS_CHILD, WS_POPUP,
    };

    const SPAWN_WORKER_MESSAGE: u32 = 0x052C;
    const EXPLORER_MESSAGE_TIMEOUT_MS: u32 = 1_000;

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct HostCandidate {
        shell_window: isize,
        worker_after: Option<isize>,
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        #[link_name = "SetParent"]
        fn set_parent_raw(child: HWND, parent: HWND) -> HWND;
    }

    fn hwnd(value: isize) -> HWND {
        HWND(value as *mut c_void)
    }

    fn raw(value: HWND) -> isize {
        value.0 as isize
    }

    fn choose_host(candidates: &[HostCandidate]) -> Option<isize> {
        candidates
            .iter()
            .find_map(|candidate| candidate.worker_after)
    }

    unsafe extern "system" fn collect_candidates(parent: HWND, context: LPARAM) -> BOOL {
        // SAFETY: EnumWindows supplies a top-level HWND. The context points to
        // a Vec that lives for the complete synchronous enumeration.
        let has_def_view =
            unsafe { FindWindowExW(Some(parent), None, w!("SHELLDLL_DefView"), None) }.is_ok();
        if has_def_view {
            let worker_after = unsafe { FindWindowExW(None, Some(parent), w!("WorkerW"), None) }
                .ok()
                .map(raw);
            let candidates = context.0 as *mut Vec<HostCandidate>;
            if !candidates.is_null() {
                unsafe {
                    (*candidates).push(HostCandidate {
                        shell_window: raw(parent),
                        worker_after,
                    });
                }
            }
        }
        true.into()
    }

    fn locate_worker() -> Result<HWND, String> {
        // SAFETY: Handles are validated after discovery and the stack context
        // is used only during synchronous enumeration.
        unsafe {
            let progman =
                FindWindowW(w!("Progman"), None).map_err(|_| "无法找到 Windows 桌面 Progman。")?;
            let mut message_result = 0usize;
            SetLastError(WIN32_ERROR(0));
            let sent = SendMessageTimeoutW(
                progman,
                SPAWN_WORKER_MESSAGE,
                WPARAM(0xD),
                LPARAM(0),
                SEND_MESSAGE_TIMEOUT_FLAGS(SMTO_ABORTIFHUNG.0),
                EXPLORER_MESSAGE_TIMEOUT_MS,
                Some(&mut message_result),
            );
            if sent.0 == 0 {
                return Err(format!(
                    "Explorer 桌面宿主消息超时或失败（错误 {}）。",
                    GetLastError().0
                ));
            }

            let mut candidates = Vec::new();
            EnumWindows(
                Some(collect_candidates),
                LPARAM((&mut candidates as *mut Vec<HostCandidate>) as isize),
            )
            .map_err(|_| "无法枚举 Windows 桌面窗口。")?;
            let worker = choose_host(&candidates)
                .map(hwnd)
                .ok_or_else(|| "未找到可用的 Explorer 桌面宿主。".to_string())?;
            if !IsWindow(Some(worker)).as_bool() {
                return Err("Explorer 桌面宿主句柄已失效。".to_string());
            }
            Ok(worker)
        }
    }

    fn set_parent_checked(child: HWND, parent: Option<HWND>) -> Result<(), String> {
        // SetParent legitimately returns NULL when a top-level window had no
        // previous parent, so the generated windows-rs wrapper cannot
        // distinguish that success case. Check GetLastError and the resulting
        // parent explicitly instead.
        unsafe {
            SetLastError(WIN32_ERROR(0));
            let _previous = set_parent_raw(child, parent.unwrap_or_default());
            let error = GetLastError();
            let actual = GetParent(child).ok();
            if error.0 != 0 || actual != parent {
                return Err(format!("SetParent 失败（错误 {}）。", error.0));
            }
        }
        Ok(())
    }

    fn set_style_checked(child: HWND, style: isize) -> Result<(), String> {
        unsafe {
            SetLastError(WIN32_ERROR(0));
            let previous = SetWindowLongPtrW(child, GWL_STYLE, style);
            let error = GetLastError();
            if previous == 0 && error.0 != 0 {
                return Err(format!("更新桌面小窗样式失败（错误 {}）。", error.0));
            }
        }
        Ok(())
    }

    fn window_origin(child: HWND) -> Result<POINT, String> {
        let mut rect = RECT::default();
        unsafe { GetWindowRect(child, &mut rect) }
            .map_err(|_| "无法读取桌面小窗屏幕坐标。".to_string())?;
        Ok(POINT {
            x: rect.left,
            y: rect.top,
        })
    }

    fn point_for_parent(parent: Option<HWND>, mut point: POINT) -> Result<POINT, String> {
        if let Some(parent) = parent {
            if !unsafe { ScreenToClient(parent, &mut point) }.as_bool() {
                return Err("无法将屏幕坐标转换为桌面宿主坐标。".to_string());
            }
        }
        Ok(point)
    }

    pub fn attach(window: &WebviewWindow) -> Result<Attachment, String> {
        let child = window.hwnd().map_err(|_| "无法取得桌面小窗窗口句柄。")?;
        if !unsafe { IsWindow(Some(child)) }.as_bool() {
            return Err("桌面小窗窗口句柄已失效。".to_string());
        }
        let worker = locate_worker()?;
        let original_parent = unsafe { GetParent(child) }.ok();
        let original_style = unsafe { GetWindowLongPtrW(child, GWL_STYLE) };
        let origin = window_origin(child)?;
        let child_style = WINDOW_STYLE(original_style as u32);

        set_style_checked(child, ((child_style & !WS_POPUP) | WS_CHILD).0 as isize)?;
        if let Err(error) = set_parent_checked(child, Some(worker)) {
            let _ = set_style_checked(child, original_style);
            return Err(format!("桌面宿主挂载失败：{error}"));
        }
        let attachment = Attachment {
            child: raw(child),
            parent: original_parent.map(raw),
            worker: raw(worker),
            style: original_style,
        };
        let hosted_origin = match point_for_parent(Some(worker), origin) {
            Ok(point) => point,
            Err(error) => {
                let _ = detach(attachment);
                return Err(error);
            }
        };
        if unsafe {
            SetWindowPos(
                child,
                None,
                hosted_origin.x,
                hosted_origin.y,
                0,
                0,
                SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED,
            )
        }
        .is_err()
        {
            let _ = detach(attachment);
            return Err("桌面宿主挂载后无法恢复屏幕位置，已安全降级。".to_string());
        }

        Ok(attachment)
    }

    pub fn is_valid(attachment: Attachment) -> bool {
        let child = hwnd(attachment.child);
        let worker = hwnd(attachment.worker);
        unsafe {
            IsWindow(Some(child)).as_bool()
                && IsWindow(Some(worker)).as_bool()
                && GetParent(child).ok() == Some(worker)
        }
    }

    pub fn detach(attachment: Attachment) -> Result<(), String> {
        let child = hwnd(attachment.child);
        if !unsafe { IsWindow(Some(child)) }.as_bool() {
            return Ok(());
        }
        let origin = window_origin(child)?;
        let parent = attachment.parent.map(hwnd);
        set_parent_checked(child, parent)?;
        set_style_checked(child, attachment.style)?;
        let restored_origin = point_for_parent(parent, origin)?;
        unsafe {
            SetWindowPos(
                child,
                None,
                restored_origin.x,
                restored_origin.y,
                0,
                0,
                SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED,
            )
        }
        .map_err(|_| "分离桌面宿主后无法恢复窗口位置。".to_string())
    }

    pub fn screen_position(window: &WebviewWindow) -> Result<(i32, i32), String> {
        let child = window.hwnd().map_err(|_| "无法取得桌面小窗窗口句柄。")?;
        let point = window_origin(child)?;
        Ok((point.x, point.y))
    }

    pub fn set_screen_position(window: &WebviewWindow, x: i32, y: i32) -> Result<(), String> {
        let child = window.hwnd().map_err(|_| "无法取得桌面小窗窗口句柄。")?;
        let parent = unsafe { GetParent(child) }.ok();
        let point = point_for_parent(parent, POINT { x, y })?;
        unsafe {
            SetWindowPos(
                child,
                None,
                point.x,
                point.y,
                0,
                0,
                SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER,
            )
        }
        .map_err(|_| "无法设置桌面小窗屏幕位置。".to_string())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn chooses_worker_after_shell_view_among_multiple_workers() {
            let candidates = [
                HostCandidate {
                    shell_window: 10,
                    worker_after: None,
                },
                HostCandidate {
                    shell_window: 20,
                    worker_after: Some(21),
                },
                HostCandidate {
                    shell_window: 30,
                    worker_after: Some(31),
                },
            ];
            assert_eq!(choose_host(&candidates), Some(21));
        }

        #[test]
        fn discovery_without_worker_fails_cleanly() {
            assert_eq!(
                choose_host(&[HostCandidate {
                    shell_window: 10,
                    worker_after: None,
                }]),
                None
            );
        }
    }
}

#[cfg(all(windows, feature = "windows-desktop-host"))]
pub fn attach(window: &WebviewWindow) -> Result<(), String> {
    let _operation = OperationGuard::acquire()?;
    let previous = {
        let mut state = STATE
            .lock()
            .map_err(|_| "桌面宿主状态锁不可用。".to_string())?;
        if state.attachment.is_some_and(platform::is_valid) {
            state.status = DesktopHostStatus::Attached;
            return Ok(());
        }
        state.attachment.take()
    };
    if let Some(previous) = previous {
        let _ = platform::detach(previous);
    }
    match platform::attach(window) {
        Ok(attachment) => {
            let mut state = STATE
                .lock()
                .map_err(|_| "桌面宿主状态锁不可用。".to_string())?;
            state.attachment = Some(attachment);
            state.status = DesktopHostStatus::Attached;
            Ok(())
        }
        Err(error) => {
            if let Ok(mut state) = STATE.lock() {
                state.attachment = None;
                state.status = DesktopHostStatus::Degraded;
            }
            Err(error)
        }
    }
}

#[cfg(not(all(windows, feature = "windows-desktop-host")))]
pub fn attach(_window: &WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[cfg(all(windows, feature = "windows-desktop-host"))]
pub fn is_attached() -> bool {
    let attachment = STATE.lock().ok().and_then(|state| state.attachment);
    attachment.is_some_and(platform::is_valid)
}

#[cfg(not(all(windows, feature = "windows-desktop-host")))]
pub fn is_attached() -> bool {
    false
}

#[cfg(all(windows, feature = "windows-desktop-host"))]
pub fn detach() -> Result<(), String> {
    let _operation = OperationGuard::acquire()?;
    let attachment = {
        let mut state = STATE
            .lock()
            .map_err(|_| "桌面宿主状态锁不可用。".to_string())?;
        state.status = DesktopHostStatus::Degraded;
        state.attachment.take()
    };
    if let Some(attachment) = attachment {
        platform::detach(attachment)?;
    }
    Ok(())
}

#[cfg(not(all(windows, feature = "windows-desktop-host")))]
pub fn detach() -> Result<(), String> {
    Ok(())
}

#[cfg(all(windows, feature = "windows-desktop-host"))]
pub fn screen_position(window: &WebviewWindow) -> Result<(i32, i32), String> {
    platform::screen_position(window)
}

#[cfg(not(all(windows, feature = "windows-desktop-host")))]
pub fn screen_position(window: &WebviewWindow) -> Result<(i32, i32), String> {
    window
        .outer_position()
        .map(|position| (position.x, position.y))
        .map_err(|error| format!("无法读取桌面小窗屏幕位置：{error}"))
}

#[cfg(all(windows, feature = "windows-desktop-host"))]
pub fn set_screen_position(window: &WebviewWindow, x: i32, y: i32) -> Result<(), String> {
    platform::set_screen_position(window, x, y)
}

#[cfg(not(all(windows, feature = "windows-desktop-host")))]
pub fn set_screen_position(window: &WebviewWindow, x: i32, y: i32) -> Result<(), String> {
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|error| format!("无法设置桌面小窗屏幕位置：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_is_bounded_and_uses_backoff() {
        let mut budget = RecoveryBudget::default();
        assert_eq!(budget.delay_seconds(), 5);
        assert!(budget.record_failure());
        assert_eq!(budget.delay_seconds(), 10);
        assert!(budget.record_failure());
        assert_eq!(budget.delay_seconds(), 20);
        assert!(!budget.record_failure());
        assert_eq!(budget.delay_seconds(), 40);
        assert!(!budget.record_failure());
    }

    #[test]
    fn initial_attachment_failure_counts_toward_budget() {
        let mut budget = RecoveryBudget::from_initial_failure(true);
        assert!(budget.record_failure());
        assert!(!budget.record_failure());
    }
}
