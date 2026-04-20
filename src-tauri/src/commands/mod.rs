use serde_json::json;
use std::fs;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};
use std::time::Duration;

/// openclaw_dir() 结果缓存 — 避免每次调用都读磁盘解析 clawpanel.json
static OPENCLAW_DIR_CACHE: std::sync::LazyLock<RwLock<Option<PathBuf>>> =
    std::sync::LazyLock::new(|| RwLock::new(None));

/// gateway 端口缓存（带 5 秒 TTL）— 避免每次调用都读 openclaw.json
static GATEWAY_PORT_CACHE: std::sync::LazyLock<std::sync::Mutex<(u16, std::time::Instant)>> =
    std::sync::LazyLock::new(|| {
        std::sync::Mutex::new((18789, std::time::Instant::now() - Duration::from_secs(60)))
    });

pub mod agent;
pub mod agent_detect;
pub mod assistant;
pub mod config;
pub mod device;
pub mod diagnose;
pub mod hermes;
pub mod knowledge;
pub mod logs;
pub mod memory;
pub mod messaging;
pub mod pairing;
pub mod service;
pub mod skillhub;
pub mod skills;
pub mod theme;
pub mod update;

/// 默认 OpenClaw 配置目录（面板自身配置始终保存在这里）。
/// 优先读取 OPENCLAW_DIR 环境变量，降级到旧版 CLAWDBOT_DIR / MOLTBOT_DIR（并打印废弃警告）。
fn default_openclaw_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("OPENCLAW_DIR") {
        let p = PathBuf::from(&dir);
        if !dir.trim().is_empty() && p.exists() {
            return p;
        }
    }
    // 向下兼容旧环境变量名，检测到时输出废弃警告
    for legacy_var in &["CLAWDBOT_DIR", "MOLTBOT_DIR"] {
        if let Ok(dir) = std::env::var(legacy_var) {
            let p = PathBuf::from(&dir);
            if !dir.trim().is_empty() && p.exists() {
                eprintln!(
                    "[Privix] 警告: 环境变量 {} 已废弃，请改用 OPENCLAW_DIR，当前值: {}",
                    legacy_var, dir
                );
                return p;
            }
        }
    }
    dirs::home_dir().unwrap_or_default().join(".openclaw")
}

const DEFAULT_PRODUCT_PROFILE_ID: &str = "prospectclaw";

/// v1.2.2 起统一为 "prospectclaw"，不再区分 invest_workbench / local_qa_kb / doc_sop。
/// 保留函数签名以兼容所有调用方。
pub fn active_product_profile_id() -> &'static str {
    DEFAULT_PRODUCT_PROFILE_ID
}

/// 旧版 profile ID 列表，用于配置目录回退查找
const LEGACY_PROFILE_IDS: &[&str] = &["invest_workbench", "local_qa_kb", "doc_sop"];

/// 获取 OpenClaw 配置目录（带缓存）。
/// 优先使用面板配置中的 openclawDir，自定义目录不存在时回退默认 ~/.openclaw。
pub fn openclaw_dir() -> PathBuf {
    // 读缓存
    if let Ok(guard) = OPENCLAW_DIR_CACHE.read() {
        if let Some(ref cached) = *guard {
            return cached.clone();
        }
    }
    let result = compute_openclaw_dir();
    if let Ok(mut guard) = OPENCLAW_DIR_CACHE.write() {
        *guard = Some(result.clone());
    }
    result
}

fn compute_openclaw_dir() -> PathBuf {
    for config_path in [panel_config_path_raw(), legacy_panel_config_path()] {
        if let Ok(content) = std::fs::read_to_string(&config_path) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(custom) = v.get("openclawDir").and_then(|d| d.as_str()) {
                    let p = PathBuf::from(custom);
                    if !custom.trim().is_empty() && p.exists() {
                        return p;
                    }
                }
            }
        }
    }
    default_openclaw_dir()
}

/// 清除 openclaw_dir 缓存（配置写入后调用）
pub fn invalidate_openclaw_dir_cache() {
    if let Ok(mut guard) = OPENCLAW_DIR_CACHE.write() {
        *guard = None;
    }
}

pub fn panel_profiles_dir() -> PathBuf {
    default_openclaw_dir().join("prospectclaw")
}

static PANEL_RUNTIME_DIR_CACHE: OnceLock<PathBuf> = OnceLock::new();

