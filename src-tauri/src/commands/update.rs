use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
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

// 社区版:远程前端更新检查已移除
#[allow(dead_code)]
async fn _check_frontend_update_removed() -> Result<Value, String> {
    Ok(serde_json::json!({ "hasUpdate": false }))
}

// 社区版:下载前端更新已移除
#[allow(dead_code)]
async fn _download_frontend_update_removed(
    url: String,
    expected_hash: String,
    expected_version: String,
) -> Result<Value, String> {
    if url.trim().is_empty() {
        return Err("缺少更新下载地址".to_string());
    }

    let expected_version = expected_version.trim().to_string();
    if expected_version.is_empty() {
        return Err("缺少版本号，已拒绝安装未标记版本的热更新".to_string());
    }

    let expected_hash = expected_hash
        .trim()
        .strip_prefix("sha256:")
        .unwrap_or(expected_hash.trim())
        .trim()
        .to_string();
    if expected_hash.is_empty() {
        return Err("缺少哈希校验信息，已拒绝安装未签名的热更新".to_string());
    }

    let client = super::build_http_client(std::time::Duration::from_secs(120), Some("Privix"))
        .map_err(|e| format!("HTTP 客户端错误: {e}"))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载失败: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("下载失败: HTTP {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取数据失败: {e}"))?;

    // 校验 SHA-256
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let hash = format!("{:x}", hasher.finalize());
    if hash != expected_hash {
        return Err(format!(
            "哈希校验失败: 期望 {}，实际 {}",
            expected_hash, hash
        ));
    }

    let dir = update_dir();
    let staging_dir =
        dir.with_extension(format!("staging-{}", chrono::Utc::now().timestamp_millis()));
    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir).map_err(|e| format!("清理临时目录失败: {e}"))?;
    }
    fs::create_dir_all(&staging_dir).map_err(|e| format!("创建临时目录失败: {e}"))?;

    let extract_result = (|| -> Result<(), String> {
        let cursor = std::io::Cursor::new(bytes.as_ref());
        let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("解压失败: {e}"))?;

        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| format!("读取压缩条目失败: {e}"))?;

            let name = file.name().to_string();
            let relative = sanitize_update_entry_path(&name)?;
            let target = staging_dir.join(relative);

            if file.is_dir() || name.ends_with('/') {
                fs::create_dir_all(&target).map_err(|e| format!("创建子目录失败: {e}"))?;
            } else {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {e}"))?;
                }
                let mut buf = Vec::new();
                file.read_to_end(&mut buf)
                    .map_err(|e| format!("读取文件内容失败: {e}"))?;
                fs::write(&target, &buf).map_err(|e| format!("写入文件失败: {e}"))?;
            }
        }

        if !staging_dir.join("index.html").is_file() {
            return Err("更新包缺少 index.html，无法激活".to_string());
        }

        fs::write(
            update_version_path(&staging_dir),
            format!("{expected_version}\n"),
        )
        .map_err(|e| format!("写入版本文件失败: {e}"))?;
        fs::write(
            update_ready_path(&staging_dir),
            chrono::Utc::now().to_rfc3339(),
        )
        .map_err(|e| format!("写入激活标记失败: {e}"))?;

        Ok(())
    })();

    if let Err(error) = extract_result {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(error);
    }

    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("清理旧更新失败: {e}"))?;
    }
    fs::rename(&staging_dir, &dir).map_err(|e| format!("激活更新失败: {e}"))?;

    Ok(serde_json::json!({
        "success": true,
        "version": expected_version,
        "path": dir.to_string_lossy()
    }))
}

// 社区版:回退前端更新与状态查询命令已移除

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
