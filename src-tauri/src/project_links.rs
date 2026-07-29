use std::path::Path;

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::error::{CommandError, CommandResult};

fn is_windows_absolute_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    let drive_path = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/');
    let unc_parts = value
        .strip_prefix(r"\\")
        .map(|rest| rest.split('\\').filter(|part| !part.is_empty()).count())
        .unwrap_or_default();
    drive_path || unc_parts >= 2
}

fn validated_path(value: &str) -> CommandResult<&str> {
    let path = value.trim();
    if path.is_empty() || path.contains('\0') || !is_windows_absolute_path(path) {
        return Err(CommandError::Invalid(
            "仅支持 Windows 绝对本地路径".into(),
        ));
    }
    Ok(path)
}

/// Check a local file or directory without reading its contents.
#[tauri::command]
pub fn local_path_exists(path: String) -> CommandResult<bool> {
    Ok(Path::new(validated_path(&path)?).try_exists()?)
}

/// Re-check existence and hand the path to the operating system's default application.
#[tauri::command]
pub fn open_local_path(app: AppHandle, path: String) -> CommandResult<()> {
    let path = validated_path(&path)?;
    if !Path::new(path).try_exists()? {
        return Err(CommandError::Invalid("文件或目录不存在".into()));
    }
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|error| CommandError::Invalid(error.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_windows_absolute_path, validated_path};

    #[test]
    fn accepts_drive_and_unc_paths() {
        assert!(is_windows_absolute_path(r"C:\资料\方案.pdf"));
        assert!(is_windows_absolute_path(r"\\server\share\folder"));
    }

    #[test]
    fn rejects_relative_and_non_windows_paths() {
        assert!(validated_path(r"docs\plan.pdf").is_err());
        assert!(validated_path("/tmp/plan.pdf").is_err());
        assert!(validated_path("  ").is_err());
    }
}