fn panel_runtime_dir_raw() -> PathBuf {
    PANEL_RUNTIME_DIR_CACHE
        .get_or_init(|| {
            let profiles = panel_profiles_dir();
            let unified = profiles.join(active_product_profile_id());
            if unified.join("clawpanel.json").exists() {
                return unified;
            }
            for legacy_id in LEGACY_PROFILE_IDS {
                let legacy = profiles.join(legacy_id);
                if legacy.join("clawpanel.json").exists() {
                    return legacy;
                }
            }
            unified
        })
        .clone()
}

pub fn panel_runtime_dir() -> PathBuf {
    let dir = panel_runtime_dir_raw();
    let _ = ensure_panel_profile_layout();
    dir
}

pub fn panel_config_path() -> PathBuf {
    let _ = ensure_panel_profile_layout();
    panel_runtime_dir_raw().join("clawpanel.json")
}

fn panel_config_path_raw() -> PathBuf {
    panel_runtime_dir_raw().join("clawpanel.json")
}

/// Gateway 监听端口（带 5 秒 TTL 缓存，避免每次都读 openclaw.json）
pub fn gateway_listen_port() -> u16 {
    const TTL: Duration = Duration::from_secs(5);
    if let Ok(guard) = GATEWAY_PORT_CACHE.lock() {
        if guard.1.elapsed() < TTL {
            return guard.0;
        }
    }
    let port = config::load_openclaw_json()
        .ok()
        .and_then(|cfg| {
            cfg.get("gateway")
                .and_then(|g| g.get("port"))
                .and_then(|v| v.as_u64())
        })
        .map(|port| port.clamp(1, u16::MAX as u64) as u16)
        .unwrap_or(18789);
    if let Ok(mut guard) = GATEWAY_PORT_CACHE.lock() {
        *guard = (port, std::time::Instant::now());
    }
    port
}

/// 清除 gateway 端口缓存（配置写入后调用）
pub fn invalidate_gateway_port_cache() {
    if let Ok(mut guard) = GATEWAY_PORT_CACHE.lock() {
        guard.1 = std::time::Instant::now() - Duration::from_secs(60);
    }
}

fn legacy_panel_config_path() -> PathBuf {
    default_openclaw_dir().join("clawpanel.json")
}

fn legacy_panel_data_dir() -> PathBuf {
    default_openclaw_dir().join("clawpanel")
}

fn legacy_docker_nodes_path() -> PathBuf {
    default_openclaw_dir().join("docker-nodes.json")
}

fn legacy_instances_path() -> PathBuf {
    default_openclaw_dir().join("instances.json")
}

fn migrate_core_config_files(src_dir: &Path, dst_dir: &Path) -> Result<(), String> {
    for name in ["clawpanel.json", "docker-nodes.json", "instances.json"] {
        copy_file_if_missing(&src_dir.join(name), &dst_dir.join(name))?;
    }
    Ok(())
}

