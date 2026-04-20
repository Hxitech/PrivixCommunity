use std::fs;
use std::path::{Component, Path, PathBuf};

/// 前端热更新目录 (~/.openclaw/privix-community/web-update/)
pub fn update_dir() -> PathBuf {
    super::panel_runtime_dir().join("web-update")
}

// 社区版不做远程更新检查
const UPDATE_VERSION_FILE: &str = ".version";
const UPDATE_READY_FILE: &str = ".ready";

fn update_version_path(dir: &Path) -> PathBuf {
    dir.join(UPDATE_VERSION_FILE)
}

fn update_ready_path(dir: &Path) -> PathBuf {
    dir.join(UPDATE_READY_FILE)
}

fn sanitize_update_entry_path(name: &str) -> Result<PathBuf, String> {
    let raw = Path::new(name);
    let mut normalized = PathBuf::new();
    for component in raw.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("更新包包含非法路径: {name}"));
            }
        }
    }

    if normalized.as_os_str().is_empty() {
        return Err(format!("更新包包含空路径: {name}"));
    }

    Ok(normalized)
}

fn prepared_update_version(dir: &Path) -> Option<String> {
    let index_path = dir.join("index.html");
    if !index_path.is_file() || !update_ready_path(dir).is_file() {
        return None;
    }

    let version = fs::read_to_string(update_version_path(dir)).ok()?;
    let trimmed = version.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn resolve_active_update_file(dir: &Path, request_path: &str) -> Option<PathBuf> {
    let update_version = prepared_update_version(dir)?;
    if !version_gt(&update_version, env!("CARGO_PKG_VERSION")) {
        return None;
    }

    let relative = sanitize_update_entry_path(request_path).ok()?;
    let candidate = dir.join(relative);
    candidate.is_file().then_some(candidate)
}

// 社区版:所有远程更新命令已移除。resolve_active_update_file 仍保留,
// 以便未来本地放置热更新包时 tauri URI scheme 能加载。

/// 简单的语义化版本比较：current >= required
fn version_ge(current: &str, required: &str) -> bool {
    let parse = |s: &str| -> Vec<u32> {
        s.trim_start_matches('v')
            .split('.')
            .filter_map(|p| p.parse().ok())
            .collect()
    };
    let c = parse(current);
    let r = parse(required);
    for i in 0..r.len().max(c.len()) {
        let cv = c.get(i).copied().unwrap_or(0);
        let rv = r.get(i).copied().unwrap_or(0);
        if cv > rv {
            return true;
        }
        if cv < rv {
            return false;
        }
    }
    true
}

fn version_gt(left: &str, right: &str) -> bool {
    version_ge(left, right) && !version_ge(right, left)
}

/// 根据文件扩展名推断 MIME 类型
pub fn mime_from_path(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html",
        "js" | "mjs" => "application/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::{sanitize_update_entry_path, version_gt};

    #[test]
    fn update_entry_paths_reject_traversal() {
        assert!(sanitize_update_entry_path("../index.html").is_err());
        assert!(sanitize_update_entry_path("/tmp/index.html").is_err());
        assert!(sanitize_update_entry_path("nested/../../evil.js").is_err());
    }

    #[test]
    fn update_entry_paths_keep_relative_files() {
        assert_eq!(
            sanitize_update_entry_path("assets/index.js")
                .unwrap()
                .to_string_lossy(),
            "assets/index.js"
        );
    }

    #[test]
    fn version_gt_detects_only_strictly_newer_versions() {
        assert!(version_gt("1.0.18", "1.0.17"));
        assert!(!version_gt("1.0.17", "1.0.17"));
        assert!(!version_gt("1.0.16", "1.0.17"));
    }
}
