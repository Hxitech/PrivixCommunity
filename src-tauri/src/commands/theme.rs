//! 用户自定义 CSS 主题(v1.5 Agent Studio)
//!
//! 允许用户编辑 `~/.privix/user.css` 覆盖 Apple Design 默认 token,
//! 启动时由前端读取并注入到 `<head>`,打开 CSS 自定义主题的能力。
//!
//! 路径约定:
//!   - macOS / Linux: `$HOME/.privix/user.css`
//!   - Windows: `%USERPROFILE%\.privix\user.css`

use std::fs;
use std::path::PathBuf;

/// 返回 `.privix` 目录路径(不保证存在)
fn privix_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|h| h.join(".privix"))
        .ok_or_else(|| "无法定位 home 目录".to_string())
}

/// 用户 CSS 完整路径
fn user_css_path() -> Result<PathBuf, String> {
    privix_dir().map(|d| d.join("user.css"))
}

/// 读取 `~/.privix/user.css` 内容,文件不存在则返回空串
#[tauri::command]
pub fn read_user_css() -> Result<String, String> {
    let path = user_css_path()?;
    // 直接读,按 NotFound 返回空串(避免 exists + read 的 TOCTOU 竞态)
    match fs::read_to_string(&path) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("读取 user.css 失败: {e}")),
    }
}

/// 写入 `~/.privix/user.css`,自动创建父目录
#[tauri::command]
pub fn write_user_css(content: String) -> Result<(), String> {
    let dir = privix_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建 .privix 目录失败: {e}"))?;
    let path = dir.join("user.css");
    fs::write(&path, content).map_err(|e| format!("写入 user.css 失败: {e}"))
}

/// 返回 user.css 完整路径(用于设置页展示给用户)
#[tauri::command]
pub fn get_user_css_path() -> Result<String, String> {
    Ok(user_css_path()?.to_string_lossy().into_owned())
}