fn copy_file_if_missing(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.is_file() || dst.exists() {
        return Ok(());
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::copy(src, dst).map_err(|e| format!("迁移文件 {} 失败: {e}", src.display()))?;
    Ok(())
}

fn copy_dir_recursive_if_missing(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.is_dir() || dst.exists() {
        return Ok(());
    }
    fs::create_dir_all(dst).map_err(|e| format!("创建目录失败: {e}"))?;
    let entries = fs::read_dir(src).map_err(|e| format!("读取目录 {} 失败: {e}", src.display()))?;
    for entry in entries.flatten() {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive_if_missing(&src_path, &dst_path)?;
        } else {
            copy_file_if_missing(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

pub fn normalize_panel_config_for_command(mut config: serde_json::Value) -> serde_json::Value {
    if !config.is_object() {
        config = json!({});
    }
    let config_map = config
        .as_object_mut()
        .expect("panel config must be object after normalization");
    if !config_map
        .get("productProfile")
        .map(|entry| entry.is_object())
        .unwrap_or(false)
    {
        config_map.insert("productProfile".into(), json!({}));
    }
    let product_profile = config_map
        .get_mut("productProfile")
        .and_then(serde_json::Value::as_object_mut)
        .expect("productProfile must be object");
    product_profile.insert(
        "baseProfileId".into(),
        serde_json::Value::String(active_product_profile_id().to_string()),
    );
    if !product_profile.contains_key("profileVersion") {
        product_profile.insert("profileVersion".into(), json!(1));
    }
    if !product_profile.contains_key("enabledCapabilities") {
        product_profile.insert(
            "enabledCapabilities".into(),
            serde_json::Value::Array(vec![]),
        );
    }
    if config_map
        .get("license")
        .map(|entry| entry.is_object())
        .unwrap_or(false)
    {
        let license = config_map
            .get_mut("license")
            .and_then(serde_json::Value::as_object_mut)
            .expect("license must be object");
        if !license.contains_key("productProfileId") {
            license.insert(
                "productProfileId".into(),
                serde_json::Value::String(active_product_profile_id().to_string()),
            );
        }
    }
    config
}

pub fn ensure_panel_profile_layout() -> Result<(), String> {
    let profiles_dir = panel_profiles_dir();
    fs::create_dir_all(&profiles_dir).map_err(|e| format!("创建 profile 目录失败: {e}"))?;

    let runtime_dir = panel_runtime_dir_raw();
    fs::create_dir_all(&runtime_dir).map_err(|e| format!("创建运行时目录失败: {e}"))?;

    if !runtime_dir.join("clawpanel.json").exists() {
        let mut migrated = false;
        for legacy_id in LEGACY_PROFILE_IDS {
            let legacy_profile_dir = profiles_dir.join(legacy_id);
            if legacy_profile_dir.join("clawpanel.json").exists() {
                migrate_core_config_files(&legacy_profile_dir, &runtime_dir)?;
                migrated = true;
                break;
            }
        }
        if !migrated {
            copy_file_if_missing(
                &legacy_panel_config_path(),
                &runtime_dir.join("clawpanel.json"),
            )?;
            copy_file_if_missing(
                &legacy_docker_nodes_path(),
                &runtime_dir.join("docker-nodes.json"),
            )?;
            copy_file_if_missing(
                &legacy_instances_path(),
                &runtime_dir.join("instances.json"),
            )?;
        }

        let legacy_data_dir = legacy_panel_data_dir();
        if legacy_data_dir.is_dir() {
            let entries =
                fs::read_dir(&legacy_data_dir).map_err(|e| format!("读取旧面板目录失败: {e}"))?;
            for entry in entries.flatten() {
                let src_path = entry.path();
                let dst_path = runtime_dir.join(entry.file_name());
                if src_path.is_dir() {
                    copy_dir_recursive_if_missing(&src_path, &dst_path)?;
                } else {
                    copy_file_if_missing(&src_path, &dst_path)?;
                }
            }
        }
    }

    let config_path = runtime_dir.join("clawpanel.json");
    let normalized = if config_path.exists() {
        fs::read_to_string(&config_path)
            .ok()
            .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
            .map(normalize_panel_config_for_command)
            .unwrap_or_else(|| normalize_panel_config_for_command(json!({})))
    } else {
        normalize_panel_config_for_command(json!({}))
    };
    let serialized = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("序列化面板配置失败: {e}"))?;
    let should_write = fs::read_to_string(&config_path)
        .map(|current| current != serialized)
        .unwrap_or(true);
    if should_write {
        fs::write(&config_path, serialized).map_err(|e| format!("写入面板配置失败: {e}"))?;
    }

    Ok(())
}

pub(crate) fn read_panel_config_value() -> Option<serde_json::Value> {
    let _ = ensure_panel_profile_layout();
    std::fs::read_to_string(panel_config_path())
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .map(normalize_panel_config_for_command)
}

pub fn configured_proxy_url() -> Option<String> {
    let value = read_panel_config_value()?;
    let raw = value
        .get("networkProxy")
        .and_then(|entry| {
            if let Some(obj) = entry.as_object() {
                obj.get("url").and_then(|v| v.as_str())
            } else {
                entry.as_str()
            }
        })?
        .trim()
        .to_string();
    if raw.is_empty() {
        None
    } else {
        Some(raw)
    }
}

fn should_bypass_proxy_host(host: &str) -> bool {
    let lower = host.trim().to_ascii_lowercase();
    if lower.is_empty() || lower == "localhost" || lower.ends_with(".local") {
        return true;
    }
    if let Ok(ip) = lower.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
            IpAddr::V6(v6) => {
                v6.is_loopback() || v6.is_unique_local() || v6.is_unicast_link_local()
            }
        };
    }
    false
}

/// 构建 HTTP 客户端，use_proxy=true 时走用户配置的代理
pub fn build_http_client(
    timeout: Duration,
    user_agent: Option<&str>,
) -> Result<reqwest::Client, String> {
    build_http_client_opt(timeout, user_agent, true)
}

/// 构建模型请求用的 HTTP 客户端
/// 默认不走代理；用户在面板设置中开启 proxyModelRequests 后才走代理
pub fn build_http_client_no_proxy(
    timeout: Duration,
    user_agent: Option<&str>,
) -> Result<reqwest::Client, String> {
    let use_proxy = read_panel_config_value()
        .and_then(|v| v.get("networkProxy")?.get("proxyModelRequests")?.as_bool())
        .unwrap_or(false);
    build_http_client_opt(timeout, user_agent, use_proxy)
}

fn build_http_client_opt(
    timeout: Duration,
    user_agent: Option<&str>,
    use_proxy: bool,
) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(timeout);
    if let Some(ua) = user_agent {
        builder = builder.user_agent(ua);
    }
    if use_proxy {
        if let Some(proxy_url) = configured_proxy_url() {
            let proxy_value = proxy_url.clone();
            builder = builder.proxy(reqwest::Proxy::custom(move |url| {
                let host = url.host_str().unwrap_or("");
                if should_bypass_proxy_host(host) {
                    None
                } else {
                    Some(proxy_value.clone())
                }
            }));
        }
    }
    builder.build().map_err(|e| e.to_string())
}

pub fn apply_proxy_env(cmd: &mut std::process::Command) {
    if let Some(proxy_url) = configured_proxy_url() {
        cmd.env("HTTP_PROXY", &proxy_url)
            .env("HTTPS_PROXY", &proxy_url)
            .env("http_proxy", &proxy_url)
            .env("https_proxy", &proxy_url)
            .env("NO_PROXY", "localhost,127.0.0.1,::1")
            .env("no_proxy", "localhost,127.0.0.1,::1");
    }
}

pub fn apply_proxy_env_tokio(cmd: &mut tokio::process::Command) {
    if let Some(proxy_url) = configured_proxy_url() {
        cmd.env("HTTP_PROXY", &proxy_url)
            .env("HTTPS_PROXY", &proxy_url)
            .env("http_proxy", &proxy_url)
            .env("https_proxy", &proxy_url)
            .env("NO_PROXY", "localhost,127.0.0.1,::1")
            .env("no_proxy", "localhost,127.0.0.1,::1");
    }
}

/// 缓存 enhanced_path 结果，避免每次调用都扫描文件系统
/// 使用 RwLock 替代 OnceLock，支持运行时刷新缓存
static ENHANCED_PATH_CACHE: RwLock<Option<String>> = RwLock::new(None);

/// Tauri 应用启动时 PATH 可能不完整：
/// - macOS 从 Finder 启动时 PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin
/// - Windows 上安装 Node.js 到非默认路径、或安装后未重启进程
///
/// 补充 Node.js / npm 常见安装路径
pub fn enhanced_path() -> String {
    // 先尝试读缓存
    if let Ok(guard) = ENHANCED_PATH_CACHE.read() {
        if let Some(ref cached) = *guard {
            return cached.clone();
        }
    }
    // 缓存为空，重新构建
    let path = build_enhanced_path();
    if let Ok(mut guard) = ENHANCED_PATH_CACHE.write() {
        *guard = Some(path.clone());
    }
    path
}

/// 刷新 enhanced_path 缓存，使新设置的 Node.js 路径立即生效（无需重启应用）
pub fn refresh_enhanced_path() {
    let new_path = build_enhanced_path();
    if let Ok(mut guard) = ENHANCED_PATH_CACHE.write() {
        *guard = Some(new_path);
    }
}

fn node_version_sort_key(name: &std::ffi::OsStr) -> (u32, u32, u32, String) {
    let text = name.to_string_lossy().to_string();
    let mut parts = text
        .trim_start_matches('v')
        .split(|c: char| !c.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<u32>().ok());

    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        text,
    )
}

fn build_enhanced_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let home = dirs::home_dir().unwrap_or_default();

    // 读取用户保存的自定义 Node.js 路径
    let custom_path = read_panel_config_value().and_then(|v| {
        v.get("nodePath")
            .and_then(|value| value.as_str())
            .map(String::from)
    });

    #[cfg(target_os = "macos")]
    {
        let mut extra: Vec<String> = vec![
            "/usr/local/bin".into(),
            "/opt/homebrew/bin".into(),
            format!("{}/.nvm/current/bin", home.display()),
            format!("{}/.volta/bin", home.display()),
            format!("{}/.nodenv/shims", home.display()),
            format!("{}/n/bin", home.display()),
            format!("{}/.npm-global/bin", home.display()),
        ];
        // NPM_CONFIG_PREFIX: 用户通过 npm config set prefix 自定义的全局安装路径
        if let Ok(prefix) = std::env::var("NPM_CONFIG_PREFIX") {
            extra.push(format!("{}/bin", prefix));
        }
        // standalone 安装目录（集中管理，避免多处硬编码）
        for sa_dir in config::all_standalone_dirs() {
            extra.push(sa_dir.to_string_lossy().into_owned());
        }
        // 扫描 nvm 实际安装的版本目录（兼容无 current 符号链接的情况）
        // 按版本号倒序排列，确保最新版优先（修复 #143：v20 排在 v24 前面）
        let nvm_versions = home.join(".nvm/versions/node");
        if nvm_versions.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
                let mut dirs: Vec<_> = entries
                    .flatten()
                    .filter(|e| e.path().join("bin").is_dir())
                    .collect();
                dirs.sort_by_key(|b| std::cmp::Reverse(node_version_sort_key(&b.file_name())));
                for entry in dirs {
                    extra.push(entry.path().join("bin").to_string_lossy().to_string());
                }
            }
        }
        // fnm: 扫描 $FNM_DIR 或默认 ~/.local/share/fnm 下的版本目录
        let fnm_dir = std::env::var("FNM_DIR")
            .ok()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| home.join(".local/share/fnm"));
        let fnm_versions = fnm_dir.join("node-versions");
        if fnm_versions.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&fnm_versions) {
                let mut dirs: Vec<_> = entries
                    .flatten()
                    .filter(|e| e.path().join("installation/bin").is_dir())
                    .collect();
                dirs.sort_by_key(|b| std::cmp::Reverse(node_version_sort_key(&b.file_name())));
                for entry in dirs {
                    extra.push(
                        entry
                            .path()
                            .join("installation/bin")
                            .to_string_lossy()
                            .to_string(),
                    );
                }
            }
        }
        let mut parts: Vec<&str> = vec![];
        if let Some(ref cp) = custom_path {
            parts.push(cp.as_str());
        }
        parts.extend(extra.iter().map(|s| s.as_str()));
        if !current.is_empty() {
            parts.push(&current);
        }
        parts.join(":")
    }

    #[cfg(target_os = "linux")]
    {
        let mut extra: Vec<String> = vec![
            "/usr/local/bin".into(),
            "/usr/bin".into(),
            "/snap/bin".into(),
            format!("{}/.local/bin", home.display()),
            format!("{}/.nvm/current/bin", home.display()),
            format!("{}/.volta/bin", home.display()),
            format!("{}/.nodenv/shims", home.display()),
            format!("{}/n/bin", home.display()),
            format!("{}/.npm-global/bin", home.display()),
        ];
        // NPM_CONFIG_PREFIX: 用户通过 npm config set prefix 自定义的全局安装路径
        if let Ok(prefix) = std::env::var("NPM_CONFIG_PREFIX") {
            extra.push(format!("{}/bin", prefix));
        }
        // standalone 安装目录（集中管理，避免多处硬编码）
        for sa_dir in config::all_standalone_dirs() {
            extra.push(sa_dir.to_string_lossy().into_owned());
        }
        // NVM_DIR 环境变量（用户可能自定义了 nvm 安装目录）
        // 按版本号倒序排列，确保最新版优先（修复 #143）
        let nvm_dir = std::env::var("NVM_DIR")
            .ok()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| home.join(".nvm"));
        let nvm_versions = nvm_dir.join("versions/node");
        if nvm_versions.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
                let mut dirs: Vec<_> = entries
                    .flatten()
                    .filter(|e| e.path().join("bin").is_dir())
                    .collect();
                dirs.sort_by_key(|b| std::cmp::Reverse(node_version_sort_key(&b.file_name())));
                for entry in dirs {
                    extra.push(entry.path().join("bin").to_string_lossy().to_string());
                }
            }
        }
        // fnm: 扫描 $FNM_DIR 或默认 ~/.local/share/fnm 下的版本目录
        let fnm_dir = std::env::var("FNM_DIR")
            .ok()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| home.join(".local/share/fnm"));
        let fnm_versions = fnm_dir.join("node-versions");
        if fnm_versions.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&fnm_versions) {
                let mut dirs: Vec<_> = entries
                    .flatten()
                    .filter(|e| e.path().join("installation/bin").is_dir())
                    .collect();
                dirs.sort_by_key(|b| std::cmp::Reverse(node_version_sort_key(&b.file_name())));
                for entry in dirs {
                    extra.push(
                        entry
                            .path()
                            .join("installation/bin")
                            .to_string_lossy()
                            .to_string(),
                    );
                }
            }
        }
        // nodesource / 手动安装的 Node.js 可能在 /usr/local/lib/nodejs/ 下
        let nodejs_lib = std::path::Path::new("/usr/local/lib/nodejs");
        if nodejs_lib.is_dir() {
            if let Ok(entries) = std::fs::read_dir(nodejs_lib) {
                for entry in entries.flatten() {
                    let bin = entry.path().join("bin");
                    if bin.is_dir() {
                        extra.push(bin.to_string_lossy().to_string());
                    }
                }
            }
        }
        let mut parts: Vec<&str> = vec![];
        if let Some(ref cp) = custom_path {
            parts.push(cp.as_str());
        }
        parts.extend(extra.iter().map(|s| s.as_str()));
        if !current.is_empty() {
            parts.push(&current);
        }
        parts.join(":")
    }

    #[cfg(target_os = "windows")]
    {
        let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
        let pf86 =
            std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".into());
        let localappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let appdata = std::env::var("APPDATA").unwrap_or_default();

        let mut extra: Vec<String> = vec![format!(r"{}\nodejs", pf), format!(r"{}\nodejs", pf86)];
        if !localappdata.is_empty() {
            extra.push(format!(r"{}\Programs\nodejs", localappdata));
            extra.push(format!(r"{}\fnm_multishells", localappdata));
        }
        if !appdata.is_empty() {
            extra.push(format!(r"{}\npm", appdata));
            extra.push(format!(r"{}\nvm", appdata));
            // 扫描 nvm-windows 实际安装的版本目录
            let nvm_dir = std::path::Path::new(&appdata).join("nvm");
            if nvm_dir.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.is_dir() && p.join("node.exe").exists() {
                            extra.push(p.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
        // NVM_HOME 环境变量（用户可能自定义了 nvm 安装目录）
        if let Ok(nvm_home) = std::env::var("NVM_HOME") {
            let nvm_path = std::path::Path::new(&nvm_home);
            if nvm_path.is_dir() {
                if let Ok(entries) = std::fs::read_dir(nvm_path) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.is_dir() && p.join("node.exe").exists() {
                            extra.push(p.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
        extra.push(format!(r"{}\.volta\bin", home.display()));
        // standalone 安装目录（集中管理，避免多处硬编码）
        for sa_dir in config::all_standalone_dirs() {
            extra.push(sa_dir.to_string_lossy().into_owned());
        }
        // fnm: 扫描 %FNM_DIR% 或默认 %APPDATA%\fnm 下的版本目录
        let fnm_base = std::env::var("FNM_DIR")
            .ok()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::Path::new(&appdata).join("fnm"));
        let fnm_versions = fnm_base.join("node-versions");
        if fnm_versions.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&fnm_versions) {
                for entry in entries.flatten() {
                    let inst = entry.path().join("installation");
                    if inst.is_dir() && inst.join("node.exe").exists() {
                        extra.push(inst.to_string_lossy().to_string());
                    }
                }
            }
        }

        // 扫描常见盘符下的 Node 安装（用户可能装在 D:\、F:\ 等）
        for drive in &["C", "D", "E", "F"] {
            extra.push(format!(r"{}:\nodejs", drive));
            extra.push(format!(r"{}:\Node", drive));
            extra.push(format!(r"{}:\Program Files\nodejs", drive));
        }

        let mut parts: Vec<&str> = vec![];
        // 用户自定义路径优先级最高
        if let Some(ref cp) = custom_path {
            parts.push(cp.as_str());
        }
        // 然后是默认扫描到的路径
        for p in &extra {
            if std::path::Path::new(p).exists() {
                parts.push(p.as_str());
            }
        }
        // 最后是系统 PATH
        if !current.is_empty() {
            parts.push(&current);
        }
        parts.join(";")
    }
}

#[cfg(test)]
mod tests {
    use super::node_version_sort_key;

    #[test]
    fn node_version_sort_key_prefers_higher_major_versions() {
        let mut versions = vec!["v9.0.0", "v24.0.0", "v20.0.0", "v18.20.8"];
        versions.sort_by_key(|name| {
            std::cmp::Reverse(node_version_sort_key(std::ffi::OsStr::new(name)))
        });
        assert_eq!(versions, vec!["v24.0.0", "v20.0.0", "v18.20.8", "v9.0.0"]);
    }
}
