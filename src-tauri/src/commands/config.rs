#[cfg(not(target_os = "macos"))]
use crate::utils::openclaw_command;
/// 配置读写命令
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;

use crate::models::types::{OpenClawInstallation, VersionInfo};

struct GuardianPause {
    reason: &'static str,
}

impl GuardianPause {
    fn new(reason: &'static str) -> Self {
        crate::commands::service::guardian_pause(reason);
        Self { reason }
    }
}

impl Drop for GuardianPause {
    fn drop(&mut self) {
        crate::commands::service::guardian_resume(self.reason);
    }
}

/// 预设 npm 源列表
const DEFAULT_REGISTRY: &str = "https://registry.npmmirror.com";
const GIT_HTTPS_REWRITES: [&str; 6] = [
    "ssh://git@github.com/",
    "ssh://git@github.com",
    "ssh://git@://github.com/",
    "git@github.com:",
    "git://github.com/",
    "git+ssh://git@github.com/",
];

#[derive(Debug, Deserialize, Default)]
struct VersionPolicySource {
    recommended: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct VersionPolicyEntry {
    #[serde(default)]
    official: VersionPolicySource,
    #[serde(default)]
    chinese: VersionPolicySource,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize, Default)]
struct R2Config {
    #[serde(default)]
    #[serde(rename = "baseUrl")]
    base_url: Option<String>,
    #[serde(default)]
    enabled: bool,
}

#[derive(Debug, Deserialize, Default)]
struct StandaloneConfig {
    #[serde(default)]
    #[serde(rename = "baseUrl")]
    base_url: Option<String>,
    #[serde(default)]
    enabled: bool,
}

#[derive(Debug, Deserialize, Default)]
struct VersionPolicy {
    #[serde(default)]
    standalone: StandaloneConfig,
    #[serde(default)]
    r2: R2Config,
    #[serde(default)]
    default: VersionPolicyEntry,
    #[serde(default)]
    panels: HashMap<String, VersionPolicyEntry>,
}

fn panel_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

fn parse_version(value: &str) -> Vec<u32> {
    value
        .split(|c: char| !c.is_ascii_digit())
        .filter_map(|s| s.parse().ok())
        .collect()
}

/// 提取基础版本号（去掉 -zh.x / -nightly.xxx 等后缀，只保留主版本数字部分）
/// "2026.3.13-zh.1" → "2026.3.13", "2026.3.13" → "2026.3.13"
fn base_version(v: &str) -> String {
    // 在第一个 '-' 处截断
    let base = v.split('-').next().unwrap_or(v);
    base.to_string()
}

/// 判断 CLI 报告的版本是否与推荐版匹配（考虑汉化版 -zh.x 后缀差异）
fn versions_match(cli_version: &str, recommended: &str) -> bool {
    if cli_version == recommended {
        return true;
    }
    // CLI 报告 "2026.3.13"，推荐版 "2026.3.13-zh.1" → 基础版本相同即视为匹配
    base_version(cli_version) == base_version(recommended)
}

/// 判断推荐版是否真的比当前版本更新（忽略 -zh.x 后缀）
fn recommended_is_newer(recommended: &str, current: &str) -> bool {
    let r = parse_version(&base_version(recommended));
    let c = parse_version(&base_version(current));
    r > c
}

fn load_version_policy() -> VersionPolicy {
    serde_json::from_str(include_str!("../../../openclaw-version-policy.json")).unwrap_or_default()
}

#[allow(dead_code)]
fn r2_config() -> R2Config {
    load_version_policy().r2
}

fn standalone_config() -> StandaloneConfig {
    load_version_policy().standalone
}

fn standalone_platform_key() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "win-x64"
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "mac-arm64"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "mac-x64"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "linux-x64"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "linux-arm64"
    }
    #[cfg(not(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
    )))]
    {
        "unknown"
    }
}

fn standalone_archive_ext() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "zip"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "tar.gz"
    }
}

pub(crate) fn standalone_install_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("LOCALAPPDATA")
            .ok()
            .map(|dir| PathBuf::from(dir).join("Programs").join("OpenClaw"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        dirs::home_dir().map(|home| home.join(".openclaw-bin"))
    }
}

pub(crate) fn all_standalone_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(target_os = "windows")]
    {
        if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
            dirs.push(
                PathBuf::from(&localappdata)
                    .join("Programs")
                    .join("OpenClaw"),
            );
            dirs.push(PathBuf::from(&localappdata).join("OpenClaw"));
        }
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            dirs.push(PathBuf::from(program_files).join("OpenClaw"));
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Some(home) = dirs::home_dir() {
            dirs.push(home.join(".openclaw-bin"));
        }
        dirs.push(PathBuf::from("/opt/openclaw"));
    }
    dirs
}

fn recommended_version_for(source: &str) -> Option<String> {
    let policy = load_version_policy();
    let panel_entry = policy.panels.get(panel_version());
    match source {
        "chinese" => panel_entry
            .and_then(|entry| entry.chinese.recommended.clone())
            .or(policy.default.chinese.recommended),
        _ => panel_entry
            .and_then(|entry| entry.official.recommended.clone())
            .or(policy.default.official.recommended),
    }
}

/// 查找系统 git 可执行文件的完整路径
fn find_git_path() -> String {
    #[cfg(target_os = "windows")]
    let which_cmd = "where";
    #[cfg(not(target_os = "windows"))]
    let which_cmd = "which";
    let mut cmd = Command::new(which_cmd);
    cmd.arg("git");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    if let Ok(o) = cmd.output() {
        if o.status.success() {
            let path = String::from_utf8_lossy(&o.stdout)
                .trim()
                .lines()
                .next()
                .unwrap_or("git")
                .to_string();
            if !path.is_empty() {
                return path;
            }
        }
    }
    "git".into()
}

/// 读取用户自定义 git 路径配置，无配置时返回 None
fn configured_git_path() -> Option<String> {
    super::read_panel_config_value()
        .and_then(|v| v.get("gitPath")?.as_str().map(String::from))
        .map(|custom| custom.trim().to_string())
        .filter(|custom| !custom.is_empty())
}

/// 获取用户配置的 git 可执行文件路径，回退到 "git"
pub fn git_executable() -> String {
    configured_git_path().unwrap_or_else(|| "git".into())
}

fn configure_git_https_rules() -> usize {
    let git = git_executable();
    let mut unset = Command::new(&git);
    unset.args([
        "config",
        "--global",
        "--unset-all",
        "url.https://github.com/.insteadOf",
    ]);
    #[cfg(target_os = "windows")]
    unset.creation_flags(0x08000000);
    let _ = unset.output();

    let mut success = 0;
    for from in GIT_HTTPS_REWRITES {
        let mut cmd = Command::new(&git);
        cmd.args([
            "config",
            "--global",
            "--add",
            "url.https://github.com/.insteadOf",
            from,
        ]);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        if cmd.output().map(|o| o.status.success()).unwrap_or(false) {
            success += 1;
        }
    }
    success
}

fn apply_git_install_env(cmd: &mut Command) {
    if let Some(custom_git) = configured_git_path() {
        let git_path = PathBuf::from(&custom_git);
        if let Some(parent) = git_path.parent() {
            let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
                .map(|value| std::env::split_paths(&value).collect())
                .unwrap_or_default();
            if !paths.iter().any(|p| p == parent) {
                paths.insert(0, parent.to_path_buf());
            }
            if let Ok(joined) = std::env::join_paths(paths) {
                cmd.env("PATH", joined);
            }
        }
        cmd.env("GIT", &custom_git);
    }
    crate::commands::apply_proxy_env(cmd);
    cmd.env("GIT_TERMINAL_PROMPT", "0")
        .env(
            "GIT_SSH_COMMAND",
            "ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o IdentitiesOnly=yes",
        )
        .env("GIT_ALLOW_PROTOCOL", "https:http:file");
    cmd.env("GIT_CONFIG_COUNT", GIT_HTTPS_REWRITES.len().to_string());
    for (idx, from) in GIT_HTTPS_REWRITES.iter().enumerate() {
        cmd.env(
            format!("GIT_CONFIG_KEY_{idx}"),
            "url.https://github.com/.insteadOf",
        )
        .env(format!("GIT_CONFIG_VALUE_{idx}"), from);
    }
}

/// Linux: 检测是否以 root 身份运行（避免 unsafe libc 调用）
#[cfg(target_os = "linux")]
fn nix_is_root() -> bool {
    std::env::var("USER")
        .or_else(|_| std::env::var("EUID"))
        .map(|v| v == "root" || v == "0")
        .unwrap_or(false)
}

/// 读取用户配置的 npm registry，fallback 到淘宝镜像
fn get_configured_registry() -> String {
    let path = super::openclaw_dir().join("npm-registry.txt");
    fs::read_to_string(&path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_REGISTRY.to_string())
}

/// 创建使用配置源的 npm Command
/// Windows 上 npm 是 npm.cmd，需要通过 cmd /c 调用，并隐藏窗口
/// Linux 非 root 用户全局安装需要 sudo
fn npm_command() -> Command {
    let registry = get_configured_registry();
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = Command::new("cmd");
        cmd.args(["/c", "npm", "--registry", &registry]);
        cmd.env("PATH", super::enhanced_path());
        crate::commands::apply_proxy_env(&mut cmd);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("npm");
        cmd.args(["--registry", &registry]);
        cmd.env("PATH", super::enhanced_path());
        crate::commands::apply_proxy_env(&mut cmd);
        cmd
    }
    #[cfg(target_os = "linux")]
    {
        // Linux 非 root 用户全局 npm install 需要 sudo
        let need_sudo = !nix_is_root();
        let mut cmd = if need_sudo {
            let mut c = Command::new("sudo");
            c.args(["-E", "npm", "--registry", &registry]);
            c
        } else {
            let mut c = Command::new("npm");
            c.args(["--registry", &registry]);
            c
        };
        cmd.env("PATH", super::enhanced_path());
        crate::commands::apply_proxy_env(&mut cmd);
        cmd
    }
}

/// 安装/升级前的清理工作：停止 Gateway、清理 npm 全局 bin 下的 openclaw 残留文件
/// 解决 Windows 上 EEXIST（文件已存在）和文件被占用的问题
fn pre_install_cleanup() {
    // 1. 停止 Gateway 进程，释放 openclaw 相关文件锁
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // 杀死所有 openclaw gateway 相关的 node 进程
        let _ = Command::new("taskkill")
            .args(["/f", "/im", "node.exe", "/fi", "WINDOWTITLE eq OpenClaw*"])
            .creation_flags(0x08000000)
            .output();
        // 等文件锁释放
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    #[cfg(target_os = "macos")]
    {
        let uid = get_uid().unwrap_or(501);
        let _ = Command::new("launchctl")
            .args(["bootout", &format!("gui/{uid}/ai.openclaw.gateway")])
            .output();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("pkill")
            .args(["-f", "openclaw.*gateway"])
            .output();
    }

    // 2. 清理 npm 全局 bin 目录下的 openclaw 残留文件（Windows EEXIST 根因）
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let npm_bin = std::path::Path::new(&appdata).join("npm");
            for name in &["openclaw", "openclaw.cmd", "openclaw.ps1"] {
                let p = npm_bin.join(name);
                if p.exists() {
                    let _ = fs::remove_file(&p);
                }
            }
        }
    }
}

fn backups_dir() -> PathBuf {
    super::openclaw_dir().join("backups")
}

#[tauri::command]
pub fn read_openclaw_config() -> Result<Value, String> {
    let path = super::openclaw_dir().join("openclaw.json");
    let raw = fs::read(&path).map_err(|e| format!("读取配置失败: {e}"))?;

    // 自愈：自动剥离 UTF-8 BOM（EF BB BF），防止 JSON 解析失败
    let content = if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
        String::from_utf8_lossy(&raw[3..]).into_owned()
    } else {
        String::from_utf8_lossy(&raw).into_owned()
    };

    // 解析 JSON，失败时尝试从备份恢复
    let mut config: Value = match serde_json::from_str(&content) {
        Ok(v) => {
            // BOM 被剥离过，静默写回干净文件
            if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
                let _ = fs::write(&path, &content);
            }
            v
        }
        Err(e) => {
            // JSON 解析失败，尝试从备份恢复
            let bak = super::openclaw_dir().join("openclaw.json.bak");
            if bak.exists() {
                let bak_raw = fs::read(&bak).map_err(|e2| format!("备份也读取失败: {e2}"))?;
                let bak_content = if bak_raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
                    String::from_utf8_lossy(&bak_raw[3..]).into_owned()
                } else {
                    String::from_utf8_lossy(&bak_raw).into_owned()
                };
                let bak_config: Value = serde_json::from_str(&bak_content)
                    .map_err(|e2| format!("配置损坏且备份也无效: 原始={e}, 备份={e2}"))?;
                // 备份有效，恢复主文件
                let _ = fs::write(&path, &bak_content);
                bak_config
            } else {
                return Err(format!("配置 JSON 损坏且无备份: {e}"));
            }
        }
    };

    // 自动清理 UI 专属字段，防止污染配置导致 CLI 启动失败
    if has_ui_fields(&config) {
        config = strip_ui_fields(config);
        // 静默写回清理后的配置
        let bak = super::openclaw_dir().join("openclaw.json.bak");
        let _ = fs::copy(&path, &bak);
        let json = serde_json::to_string_pretty(&config).map_err(|e| format!("序列化失败: {e}"))?;
        let _ = fs::write(&path, json);
    }

    Ok(config)
}

/// 供其他模块复用：读取 openclaw.json 为 JSON Value
pub fn load_openclaw_json() -> Result<Value, String> {
    read_openclaw_config()
}

/// 供其他模块复用：将 JSON Value 写回 openclaw.json（含备份和清理）
pub fn save_openclaw_json(config: &Value) -> Result<(), String> {
    write_openclaw_config(config.clone())
}

/// 供其他模块复用：触发 Gateway 重载
pub async fn do_reload_gateway(app: &tauri::AppHandle) -> Result<String, String> {
    let _ = app; // 预留扩展用
    reload_gateway().await
}

#[tauri::command]
pub fn write_openclaw_config(config: Value) -> Result<(), String> {
    let path = super::openclaw_dir().join("openclaw.json");
    // 备份
    let bak = super::openclaw_dir().join("openclaw.json.bak");
    let _ = fs::copy(&path, &bak);
    // 清理 UI 专属字段，避免 CLI schema 校验失败
    let cleaned = strip_ui_fields(config.clone());
    // 写入
    let json = serde_json::to_string_pretty(&cleaned).map_err(|e| format!("序列化失败: {e}"))?;
    fs::write(&path, &json).map_err(|e| format!("写入失败: {e}"))?;

    // 同步 provider 配置到所有 agent 的 models.json（运行时注册表）
    sync_providers_to_agent_models(&config);

    // 清除依赖 openclaw.json 的缓存
    super::invalidate_gateway_port_cache();

    Ok(())
}

/// 将 openclaw.json 的 models.providers 完整同步到每个 agent 的 models.json
/// 包括：同步 baseUrl/apiKey/api、删除已移除的 provider、删除已移除的 model、
/// 确保 Gateway 运行时不会引用 openclaw.json 中已不存在的模型
fn sync_providers_to_agent_models(config: &Value) {
    let src_providers = config
        .pointer("/models/providers")
        .and_then(|p| p.as_object());

    // 收集 openclaw.json 中所有有效的 provider/model 组合
    let mut valid_models: std::collections::HashSet<String> = std::collections::HashSet::new();
    if let Some(providers) = src_providers {
        for (pk, pv) in providers {
            if let Some(models) = pv.get("models").and_then(|m| m.as_array()) {
                for m in models {
                    let id = m.get("id").and_then(|v| v.as_str()).or_else(|| m.as_str());
                    if let Some(id) = id {
                        valid_models.insert(format!("{}/{}", pk, id));
                    }
                }
            }
        }
    }

    // 收集所有 agent ID
    let mut agent_ids = vec!["main".to_string()];
    if let Some(Value::Array(list)) = config.pointer("/agents/list") {
        for agent in list {
            if let Some(id) = agent.get("id").and_then(|v| v.as_str()) {
                if id != "main" {
                    agent_ids.push(id.to_string());
                }
            }
        }
    }

    let agents_dir = super::openclaw_dir().join("agents");
    for agent_id in &agent_ids {
        let models_path = agents_dir.join(agent_id).join("agent").join("models.json");
        if !models_path.exists() {
            continue;
        }
        let Ok(content) = fs::read_to_string(&models_path) else {
            continue;
        };
        let Ok(mut models_json) = serde_json::from_str::<Value>(&content) else {
            continue;
        };

        let mut changed = false;

        if models_json
            .get("providers")
            .and_then(|p| p.as_object())
            .is_none()
        {
            if let Some(root) = models_json.as_object_mut() {
                root.insert("providers".into(), json!({}));
                changed = true;
            }
        }

        // 同步 providers
        if let Some(dst_providers) = models_json
            .get_mut("providers")
            .and_then(|p| p.as_object_mut())
        {
            // 1. 删除 openclaw.json 中已不存在的 provider
            if let Some(src) = src_providers {
                let to_remove: Vec<String> = dst_providers
                    .keys()
                    .filter(|k| !src.contains_key(k.as_str()))
                    .cloned()
                    .collect();
                for k in to_remove {
                    dst_providers.remove(&k);
                    changed = true;
                }

                for (provider_name, src_provider) in src.iter() {
                    if !dst_providers.contains_key(provider_name) {
                        dst_providers.insert(provider_name.clone(), src_provider.clone());
                        changed = true;
                    }
                }

                // 2. 同步存在的 provider 的 baseUrl/apiKey/api + 清理已删除的 models
                for (provider_name, src_provider) in src.iter() {
                    if let Some(dst_provider) = dst_providers.get_mut(provider_name) {
                        if let Some(dst_obj) = dst_provider.as_object_mut() {
                            // 同步连接信息
                            for field in ["baseUrl", "apiKey", "api"] {
                                if let Some(src_val) =
                                    src_provider.get(field).and_then(|v| v.as_str())
                                {
                                    if dst_obj.get(field).and_then(|v| v.as_str()) != Some(src_val)
                                    {
                                        dst_obj.insert(
                                            field.to_string(),
                                            Value::String(src_val.to_string()),
                                        );
                                        changed = true;
                                    }
                                }
                            }
                            // 清理已删除的 models
                            if let Some(dst_models) =
                                dst_obj.get_mut("models").and_then(|m| m.as_array_mut())
                            {
                                let src_model_ids: std::collections::HashSet<String> = src_provider
                                    .get("models")
                                    .and_then(|m| m.as_array())
                                    .map(|arr| {
                                        arr.iter()
                                            .filter_map(|m| {
                                                m.get("id")
                                                    .and_then(|v| v.as_str())
                                                    .or_else(|| m.as_str())
                                                    .map(|s| s.to_string())
                                            })
                                            .collect()
                                    })
                                    .unwrap_or_default();
                                let before = dst_models.len();
                                dst_models.retain(|m| {
                                    let id = m
                                        .get("id")
                                        .and_then(|v| v.as_str())
                                        .or_else(|| m.as_str())
                                        .unwrap_or("");
                                    src_model_ids.contains(id)
                                });
                                if dst_models.len() != before {
                                    changed = true;
                                }
                            }
                        }
                    }
                }
            }
        }

        if changed {
            if let Ok(new_json) = serde_json::to_string_pretty(&models_json) {
                let _ = fs::write(&models_path, new_json);
            }
        }
    }
}

/// 检测配置中是否包含 UI 专属字段
fn has_ui_fields(val: &Value) -> bool {
    if let Some(obj) = val.as_object() {
        if let Some(models_val) = obj.get("models") {
            if let Some(models_obj) = models_val.as_object() {
                if let Some(providers_val) = models_obj.get("providers") {
                    if let Some(providers_obj) = providers_val.as_object() {
                        for (_provider_name, provider_val) in providers_obj.iter() {
                            if let Some(provider_obj) = provider_val.as_object() {
                                if let Some(Value::Array(arr)) = provider_obj.get("models") {
                                    for model in arr.iter() {
                                        if let Some(mobj) = model.as_object() {
                                            if mobj.contains_key("lastTestAt")
                                                || mobj.contains_key("latency")
                                                || mobj.contains_key("testStatus")
                                                || mobj.contains_key("testError")
                                            {
                                                return true;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    false
}

/// 递归清理 models 数组中的 UI 专属字段（lastTestAt, latency, testStatus, testError）
/// 并为缺少 name 字段的模型自动补上 name = id
fn strip_ui_fields(mut val: Value) -> Value {
    if let Some(obj) = val.as_object_mut() {
        // 处理 models.providers.xxx.models 结构
        if let Some(models_val) = obj.get_mut("models") {
            if let Some(models_obj) = models_val.as_object_mut() {
                if let Some(providers_val) = models_obj.get_mut("providers") {
                    if let Some(providers_obj) = providers_val.as_object_mut() {
                        for (_provider_name, provider_val) in providers_obj.iter_mut() {
                            if let Some(provider_obj) = provider_val.as_object_mut() {
                                if let Some(Value::Array(arr)) = provider_obj.get_mut("models") {
                                    for model in arr.iter_mut() {
                                        if let Some(mobj) = model.as_object_mut() {
                                            mobj.remove("lastTestAt");
                                            mobj.remove("latency");
                                            mobj.remove("testStatus");
                                            mobj.remove("testError");
                                            if !mobj.contains_key("name") {
                                                if let Some(id) =
                                                    mobj.get("id").and_then(|v| v.as_str())
                                                {
                                                    mobj.insert(
                                                        "name".into(),
                                                        Value::String(id.to_string()),
                                                    );
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    val
}

#[tauri::command]
pub fn read_mcp_config() -> Result<Value, String> {
    let path = super::openclaw_dir().join("mcp.json");
    if !path.exists() {
        return Ok(Value::Object(Default::default()));
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("读取 MCP 配置失败: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("解析 JSON 失败: {e}"))
}

#[tauri::command]
pub fn write_mcp_config(config: Value) -> Result<(), String> {
    let path = super::openclaw_dir().join("mcp.json");
    let json = serde_json::to_string_pretty(&config).map_err(|e| format!("序列化失败: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("写入失败: {e}"))
}

/// 从 package.json 读取 version 字段
fn read_version_from_package_json(path: &std::path::Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<Value>(&content)
        .ok()
        .and_then(|v| v.get("version")?.as_str().map(String::from))
}

/// 从 CLI 路径附近读取版本信息（VERSION 文件或 package.json）
fn read_version_from_installation(cli_path: &std::path::Path) -> Option<String> {
    if let Some(dir) = cli_path.parent() {
        // 尝试从同目录的 VERSION 文件读取
        let version_file = dir.join("VERSION");
        if let Ok(content) = fs::read_to_string(&version_file) {
            for line in content.lines() {
                if let Some(ver) = line.strip_prefix("openclaw_version=") {
                    let ver = ver.trim();
                    if !ver.is_empty() {
                        return Some(ver.to_string());
                    }
                }
            }
        }
        // 上游 #219:CLI 本体位于包目录中时(如 npm 全局安装的 nvm/Homebrew 等),
        // 直接读取同目录的 package.json(即该包自身的版本文件),避免被同目录下残留的另一来源包覆盖
        let own_pkg = dir.join("package.json");
        if let Ok(content) = fs::read_to_string(&own_pkg) {
            if let Some(ver) = serde_json::from_str::<serde_json::Value>(&content)
                .ok()
                .and_then(|v| v.get("version")?.as_str().map(String::from))
            {
                return Some(ver);
            }
        }
        // 根据 CLI 路径判断来源，决定 package.json 检查顺序
        let cli_source = crate::utils::classify_cli_source(&cli_path.to_string_lossy());
        let pkg_names: &[&str] = if cli_source == "npm-zh" || cli_source == "standalone" {
            &["@qingchencloud/openclaw-zh", "openclaw"]
        } else {
            &["openclaw", "@qingchencloud/openclaw-zh"]
        };
        for pkg_name in pkg_names {
            let pkg_json = dir.join("node_modules").join(pkg_name).join("package.json");
            if let Some(ver) = read_version_from_package_json(&pkg_json) {
                return Some(ver);
            }
        }
        // npm shim 情况：向上查找 node_modules
        if let Some(parent) = dir.parent() {
            for pkg_name in pkg_names {
                let pkg_json = parent
                    .join("node_modules")
                    .join(pkg_name)
                    .join("package.json");
                if let Some(ver) = read_version_from_package_json(&pkg_json) {
                    return Some(ver);
                }
            }
        }
    }
    None
}

/// 通过活跃 CLI 路径读取版本（跨平台，resolve_openclaw_cli_path 内部处理平台差异）
fn try_active_cli_version() -> Option<String> {
    let cli_path = crate::utils::resolve_openclaw_cli_path()?;
    let cli_pb = PathBuf::from(&cli_path);
    let resolved = std::fs::canonicalize(&cli_pb).unwrap_or_else(|_| cli_pb.clone());
    read_version_from_installation(&resolved).or_else(|| read_version_from_installation(&cli_pb))
}

/// 从 standalone 安装目录读取版本（检查 CLI 二进制存在 + VERSION 文件 + package.json）
#[cfg(any(target_os = "windows", target_os = "linux"))]
fn read_version_from_standalone_dir(sa_dir: &std::path::Path, bin_name: &str) -> Option<String> {
    if !sa_dir.join(bin_name).exists() {
        return None;
    }
    let version_file = sa_dir.join("VERSION");
    if let Ok(content) = fs::read_to_string(&version_file) {
        for line in content.lines() {
            if let Some(ver) = line.strip_prefix("openclaw_version=") {
                let ver = ver.trim();
                if !ver.is_empty() {
                    return Some(ver.to_string());
                }
            }
        }
    }
    let sa_pkg = sa_dir
        .join("node_modules")
        .join("@qingchencloud")
        .join("openclaw-zh")
        .join("package.json");
    read_version_from_package_json(&sa_pkg)
}

async fn get_local_version() -> Option<String> {
    // 上游 #219:优先从运行中的 openclaw 实例获取版本,避免多实例共存时
    // 通过路径推断选错版本(用户实际激活的是 nvm 版,但路径检测回退到 Homebrew 残留)
    if let Ok(output) = crate::utils::openclaw_command_async()
        .args(["status", "--json"])
        .output()
        .await
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(ver) = crate::commands::skills::extract_json_pub(&stdout)
                .and_then(|v| v.get("runtimeVersion")?.as_str().map(String::from))
            {
                return Some(ver);
            }
        }
    }

    // 所有平台共享：活跃 CLI 优先
    if let Some(ver) = try_active_cli_version() {
        return Some(ver);
    }

    // macOS: standalone 目录 + homebrew symlink
    #[cfg(target_os = "macos")]
    {
        for dir in all_standalone_dirs() {
            if let Some(ver) = read_version_from_package_json(&dir.join("package.json")) {
                return Some(ver);
            }
        }
        if let Ok(target) = fs::read_link("/opt/homebrew/bin/openclaw") {
            let pkg_json = PathBuf::from("/opt/homebrew/bin")
                .join(&target)
                .parent()?
                .join("package.json");
            if let Some(ver) = read_version_from_package_json(&pkg_json) {
                return Some(ver);
            }
        }
    }

    // Windows: standalone 目录 + cmd shim 判断包来源
    #[cfg(target_os = "windows")]
    {
        for sa_dir in all_standalone_dirs() {
            if let Some(ver) = read_version_from_standalone_dir(&sa_dir, "openclaw.cmd") {
                return Some(ver);
            }
        }

        if let Ok(appdata) = std::env::var("APPDATA") {
            let npm_bin = PathBuf::from(&appdata).join("npm");
            let shim_path = npm_bin.join("openclaw.cmd");
            if shim_path.exists() {
                let is_zh = detect_source_from_cmd_shim(&shim_path)
                    .map(|s| s == "chinese")
                    .unwrap_or(false);
                let pkgs: &[&str] = if is_zh {
                    &["@qingchencloud/openclaw-zh", "openclaw"]
                } else {
                    &["openclaw", "@qingchencloud/openclaw-zh"]
                };
                for pkg in pkgs {
                    let pkg_json = npm_bin.join("node_modules").join(pkg).join("package.json");
                    if let Some(ver) = read_version_from_package_json(&pkg_json) {
                        return Some(ver);
                    }
                }
            }
        }
    }

    // Linux: standalone 目录 + symlink
    #[cfg(target_os = "linux")]
    {
        for sa_dir in all_standalone_dirs() {
            if let Some(ver) = read_version_from_standalone_dir(&sa_dir, "openclaw") {
                return Some(ver);
            }
        }
        if let Ok(target) = fs::read_link("/usr/local/bin/openclaw") {
            let pkg_json = PathBuf::from("/usr/local/bin")
                .join(&target)
                .parent()
                .map(|p| p.join("package.json"));
            if let Some(ref pkg_path) = pkg_json {
                if let Some(ver) = read_version_from_package_json(pkg_path) {
                    return Some(ver);
                }
            }
        }
    }

    // 所有平台通用 fallback: CLI 输出（异步）
    use crate::utils::openclaw_command_async;
    let output = openclaw_command_async()
        .arg("--version")
        .output()
        .await
        .ok()?;
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    raw.split_whitespace()
        .find(|s| s.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// 从 npm registry 获取最新版本号，超时 5 秒
async fn get_latest_version_for(source: &str) -> Option<String> {
    let client =
        crate::commands::build_http_client(std::time::Duration::from_secs(2), None).ok()?;
    let pkg = npm_package_name(source)
        .replace('/', "%2F")
        .replace('@', "%40");
    let registry = get_configured_registry();
    let url = format!("{registry}/{pkg}/latest");
    let resp = client.get(&url).send().await.ok()?;
    let json: Value = resp.json().await.ok()?;
    json.get("version")
        .and_then(|v| v.as_str())
        .map(String::from)
}

/// 从 Windows .cmd shim 文件内容判断实际关联的 npm 包来源
/// npm 生成的 shim 末尾引用实际 JS 入口，据此区分官方版与汉化版
#[cfg(target_os = "windows")]
fn detect_source_from_cmd_shim(cmd_path: &std::path::Path) -> Option<String> {
    let content = std::fs::read_to_string(cmd_path).ok()?;
    let lower = content.to_lowercase();
    // 汉化版标记：@qingchencloud 或 openclaw-zh
    if lower.contains("openclaw-zh") || lower.contains("@qingchencloud") {
        return Some("chinese".into());
    }
    // 确认是 npm shim（含 node_modules 引用）→ 官方版
    if lower.contains("node_modules") {
        return Some("official".into());
    }
    // standalone 的 .cmd 可能不含 node_modules（自定义脚本），由 classify 处理
    None
}

/// 检测当前安装的是官方版还是汉化版
/// macOS: 优先检查 symlink 指向的实际路径
/// Windows: 读取 .cmd shim 内容判断实际关联的包
/// Linux: 直接用 npm list
/// 将 classify_cli_source 的细分来源映射为面向用户的 "official" / "chinese" / "unknown"
fn normalize_cli_install_source(cli_source: &str) -> &str {
    match cli_source {
        "npm-zh" | "standalone" => "chinese",
        "npm-official" | "npm-global" => "official",
        _ => "unknown",
    }
}

fn detect_installed_source() -> String {
    // 优先通过活跃 CLI 路径 + classify_cli_source 判断（跨平台通用）
    if let Some(cli_path) = crate::utils::resolve_openclaw_cli_path() {
        let source = crate::utils::classify_cli_source(&cli_path);
        let normalized = normalize_cli_install_source(&source);
        if normalized != "unknown" {
            return normalized.into();
        }
        // canonicalize 后再试一次（处理 symlink）
        if let Ok(canonical) = std::fs::canonicalize(&cli_path) {
            let canon_source = crate::utils::classify_cli_source(&canonical.to_string_lossy());
            let canon_normalized = normalize_cli_install_source(&canon_source);
            if canon_normalized != "unknown" {
                return canon_normalized.into();
            }
        }
    }

    // macOS: symlink 检查 (ARM + Intel)
    #[cfg(target_os = "macos")]
    {
        for bin_path in &["/opt/homebrew/bin/openclaw", "/usr/local/bin/openclaw"] {
            if let Ok(target) = std::fs::read_link(bin_path) {
                if target.to_string_lossy().contains("openclaw-zh") {
                    return "chinese".into();
                }
            }
        }
        // standalone 目录兜底
        for dir in all_standalone_dirs() {
            if dir.join("openclaw").exists() {
                return "chinese".into();
            }
        }
        "unknown".into()
    }

    // Windows: .cmd shim 内容判断
    #[cfg(target_os = "windows")]
    {
        if let Some(cli_path) = crate::utils::resolve_openclaw_cli_path() {
            let cli_pb = PathBuf::from(&cli_path);
            if cli_pb.extension().and_then(|e| e.to_str()) == Some("cmd") {
                if let Some(shim_source) = detect_source_from_cmd_shim(&cli_pb) {
                    return shim_source;
                }
            }
        }
        if let Ok(appdata) = std::env::var("APPDATA") {
            let shim_path = PathBuf::from(&appdata).join("npm").join("openclaw.cmd");
            if let Some(shim_source) = detect_source_from_cmd_shim(&shim_path) {
                return shim_source;
            }
        }
        // standalone 目录兜底
        for dir in all_standalone_dirs() {
            if dir.join("openclaw.cmd").exists() {
                return "chinese".into();
            }
        }
        return "unknown".into();
    }

    // Linux: symlink + npm list 检测
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        for bin_path in &["/usr/local/bin/openclaw"] {
            if let Ok(target) = std::fs::read_link(bin_path) {
                if target.to_string_lossy().contains("openclaw-zh") {
                    return "chinese".into();
                }
            }
        }
        if let Some(home) = dirs::home_dir() {
            let home_bin = home.join("bin").join("openclaw");
            if let Ok(target) = std::fs::read_link(&home_bin) {
                if target.to_string_lossy().contains("openclaw-zh") {
                    return "chinese".into();
                }
            }
        }
        // standalone 目录兜底
        for dir in all_standalone_dirs() {
            if dir.join("openclaw").exists() {
                return "chinese".into();
            }
        }
        if let Ok(o) = npm_command()
            .args(["list", "-g", "@qingchencloud/openclaw-zh", "--depth=0"])
            .output()
        {
            if String::from_utf8_lossy(&o.stdout).contains("openclaw-zh@") {
                return "chinese".into();
            }
        }
        "unknown".into()
    }
}

// === 多安装扫描 ===

/// 解析 CLI 路径的 "身份"（去重用），canonicalize + 去掉 .cmd/.exe 后缀
fn scan_cli_identity(cli_path: &str) -> Option<String> {
    let pb = PathBuf::from(cli_path);
    let canonical = pb.canonicalize().unwrap_or_else(|_| pb.clone());
    let s = canonical.to_string_lossy().to_string();
    // Windows: 去掉 .cmd/.exe/.ps1 后缀，统一到同一个 identity
    #[cfg(target_os = "windows")]
    {
        let lower = s.to_lowercase();
        for ext in &[".cmd", ".exe", ".ps1"] {
            if lower.ends_with(ext) {
                return Some(s[..s.len() - ext.len()].to_string());
            }
        }
    }
    Some(s)
}

/// 从 CLI 路径读取安装版本（委托给已有的 Path 版本实现）
fn read_version_at_cli(cli_path: &str) -> Option<String> {
    read_version_from_installation(&PathBuf::from(cli_path))
}

/// 扫描系统中所有 OpenClaw 安装位置
fn scan_all_installations(active_path: &Option<String>) -> Vec<OpenClawInstallation> {
    let active_identity = active_path.as_ref().and_then(|p| scan_cli_identity(p));
    let mut seen_identities = std::collections::HashSet::new();
    let mut results = Vec::new();

    // 收集候选路径
    let mut candidates = Vec::new();

    // 1. standalone 目录
    for dir in all_standalone_dirs() {
        #[cfg(target_os = "windows")]
        let bin = dir.join("openclaw.cmd");
        #[cfg(not(target_os = "windows"))]
        let bin = dir.join("openclaw");
        if bin.exists() {
            candidates.push(bin.to_string_lossy().to_string());
        }
    }

    // 2. 常见安装位置
    #[cfg(target_os = "macos")]
    {
        for p in &["/opt/homebrew/bin/openclaw", "/usr/local/bin/openclaw"] {
            if PathBuf::from(p).exists() {
                candidates.push(p.to_string());
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        for p in &[
            "/usr/local/bin/openclaw",
            "/usr/bin/openclaw",
            "/snap/bin/openclaw",
        ] {
            if PathBuf::from(p).exists() {
                candidates.push(p.to_string());
            }
        }
        if let Some(home) = dirs::home_dir() {
            for sub in &[
                ".local/bin/openclaw",
                ".npm-global/bin/openclaw",
                "bin/openclaw",
            ] {
                let p = home.join(sub);
                if p.exists() {
                    candidates.push(p.to_string_lossy().to_string());
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let p = PathBuf::from(&appdata).join("npm").join("openclaw.cmd");
            if p.exists() {
                candidates.push(p.to_string_lossy().to_string());
            }
        }
    }

    // 3. 活跃 CLI 路径也加入候选
    if let Some(ref active) = active_path {
        if !candidates.iter().any(|c| c == active) {
            candidates.push(active.clone());
        }
    }

    // 去重并构建结果
    for candidate in &candidates {
        if crate::utils::is_rejected_cli_path(candidate) {
            continue;
        }
        let identity = scan_cli_identity(candidate);
        if let Some(ref id) = identity {
            if !seen_identities.insert(id.clone()) {
                continue; // 已见过的身份，跳过
            }
        }
        let source = crate::utils::classify_cli_source(candidate);
        let version = read_version_at_cli(candidate);
        let is_active = active_identity
            .as_ref()
            .map(|ai| identity.as_ref() == Some(ai))
            .unwrap_or(false);
        results.push(OpenClawInstallation {
            path: candidate.clone(),
            source,
            version,
            active: is_active,
        });
    }

    // 排序：活跃优先，然后按来源、路径
    results.sort_by(|a, b| {
        if a.active != b.active {
            return if a.active {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        a.source.cmp(&b.source).then_with(|| a.path.cmp(&b.path))
    });

    results
}

#[tauri::command]
pub async fn get_version_info() -> Result<VersionInfo, String> {
    let current = get_local_version().await;
    let mut source = detect_installed_source();

    // 兜底：版本号含 -zh 则一定是汉化版
    if let Some(ref ver) = current {
        if ver.contains("-zh") && source != "chinese" {
            source = "chinese".into();
        }
    }

    // CLI 路径与来源分类
    let cli_path = crate::utils::resolve_openclaw_cli_path();
    let cli_source = cli_path
        .as_ref()
        .map(|p| crate::utils::classify_cli_source(p));

    // unknown 来源时尝试通过 CLI 分类补救
    if source == "unknown" {
        if let Some(ref cs) = cli_source {
            let normalized = normalize_cli_install_source(cs);
            if normalized != "unknown" {
                source = normalized.into();
            }
        }
    }

    // unknown 来源跳过 npm 查询（避免无效网络请求）
    let latest = if source == "unknown" {
        None
    } else {
        get_latest_version_for(&source).await
    };
    let recommended = if source == "unknown" {
        None
    } else {
        recommended_version_for(&source)
    };

    let update_available = match (&current, &recommended) {
        (Some(c), Some(r)) => recommended_is_newer(r, c),
        (None, Some(_)) => true,
        _ => false,
    };
    let latest_update_available = match (&current, &latest) {
        (Some(c), Some(l)) => recommended_is_newer(l, c),
        (None, Some(_)) => true,
        _ => false,
    };
    let is_recommended = match (&current, &recommended) {
        (Some(c), Some(r)) => versions_match(c, r),
        _ => false,
    };
    let ahead_of_recommended = match (&current, &recommended) {
        (Some(c), Some(r)) => recommended_is_newer(c, r),
        _ => false,
    };

    // 多安装扫描
    let all_installations = scan_all_installations(&cli_path);

    Ok(VersionInfo {
        current,
        latest,
        recommended,
        update_available,
        latest_update_available,
        is_recommended,
        ahead_of_recommended,
        panel_version: panel_version().to_string(),
        source,
        cli_path,
        cli_source,
        all_installations: Some(all_installations),
    })
}

/// 获取 OpenClaw 运行时状态摘要（openclaw status --json）
/// 包含 runtimeVersion、会话列表（含 token 用量、fastMode 等标签）
#[tauri::command]
pub async fn get_status_summary() -> Result<Value, String> {
    let output = crate::utils::openclaw_command_async()
        .args(["status", "--json"])
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            // CLI 输出可能含非 JSON 行，复用 skills 模块的 extract_json
            crate::commands::skills::extract_json_pub(&stdout)
                .ok_or_else(|| "解析失败: 输出中未找到有效 JSON".to_string())
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            Err(format!("openclaw status 失败: {}", stderr.trim()))
        }
        Err(e) => Err(format!("执行 openclaw 失败: {e}")),
    }
}

/// npm 包名映射
fn npm_package_name(source: &str) -> &'static str {
    match source {
        "chinese" => "@qingchencloud/openclaw-zh",
        _ => "openclaw",
    }
}

#[cfg(test)]
mod tests {
    use super::{npm_package_name, recommended_version_for};

    #[test]
    fn unknown_source_uses_official_package_name() {
        assert_eq!(npm_package_name("unknown"), "openclaw");
        assert_eq!(npm_package_name("official"), "openclaw");
        assert_eq!(npm_package_name("chinese"), "@qingchencloud/openclaw-zh");
    }

    #[test]
    fn unknown_source_falls_back_to_official_recommendation() {
        assert_eq!(
            recommended_version_for("unknown"),
            recommended_version_for("official")
        );
    }
}

/// 获取指定源的所有可用版本列表（从 npm registry 查询）
#[tauri::command]
pub async fn list_openclaw_versions(source: String) -> Result<Vec<String>, String> {
    let client = crate::commands::build_http_client(std::time::Duration::from_secs(10), None)
        .map_err(|e| format!("HTTP 初始化失败: {e}"))?;
    let pkg = npm_package_name(&source).replace('/', "%2F");
    let registry = get_configured_registry();
    let url = format!("{registry}/{pkg}");
    let resp = client
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("查询版本失败: {e}"))?;
    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {e}"))?;
    let mut versions = json
        .get("versions")
        .and_then(|v| v.as_object())
        .map(|obj| {
            let mut vers: Vec<String> = obj.keys().cloned().collect();
            vers.sort_by(|a, b| {
                let pa = parse_version(a);
                let pb = parse_version(b);
                pb.cmp(&pa)
            });
            vers
        })
        .unwrap_or_default();
    if let Some(recommended) = recommended_version_for(&source) {
        if let Some(pos) = versions.iter().position(|v| v == &recommended) {
            let version = versions.remove(pos);
            versions.insert(0, version);
        } else {
            versions.insert(0, recommended);
        }
    }
    Ok(versions)
}

async fn try_standalone_install(
    app: &tauri::AppHandle,
    version: &str,
    override_base_url: Option<&str>,
) -> Result<String, String> {
    use tauri::Emitter;

    let source_label = if override_base_url.is_some() {
        "GitHub"
    } else {
        "CDN"
    };
    let cfg = standalone_config();
    if !cfg.enabled {
        return Err("standalone 安装未启用".into());
    }
    let base_url = cfg.base_url.as_deref().ok_or("standalone baseUrl 未配置")?;
    let platform = standalone_platform_key();
    if platform == "unknown" {
        return Err("当前平台不支持 standalone 安装包".into());
    }
    let install_dir = standalone_install_dir().ok_or("无法确定 standalone 安装目录")?;

    let _ = app.emit(
        "upgrade-log",
        "📦 尝试 standalone 独立安装包（汉化版专属，自带 Node.js 运行时，无需 npm）",
    );
    let _ = app.emit("upgrade-log", "查询最新版本...");
    let manifest_url = format!("{base_url}/latest.json");
    let client = crate::commands::build_http_client(std::time::Duration::from_secs(10), None)
        .map_err(|e| format!("HTTP 客户端创建失败: {e}"))?;
    let manifest_resp = client
        .get(&manifest_url)
        .send()
        .await
        .map_err(|e| format!("standalone 清单获取失败: {e}"))?;
    if !manifest_resp.status().is_success() {
        return Err(format!(
            "standalone 清单不可用 (HTTP {})",
            manifest_resp.status()
        ));
    }
    let manifest: Value = manifest_resp
        .json()
        .await
        .map_err(|e| format!("standalone 清单解析失败: {e}"))?;

    let remote_version = manifest
        .get("version")
        .and_then(|v| v.as_str())
        .ok_or("standalone 清单缺少 version 字段")?;
    if version != "latest" && !versions_match(remote_version, version) {
        return Err(format!(
            "standalone 版本 {remote_version} 与请求版本 {version} 不匹配"
        ));
    }

    let default_base = format!("{base_url}/{remote_version}");
    let remote_base = if let Some(override_url) = override_base_url {
        override_url
    } else {
        manifest
            .get("base_url")
            .and_then(|v| v.as_str())
            .unwrap_or(&default_base)
    };
    let ext = standalone_archive_ext();
    let filename = format!("openclaw-{remote_version}-{platform}.{ext}");
    let download_url = format!("{remote_base}/{filename}");

    let _ = app.emit("upgrade-log", format!("从 {source_label} 下载: {filename}"));
    let _ = app.emit("upgrade-progress", 15);

    let archive_path = std::env::temp_dir().join(&filename);

    // 下载带重试：最多 3 次，间隔递增（2s, 5s）
    let max_retries = 3u32;
    let mut last_err = String::new();
    let dl_client = crate::commands::build_http_client(std::time::Duration::from_secs(600), None)
        .map_err(|e| format!("下载客户端创建失败: {e}"))?;
    for attempt in 1..=max_retries {
        if attempt > 1 {
            let delay = if attempt == 2 { 2 } else { 5 };
            let _ = app.emit(
                "upgrade-log",
                format!("第 {attempt}/{max_retries} 次重试（等待 {delay}s）..."),
            );
            tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
        }

        let dl_resp = match dl_client.get(&download_url).send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = format!("standalone 下载失败: {e}");
                let _ = app.emit("upgrade-log", format!("下载请求失败: {e}"));
                continue;
            }
        };

        if !dl_resp.status().is_success() {
            last_err = format!(
                "standalone 下载失败 (HTTP {}): {download_url}",
                dl_resp.status()
            );
            let _ = app.emit("upgrade-log", &last_err);
            // HTTP 4xx 不重试（资源不存在）
            if dl_resp.status().is_client_error() {
                return Err(last_err);
            }
            continue;
        }

        let total_bytes = dl_resp.content_length().unwrap_or(0);
        let size_mb = if total_bytes > 0 {
            format!("{:.0}MB", total_bytes as f64 / 1_048_576.0)
        } else {
            "未知大小".into()
        };
        let _ = app.emit("upgrade-log", format!("下载中 ({size_mb})..."));

        let stream_result: Result<(), String> = async {
            use futures_util::StreamExt;
            use tokio::io::AsyncWriteExt;
            let mut file = tokio::fs::File::create(&archive_path)
                .await
                .map_err(|e| format!("创建临时文件失败: {e}"))?;
            let mut stream = dl_resp.bytes_stream();
            let mut downloaded: u64 = 0;
            let mut last_progress = 15u32;
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| format!("下载中断: {e}"))?;
                file.write_all(&chunk)
                    .await
                    .map_err(|e| format!("写入失败: {e}"))?;
                downloaded += chunk.len() as u64;
                if total_bytes > 0 {
                    let pct = 15 + ((downloaded as f64 / total_bytes as f64) * 55.0) as u32;
                    if pct > last_progress {
                        last_progress = pct;
                        let _ = app.emit("upgrade-progress", pct.min(70));
                    }
                }
            }
            file.flush()
                .await
                .map_err(|e| format!("刷新文件失败: {e}"))?;
            Ok(())
        }
        .await;

        match stream_result {
            Ok(()) => {
                last_err.clear();
                break;
            }
            Err(e) => {
                let _ = app.emit("upgrade-log", format!("下载流中断: {e}"));
                last_err = e;
                continue;
            }
        }
    }

    if !last_err.is_empty() {
        return Err(last_err);
    }

    let _ = app.emit("upgrade-log", "下载完成，解压安装中...");
    let _ = app.emit("upgrade-progress", 72);

    if install_dir.exists() {
        let _ = std::fs::remove_dir_all(&install_dir);
    }
    std::fs::create_dir_all(&install_dir).map_err(|e| format!("创建安装目录失败: {e}"))?;

    #[cfg(target_os = "windows")]
    {
        let archive_file =
            std::fs::File::open(&archive_path).map_err(|e| format!("打开归档失败: {e}"))?;
        let mut zip_archive =
            zip::ZipArchive::new(archive_file).map_err(|e| format!("ZIP 解析失败: {e}"))?;
        zip_archive
            .extract(&install_dir)
            .map_err(|e| format!("ZIP 解压失败: {e}"))?;
        let nested = install_dir.join("openclaw");
        if nested.exists() && nested.join("node.exe").exists() {
            for entry in std::fs::read_dir(&nested)
                .map_err(|e| format!("读取目录失败: {e}"))?
                .flatten()
            {
                let dest = install_dir.join(entry.file_name());
                let _ = std::fs::rename(entry.path(), &dest);
            }
            let _ = std::fs::remove_dir_all(&nested);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let status = Command::new("tar")
            .args([
                "-xzf",
                &archive_path.to_string_lossy(),
                "-C",
                &install_dir.to_string_lossy(),
                "--strip-components=1",
            ])
            .status()
            .map_err(|e| format!("解压失败: {e}"))?;
        if !status.success() {
            return Err("tar 解压失败".into());
        }
    }

    let _ = std::fs::remove_file(&archive_path);
    let _ = app.emit("upgrade-progress", 85);

    #[cfg(target_os = "windows")]
    let openclaw_bin = install_dir.join("openclaw.cmd");
    #[cfg(not(target_os = "windows"))]
    let openclaw_bin = install_dir.join("openclaw");
    if !openclaw_bin.exists() {
        return Err("standalone 解压后未找到 openclaw 可执行文件".into());
    }

    #[cfg(target_os = "windows")]
    {
        let install_str = install_dir.to_string_lossy().to_string();
        let current_path = std::env::var("PATH").unwrap_or_default();
        if !current_path
            .split(';')
            .any(|p| p.eq_ignore_ascii_case(&install_str))
        {
            let _ = Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-Command",
                    &format!(
                        "$p = [Environment]::GetEnvironmentVariable('Path','User'); if ($p -notlike '*{}*') {{ [Environment]::SetEnvironmentVariable('Path', $p + ';{}', 'User') }}",
                        install_str.replace('\'', "''"),
                        install_str.replace('\'', "''")
                    ),
                ])
                .creation_flags(0x08000000)
                .status();
            let _ = app.emit("upgrade-log", format!("已添加到 PATH: {install_str}"));
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let link_targets = [
            PathBuf::from("/usr/local/bin/openclaw"),
            dirs::home_dir()
                .unwrap_or_default()
                .join("bin")
                .join("openclaw"),
        ];
        for link in &link_targets {
            if let Some(parent) = link.parent() {
                if !parent.exists() {
                    continue;
                }
                let _ = std::fs::remove_file(link);
                #[cfg(unix)]
                {
                    if std::os::unix::fs::symlink(&openclaw_bin, link).is_ok() {
                        let _ = Command::new("chmod")
                            .args(["+x", &openclaw_bin.to_string_lossy()])
                            .status();
                        let _ =
                            app.emit("upgrade-log", format!("symlink 已创建: {}", link.display()));
                        break;
                    }
                }
            }
        }
    }

    let _ = app.emit("upgrade-progress", 95);
    let _ = app.emit(
        "upgrade-log",
        format!("✅ standalone 独立安装包安装完成 ({remote_version})"),
    );
    let _ = app.emit(
        "upgrade-log",
        format!("安装目录: {}", install_dir.display()),
    );
    crate::commands::service::invalidate_cli_detection_cache();

    Ok(remote_version.to_string())
}

/// 执行 npm 全局安装/升级/降级 openclaw（后台执行，通过 event 推送进度）
/// 立即返回，不阻塞前端。完成后 emit "upgrade-done" 或 "upgrade-error"。
#[tauri::command]
pub async fn upgrade_openclaw(
    app: tauri::AppHandle,
    source: String,
    version: Option<String>,
    method: String,
) -> Result<String, String> {
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;
        let result = upgrade_openclaw_inner(app2.clone(), source, version, method).await;
        match result {
            Ok(msg) => {
                let _ = app2.emit("upgrade-done", &msg);
            }
            Err(err) => {
                let _ = app2.emit("upgrade-error", &err);
            }
        }
    });
    Ok("任务已启动".into())
}

/// 安装完成后，确保 `openclaw` 命令在用户系统 PATH 中可达。
/// 解决用户在终端中输入 `openclaw` 提示 "command not found" 的问题。
///
/// 策略：
/// 1. 用原始系统 PATH（不用 enhanced_path）检测 openclaw 是否可达
/// 2. 如果不可达，通过 enhanced_path 找到实际安装路径
/// 3. 尝试创建 symlink 到 /usr/local/bin 或 ~/.local/bin
/// 4. 全部失败则通过 event 提示用户手动添加 PATH
fn ensure_cli_in_path(app: &tauri::AppHandle) {
    use tauri::Emitter;

    // Windows: standalone 安装已在 try_standalone_install 中处理 PATH，
    // npm 安装默认把 .cmd 放在 %APPDATA%\npm 下，一般已在 PATH 中
    #[cfg(target_os = "windows")]
    {
        let check = Command::new("where").arg("openclaw").output();
        match check {
            Ok(o) if o.status.success() => return,
            _ => {
                // 尝试把 npm global bin 目录加到用户 PATH
                if let Ok(o) = npm_command().args(["config", "get", "prefix"]).output() {
                    if o.status.success() {
                        let prefix = String::from_utf8_lossy(&o.stdout).trim().to_string();
                        if !prefix.is_empty() {
                            let _ = app.emit("upgrade-log",
                                format!("⚠️ 终端可能找不到 openclaw 命令。请将以下目录添加到系统 PATH:\n  {prefix}"));
                        }
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let system_check = Command::new("sh")
            .args(["-c", "command -v openclaw"])
            .output();
        if let Ok(o) = &system_check {
            if o.status.success() {
                return; // 已经在系统 PATH 中，无需处理
            }
        }

        let cli_path = match crate::utils::resolve_openclaw_cli_path() {
            Some(p) => p,
            None => return, // 连 enhanced_path 都找不到，安装可能失败了
        };

        let _ = app.emit("upgrade-log", "正在配置终端 PATH...");

        // 尝试创建 symlink
        let link_targets = [
            std::path::PathBuf::from("/usr/local/bin/openclaw"),
            dirs::home_dir()
                .unwrap_or_default()
                .join(".local")
                .join("bin")
                .join("openclaw"),
            dirs::home_dir()
                .unwrap_or_default()
                .join("bin")
                .join("openclaw"),
        ];

        let src = std::path::Path::new(&cli_path);
        for link in &link_targets {
            if let Some(parent) = link.parent() {
                if !parent.exists() {
                    // 对 ~/.local/bin 尝试创建目录
                    if link.to_string_lossy().contains(".local/bin") {
                        let _ = std::fs::create_dir_all(parent);
                    } else {
                        continue;
                    }
                }
                let _ = std::fs::remove_file(link);
                if std::os::unix::fs::symlink(src, link).is_ok() {
                    let _ = app.emit(
                        "upgrade-log",
                        format!("✅ 已创建 symlink: {} → {}", link.display(), cli_path),
                    );
                    return;
                }
            }
        }

        let shell = std::env::var("SHELL").unwrap_or_default();
        let rc_file = if shell.contains("zsh") {
            "~/.zshrc"
        } else if shell.contains("fish") {
            "~/.config/fish/config.fish"
        } else {
            "~/.bashrc"
        };
        let bin_dir = std::path::Path::new(&cli_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        if shell.contains("fish") {
            let _ = app.emit(
                "upgrade-log",
                format!(
                    "⚠️ 终端无法直接找到 openclaw 命令。请执行以下命令后重启终端:\n  \
                     echo 'set -gx PATH {} $PATH' >> {}",
                    bin_dir, rc_file
                ),
            );
        } else {
            let _ = app.emit(
                "upgrade-log",
                format!(
                    "⚠️ 终端无法直接找到 openclaw 命令。请执行以下命令后重启终端:\n  \
                     echo 'export PATH=\"{}:$PATH\"' >> {}",
                    bin_dir, rc_file
                ),
            );
        }
    }
}

async fn upgrade_openclaw_inner(
    app: tauri::AppHandle,
    source: String,
    version: Option<String>,
    method: String,
) -> Result<String, String> {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;
    use tauri::Emitter;
    let _guardian_pause = GuardianPause::new("upgrade");

    let current_source = detect_installed_source();
    let pkg_name = npm_package_name(&source);
    let requested_version = version.clone();
    let recommended_version = recommended_version_for(&source);
    let ver = requested_version
        .as_deref()
        .or(recommended_version.as_deref())
        .unwrap_or("latest");
    let pkg = format!("{}@{}", pkg_name, ver);

    let try_standalone = source != "official"
        && (method == "auto" || method == "standalone-r2" || method == "standalone-github");

    if try_standalone {
        let github_base = if method == "standalone-github" {
            Some(format!(
                "https://github.com/qingchencloud/openclaw-standalone/releases/download/v{}",
                ver
            ))
        } else {
            None
        };
        match try_standalone_install(&app, ver, github_base.as_deref()).await {
            Ok(installed_ver) => {
                let _ = app.emit("upgrade-progress", 90);
                super::refresh_enhanced_path();
                crate::commands::service::invalidate_cli_detection_cache();

                // standalone 安装成功后，后台清理可能残留的 npm 安装，避免双重安装导致版本混乱
                let pkg_a = npm_package_name("official");
                let pkg_b = npm_package_name("chinese");
                let bg_app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = bg_app.emit(
                        "upgrade-log",
                        format!("清理可能残留的 npm 安装 ({pkg_a}, {pkg_b})..."),
                    );
                    let _ = npm_command()
                        .args(["uninstall", "-g", pkg_a, pkg_b])
                        .output();
                });

                let _ = app.emit("upgrade-progress", 100);
                let label = if method == "standalone-github" {
                    "GitHub"
                } else {
                    "CDN"
                };
                let msg = format!("✅ standalone ({label}) 安装完成，当前版本: {installed_ver}");
                let _ = app.emit("upgrade-log", &msg);
                return Ok(msg);
            }
            Err(reason) => {
                if method == "auto" {
                    let _ = app.emit(
                        "upgrade-log",
                        format!("standalone 不可用（{reason}），降级到 npm 安装..."),
                    );
                    let _ = app.emit("upgrade-progress", 5);
                } else {
                    return Err(format!("standalone 安装失败: {reason}"));
                }
            }
        }
    }

    // 切换源时需要卸载旧包，但为避免安装失败导致 CLI 丢失，
    // 先安装新包，成功后再卸载旧包
    let old_pkg = npm_package_name(&current_source);
    let need_uninstall_old = current_source != source;

    if requested_version.is_none() {
        if let Some(recommended) = &recommended_version {
            let _ = app.emit(
                "upgrade-log",
                format!(
                    "Privix {} 默认绑定 OpenClaw 稳定版: {}",
                    panel_version(),
                    recommended
                ),
            );
        } else {
            let _ = app.emit("upgrade-log", "未找到绑定稳定版，将回退到 latest");
        }
    }
    let configured_rules = configure_git_https_rules();
    let _ = app.emit(
        "upgrade-log",
        format!(
            "Git HTTPS 规则已就绪 ({}/{})",
            configured_rules,
            GIT_HTTPS_REWRITES.len()
        ),
    );

    // 安装前：停止 Gateway 并清理可能冲突的 bin 文件
    let _ = app.emit("upgrade-log", "正在停止 Gateway 并清理旧文件...");
    pre_install_cleanup();

    let _ = app.emit("upgrade-log", format!("$ npm install -g {pkg} --force"));
    let _ = app.emit("upgrade-progress", 10);

    // 汉化版只支持官方源和淘宝源
    let configured_registry = get_configured_registry();
    let registry = if pkg_name.contains("openclaw-zh") {
        // 汉化版：淘宝源或官方源
        if configured_registry.contains("npmmirror.com")
            || configured_registry.contains("taobao.org")
        {
            configured_registry.as_str()
        } else {
            "https://registry.npmjs.org"
        }
    } else {
        // 官方版：使用用户配置的镜像源
        configured_registry.as_str()
    };

    let mut install_cmd = npm_command();
    install_cmd.args([
        "install",
        "-g",
        &pkg,
        "--force",
        "--registry",
        registry,
        "--verbose",
    ]);
    apply_git_install_env(&mut install_cmd);
    let mut child = install_cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("执行升级命令失败: {e}"))?;

    let stderr = child.stderr.take();
    let stdout = child.stdout.take();

    // stderr 每行递增进度（10→80 区间），让用户看到进度在动
    // 同时收集 stderr 用于失败时返回给前端诊断
    let app2 = app.clone();
    let stderr_lines = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let stderr_lines2 = stderr_lines.clone();
    let handle = std::thread::spawn(move || {
        let mut progress: u32 = 15;
        if let Some(pipe) = stderr {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let _ = app2.emit("upgrade-log", &line);
                stderr_lines2.lock().unwrap().push(line);
                if progress < 75 {
                    progress += 2;
                    let _ = app2.emit("upgrade-progress", progress);
                }
            }
        }
    });

    if let Some(pipe) = stdout {
        for line in BufReader::new(pipe).lines().map_while(Result::ok) {
            let _ = app.emit("upgrade-log", &line);
        }
    }

    let _ = handle.join();
    let _ = app.emit("upgrade-progress", 80);

    let status = child.wait().map_err(|e| format!("等待进程失败: {e}"))?;
    let _ = app.emit("upgrade-progress", 100);

    if !status.success() {
        let code = status
            .code()
            .map(|c| c.to_string())
            .unwrap_or("unknown".into());

        // 如果使用了镜像源失败，自动降级到官方源重试
        let used_mirror = registry.contains("npmmirror.com") || registry.contains("taobao.org");
        if used_mirror {
            let _ = app.emit("upgrade-log", "");
            let _ = app.emit("upgrade-log", "⚠️ 镜像源安装失败，自动切换到官方源重试...");
            let _ = app.emit("upgrade-progress", 15);
            let fallback = "https://registry.npmjs.org";
            let mut install_cmd2 = npm_command();
            install_cmd2.args([
                "install",
                "-g",
                &pkg,
                "--force",
                "--registry",
                fallback,
                "--verbose",
            ]);
            apply_git_install_env(&mut install_cmd2);
            let mut child2 = install_cmd2
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("执行重试命令失败: {e}"))?;
            let stderr2 = child2.stderr.take();
            let stdout2 = child2.stdout.take();
            let app3 = app.clone();
            let stderr_lines3 = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
            let stderr_lines4 = stderr_lines3.clone();
            let handle2 = std::thread::spawn(move || {
                if let Some(pipe) = stderr2 {
                    let mut p: u32 = 20;
                    for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                        let _ = app3.emit("upgrade-log", &line);
                        stderr_lines4.lock().unwrap().push(line);
                        if p < 75 {
                            p += 2;
                            let _ = app3.emit("upgrade-progress", p);
                        }
                    }
                }
            });
            if let Some(pipe) = stdout2 {
                for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                    let _ = app.emit("upgrade-log", &line);
                }
            }
            let _ = handle2.join();
            let _ = app.emit("upgrade-progress", 80);
            let status2 = child2
                .wait()
                .map_err(|e| format!("等待重试进程失败: {e}"))?;
            let _ = app.emit("upgrade-progress", 100);
            if !status2.success() {
                let code2 = status2
                    .code()
                    .map(|c| c.to_string())
                    .unwrap_or("unknown".into());
                let tail = stderr_lines3
                    .lock()
                    .unwrap()
                    .iter()
                    .rev()
                    .take(15)
                    .rev()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("\n");
                return Err(format!(
                    "升级失败（镜像源和官方源均失败），exit code: {code2}\n{tail}"
                ));
            }
            let _ = app.emit("upgrade-log", "✅ 官方源安装成功");
        } else {
            let _ = app.emit("upgrade-log", format!("❌ 升级失败 (exit code: {code})"));
            let tail = stderr_lines
                .lock()
                .unwrap()
                .iter()
                .rev()
                .take(15)
                .rev()
                .cloned()
                .collect::<Vec<_>>()
                .join("\n");
            return Err(format!("升级失败，exit code: {code}\n{tail}"));
        }
    }

    // 安装成功后再卸载旧包（确保 CLI 始终可用）
    if need_uninstall_old {
        let _ = app.emit("upgrade-log", format!("清理旧版本 ({old_pkg})..."));
        let _ = npm_command().args(["uninstall", "-g", old_pkg]).output();
    }

    // 切换源后重装 Gateway 服务
    if need_uninstall_old {
        let _ = app.emit("upgrade-log", "正在重装 Gateway 服务（更新启动路径）...");

        // 刷新 PATH 缓存和 CLI 检测缓存，确保找到新安装的二进制
        super::refresh_enhanced_path();
        crate::commands::service::invalidate_cli_detection_cache();

        // 先停掉旧的
        #[cfg(target_os = "macos")]
        {
            let uid = get_uid().unwrap_or(501);
            let _ = Command::new("launchctl")
                .args(["bootout", &format!("gui/{uid}/ai.openclaw.gateway")])
                .output();
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = openclaw_command().args(["gateway", "stop"]).output();
        }
        // 重新安装（刷新后的 PATH 会找到新二进制）
        use crate::utils::openclaw_command_async;
        let gw_out = openclaw_command_async()
            .args(["gateway", "install"])
            .output()
            .await;
        match gw_out {
            Ok(o) if o.status.success() => {
                let _ = app.emit("upgrade-log", "Gateway 服务已重装");
            }
            _ => {
                let _ = app.emit(
                    "upgrade-log",
                    "⚠️ Gateway 重装失败，请手动执行 openclaw gateway install",
                );
            }
        }
    }

    // 刷新 PATH 缓存和 CLI 检测缓存
    super::refresh_enhanced_path();
    crate::commands::service::invalidate_cli_detection_cache();

    // 确保 openclaw 在用户的系统 PATH 中可达（解决终端 "command not found"）
    ensure_cli_in_path(&app);

    let new_ver = get_local_version().await.unwrap_or_else(|| "未知".into());
    let msg = format!("✅ 安装完成，当前版本: {new_ver}");
    let _ = app.emit("upgrade-log", &msg);
    Ok(msg)
}

/// 卸载 OpenClaw（后台执行，通过 event 推送进度）
/// 立即返回，不阻塞前端。完成后 emit "upgrade-done" 或 "upgrade-error"。
#[tauri::command]
pub async fn uninstall_openclaw(
    app: tauri::AppHandle,
    clean_config: bool,
) -> Result<String, String> {
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;
        let result = uninstall_openclaw_inner(app2.clone(), clean_config).await;
        match result {
            Ok(msg) => {
                let _ = app2.emit("upgrade-done", &msg);
            }
            Err(err) => {
                let _ = app2.emit("upgrade-error", &err);
            }
        }
    });
    Ok("任务已启动".into())
}

async fn uninstall_openclaw_inner(
    app: tauri::AppHandle,
    clean_config: bool,
) -> Result<String, String> {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;
    use tauri::Emitter;
    let _guardian_pause = GuardianPause::new("uninstall openclaw");
    crate::commands::service::guardian_mark_manual_stop();

    let source = detect_installed_source();
    let pkg = npm_package_name(&source);

    // 1. 先停止 Gateway
    let _ = app.emit("upgrade-log", "正在停止 Gateway...");
    #[cfg(target_os = "macos")]
    {
        let uid = get_uid().unwrap_or(501);
        let _ = Command::new("launchctl")
            .args(["bootout", &format!("gui/{uid}/ai.openclaw.gateway")])
            .output();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = openclaw_command().args(["gateway", "stop"]).output();
    }

    // 2. 卸载 Gateway 服务
    let _ = app.emit("upgrade-log", "正在卸载 Gateway 服务...");
    #[cfg(not(target_os = "macos"))]
    {
        let _ = openclaw_command().args(["gateway", "uninstall"]).output();
    }

    // 3. standalone 清理
    for dir in all_standalone_dirs() {
        if dir.exists() {
            let _ = app.emit(
                "upgrade-log",
                format!("正在清理 standalone 安装目录: {}", dir.display()),
            );
            let _ = std::fs::remove_dir_all(&dir);
        }
    }

    // 4. npm uninstall
    let _ = app.emit("upgrade-log", format!("$ npm uninstall -g {pkg}"));
    let _ = app.emit("upgrade-progress", 20);

    let mut child = npm_command()
        .args(["uninstall", "-g", pkg])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("执行卸载命令失败: {e}"))?;

    let stderr = child.stderr.take();
    let stdout = child.stdout.take();

    let app2 = app.clone();
    let handle = std::thread::spawn(move || {
        if let Some(pipe) = stderr {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let _ = app2.emit("upgrade-log", &line);
            }
        }
    });

    if let Some(pipe) = stdout {
        for line in BufReader::new(pipe).lines().map_while(Result::ok) {
            let _ = app.emit("upgrade-log", &line);
        }
    }

    let _ = handle.join();
    let _ = app.emit("upgrade-progress", 60);

    let status = child.wait().map_err(|e| format!("等待进程失败: {e}"))?;
    if !status.success() {
        let code = status
            .code()
            .map(|c| c.to_string())
            .unwrap_or("unknown".into());
        return Err(format!("卸载失败，exit code: {code}"));
    }

    // 5. 两个包都尝试卸载（确保干净）
    let other_pkg = if source == "official" {
        "@qingchencloud/openclaw-zh"
    } else {
        "openclaw"
    };
    let _ = app.emit("upgrade-log", format!("清理 {other_pkg}..."));
    let _ = npm_command().args(["uninstall", "-g", other_pkg]).output();
    let _ = app.emit("upgrade-progress", 80);

    // 6. 可选：清理配置目录
    if clean_config {
        let config_dir = super::openclaw_dir();
        if config_dir.exists() {
            let _ = app.emit(
                "upgrade-log",
                format!("清理配置目录: {}", config_dir.display()),
            );
            if let Err(e) = std::fs::remove_dir_all(&config_dir) {
                let _ = app.emit(
                    "upgrade-log",
                    format!("⚠️ 清理配置目录失败: {e}（可能有文件被占用）"),
                );
            }
        }
    }

    let _ = app.emit("upgrade-progress", 100);
    let msg = if clean_config {
        "✅ OpenClaw 已完全卸载（包括配置文件）"
    } else {
        "✅ OpenClaw 已卸载（配置文件保留在 ~/.openclaw/）"
    };
    let _ = app.emit("upgrade-log", msg);
    Ok(msg.into())
}

/// 自动初始化配置文件（CLI 已装但 openclaw.json 不存在时）
#[tauri::command]
pub fn init_openclaw_config() -> Result<Value, String> {
    let dir = super::openclaw_dir();
    let config_path = dir.join("openclaw.json");
    let mut result = serde_json::Map::new();

    if config_path.exists() {
        result.insert("created".into(), Value::Bool(false));
        result.insert("message".into(), Value::String("配置文件已存在".into()));
        return Ok(Value::Object(result));
    }

    // 确保目录存在
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
    }

    let last_touched_version =
        recommended_version_for("chinese").unwrap_or_else(|| "2026.1.1".to_string());
    let default_config = serde_json::json!({
        "$schema": "https://openclaw.ai/schema/config.json",
        "meta": { "lastTouchedVersion": last_touched_version },
        "models": { "providers": {} },
        "gateway": {
            "mode": "local",
            "port": 18789,
            "auth": { "mode": "none" },
            "controlUi": { "allowedOrigins": ["*"], "allowInsecureAuth": true }
        },
        "tools": { "profile": "full", "sessions": { "visibility": "all" } }
    });

    let content =
        serde_json::to_string_pretty(&default_config).map_err(|e| format!("序列化失败: {e}"))?;
    std::fs::write(&config_path, content).map_err(|e| format!("写入失败: {e}"))?;

    result.insert("created".into(), Value::Bool(true));
    result.insert("message".into(), Value::String("配置文件已创建".into()));
    Ok(Value::Object(result))
}

#[tauri::command]
pub fn check_installation() -> Result<Value, String> {
    let dir = super::openclaw_dir();
    let installed = dir.join("openclaw.json").exists();
    let mut result = serde_json::Map::new();
    result.insert("installed".into(), Value::Bool(installed));
    result.insert(
        "path".into(),
        Value::String(dir.to_string_lossy().to_string()),
    );
    Ok(Value::Object(result))
}

/// 检测 Node.js 是否已安装，返回版本号
#[tauri::command]
pub fn check_node() -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    let mut cmd = Command::new("node");
    cmd.arg("--version");
    cmd.env("PATH", super::enhanced_path());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    match cmd.output() {
        Ok(o) if o.status.success() => {
            let ver = String::from_utf8_lossy(&o.stdout).trim().to_string();
            result.insert("installed".into(), Value::Bool(true));
            result.insert("version".into(), Value::String(ver.clone()));
            // Node 版本预检：解析主版本和次版本
            let (meets_minimum, recommended_upgrade) = evaluate_node_version(&ver);
            result.insert("meets_minimum".into(), Value::Bool(meets_minimum));
            if let Some(hint) = recommended_upgrade {
                result.insert("recommended_upgrade".into(), Value::String(hint));
            }
        }
        _ => {
            result.insert("installed".into(), Value::Bool(false));
            result.insert("version".into(), Value::Null);
            result.insert("meets_minimum".into(), Value::Bool(false));
        }
    }
    Ok(Value::Object(result))
}

/// 评估 Node 版本是否满足 OpenClaw 3.24 的最低要求（>= 22.14）
/// 返回 (meets_minimum, optional_upgrade_hint)
fn evaluate_node_version(ver: &str) -> (bool, Option<String>) {
    let cleaned = ver.strip_prefix('v').unwrap_or(ver);
    let parts: Vec<u32> = cleaned.split('.').filter_map(|s| s.parse().ok()).collect();
    let (major, minor) = (
        parts.first().copied().unwrap_or(0),
        parts.get(1).copied().unwrap_or(0),
    );

    match major {
        0..=21 => (
            false,
            Some("OpenClaw 3.24 要求 Node.js ≥ 22.14，请升级".into()),
        ),
        22 if minor < 14 => (
            false,
            Some(format!("当前 Node {ver} 低于最低要求 22.14，请升级")),
        ),
        22 => (true, Some("推荐升级到 Node 24 以获得最佳兼容性".into())),
        23 => (true, Some("推荐升级到 Node 24 以获得最佳兼容性".into())),
        _ => (true, None), // 24+ 完全满足
    }
}

/// 在指定路径下检测 node 是否存在
#[tauri::command]
pub fn check_node_at_path(node_dir: String) -> Result<Value, String> {
    let dir = std::path::PathBuf::from(&node_dir);
    #[cfg(target_os = "windows")]
    let node_bin = dir.join("node.exe");
    #[cfg(not(target_os = "windows"))]
    let node_bin = dir.join("node");

    let mut result = serde_json::Map::new();
    if !node_bin.exists() {
        result.insert("installed".into(), Value::Bool(false));
        result.insert("version".into(), Value::Null);
        return Ok(Value::Object(result));
    }

    let mut cmd = Command::new(&node_bin);
    cmd.arg("--version");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    match cmd.output() {
        Ok(o) if o.status.success() => {
            let ver = String::from_utf8_lossy(&o.stdout).trim().to_string();
            result.insert("installed".into(), Value::Bool(true));
            result.insert("version".into(), Value::String(ver));
            result.insert("path".into(), Value::String(node_dir));
        }
        _ => {
            result.insert("installed".into(), Value::Bool(false));
            result.insert("version".into(), Value::Null);
        }
    }
    Ok(Value::Object(result))
}

/// 扫描常见路径，返回所有找到的 Node.js 安装
#[tauri::command]
pub fn scan_node_paths() -> Result<Value, String> {
    let mut found: Vec<Value> = vec![];
    let home = dirs::home_dir().unwrap_or_default();

    let mut candidates: Vec<String> = vec![];

    #[cfg(target_os = "windows")]
    {
        let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
        let pf86 =
            std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".into());
        let localappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let appdata = std::env::var("APPDATA").unwrap_or_default();

        candidates.push(format!(r"{}\nodejs", pf));
        candidates.push(format!(r"{}\nodejs", pf86));
        if !localappdata.is_empty() {
            candidates.push(format!(r"{}\Programs\nodejs", localappdata));
        }
        if !appdata.is_empty() {
            candidates.push(format!(r"{}\npm", appdata));
        }
        candidates.push(format!(r"{}\.volta\bin", home.display()));
        candidates.push(format!(r"{}\.nvm", home.display()));

        for drive in &["C", "D", "E", "F", "G"] {
            candidates.push(format!(r"{}:\nodejs", drive));
            candidates.push(format!(r"{}:\Node", drive));
            candidates.push(format!(r"{}:\Node.js", drive));
            candidates.push(format!(r"{}:\Program Files\nodejs", drive));
            // 扫描常见 AI 工具目录
            candidates.push(format!(r"{}:\AI\Node", drive));
            candidates.push(format!(r"{}:\AI\nodejs", drive));
            candidates.push(format!(r"{}:\Dev\nodejs", drive));
            candidates.push(format!(r"{}:\Tools\nodejs", drive));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        candidates.push("/usr/local/bin".into());
        candidates.push("/opt/homebrew/bin".into());
        candidates.push(format!("{}/.nvm/current/bin", home.display()));
        candidates.push(format!("{}/.volta/bin", home.display()));
        candidates.push(format!("{}/.nodenv/shims", home.display()));
        candidates.push(format!("{}/.fnm/current/bin", home.display()));
        candidates.push(format!("{}/n/bin", home.display()));
    }

    for dir in &candidates {
        let path = std::path::Path::new(dir);
        #[cfg(target_os = "windows")]
        let node_bin = path.join("node.exe");
        #[cfg(not(target_os = "windows"))]
        let node_bin = path.join("node");

        if node_bin.exists() {
            let mut cmd = Command::new(&node_bin);
            cmd.arg("--version");
            #[cfg(target_os = "windows")]
            cmd.creation_flags(0x08000000);
            if let Ok(o) = cmd.output() {
                if o.status.success() {
                    let ver = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    let mut entry = serde_json::Map::new();
                    entry.insert("path".into(), Value::String(dir.clone()));
                    entry.insert("version".into(), Value::String(ver));
                    found.push(Value::Object(entry));
                }
            }
        }
    }

    Ok(Value::Array(found))
}

/// 保存用户自定义的 Node.js 路径到当前 profile 的 clawpanel.json
#[tauri::command]
pub fn save_custom_node_path(node_dir: String) -> Result<(), String> {
    let config_path = super::panel_config_path();
    let mut config: serde_json::Map<String, Value> = if config_path.exists() {
        let content =
            std::fs::read_to_string(&config_path).map_err(|e| format!("读取配置失败: {e}"))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        serde_json::Map::new()
    };
    config.insert("nodePath".into(), Value::String(node_dir));
    let json = serde_json::to_string_pretty(&Value::Object(config))
        .map_err(|e| format!("序列化失败: {e}"))?;
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    std::fs::write(&config_path, json).map_err(|e| format!("写入配置失败: {e}"))?;
    // 立即刷新 PATH 缓存，使新路径生效（无需重启应用）
    super::refresh_enhanced_path();
    crate::commands::service::invalidate_cli_detection_cache();
    Ok(())
}

#[tauri::command]
pub fn write_env_file(path: String, config: String) -> Result<(), String> {
    let expanded = if let Some(stripped) = path.strip_prefix("~/") {
        dirs::home_dir().unwrap_or_default().join(stripped)
    } else {
        PathBuf::from(&path)
    };

    // 安全限制：只允许写入 ~/.openclaw/ 目录下的文件
    let openclaw_base = super::openclaw_dir();
    if !expanded.starts_with(&openclaw_base) {
        return Err("只允许写入 ~/.openclaw/ 目录下的文件".to_string());
    }

    if let Some(parent) = expanded.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&expanded, &config).map_err(|e| format!("写入 .env 失败: {e}"))
}

// ===== 备份管理 =====

#[tauri::command]
pub fn list_backups() -> Result<Value, String> {
    let dir = backups_dir();
    if !dir.exists() {
        return Ok(Value::Array(vec![]));
    }
    let mut backups: Vec<Value> = vec![];
    let entries = fs::read_dir(&dir).map_err(|e| format!("读取备份目录失败: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let meta = fs::metadata(&path).ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        // macOS 支持 created()，fallback 到 modified()
        let created = meta
            .and_then(|m| m.created().ok().or_else(|| m.modified().ok()))
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let mut obj = serde_json::Map::new();
        obj.insert("name".into(), Value::String(name));
        obj.insert("size".into(), Value::Number(size.into()));
        obj.insert("created_at".into(), Value::Number(created.into()));
        backups.push(Value::Object(obj));
    }
    // 按时间倒序
    backups.sort_by(|a, b| {
        let ta = a.get("created_at").and_then(|v| v.as_u64()).unwrap_or(0);
        let tb = b.get("created_at").and_then(|v| v.as_u64()).unwrap_or(0);
        tb.cmp(&ta)
    });
    Ok(Value::Array(backups))
}

#[tauri::command]
pub fn create_backup() -> Result<Value, String> {
    let dir = backups_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("创建备份目录失败: {e}"))?;

    let src = super::openclaw_dir().join("openclaw.json");
    if !src.exists() {
        return Err("openclaw.json 不存在".into());
    }

    let now = chrono::Local::now();
    let name = format!("openclaw-{}.json", now.format("%Y%m%d-%H%M%S"));
    let dest = dir.join(&name);
    fs::copy(&src, &dest).map_err(|e| format!("备份失败: {e}"))?;

    let size = fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    let mut obj = serde_json::Map::new();
    obj.insert("name".into(), Value::String(name));
    obj.insert("size".into(), Value::Number(size.into()));
    Ok(Value::Object(obj))
}

/// 检查备份文件名是否安全
fn is_unsafe_backup_name(name: &str) -> bool {
    name.contains("..") || name.contains('/') || name.contains('\\')
}

#[tauri::command]
pub fn restore_backup(name: String) -> Result<(), String> {
    if is_unsafe_backup_name(&name) {
        return Err("非法文件名".into());
    }
    let backup_path = backups_dir().join(&name);
    if !backup_path.exists() {
        return Err(format!("备份文件不存在: {name}"));
    }
    let target = super::openclaw_dir().join("openclaw.json");

    // 恢复前先自动备份当前配置
    if target.exists() {
        let _ = create_backup();
    }

    fs::copy(&backup_path, &target).map_err(|e| format!("恢复失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_backup(name: String) -> Result<(), String> {
    if is_unsafe_backup_name(&name) {
        return Err("非法文件名".into());
    }
    let path = backups_dir().join(&name);
    if !path.exists() {
        return Err(format!("备份文件不存在: {name}"));
    }
    fs::remove_file(&path).map_err(|e| format!("删除失败: {e}"))
}

/// 获取当前用户 UID（macOS/Linux 用 id -u，Windows 返回 0）
#[allow(dead_code)]
fn get_uid() -> Result<u32, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(0)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let output = Command::new("id")
            .arg("-u")
            .output()
            .map_err(|e| format!("获取 UID 失败: {e}"))?;
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<u32>()
            .map_err(|e| format!("解析 UID 失败: {e}"))
    }
}

/// 重载 Gateway 服务
/// macOS: launchctl kickstart -k
/// Windows/Linux: 直接通过进程管理重启（不走慢 CLI）
#[tauri::command]
pub async fn reload_gateway() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let uid = get_uid()?;
        let target = format!("gui/{uid}/ai.openclaw.gateway");
        let output = tokio::process::Command::new("launchctl")
            .args(["kickstart", "-k", &target])
            .output()
            .await
            .map_err(|e| format!("重载失败: {e}"))?;
        if output.status.success() {
            Ok("Gateway 已重载".to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("重载失败: {stderr}"))
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        // 直接调用服务管理（进程级别），避免慢 CLI 调用
        crate::commands::service::restart_service("ai.openclaw.gateway".into())
            .await
            .map(|_| "Gateway 已重载".to_string())
    }
}

/// 重启 Gateway 服务（与 reload_gateway 相同实现）
#[tauri::command]
pub async fn restart_gateway() -> Result<String, String> {
    reload_gateway().await
}

/// 清理 base URL：去掉尾部斜杠和已知端点路径，防止用户粘贴完整端点 URL 导致路径重复
fn normalize_base_url(raw: &str) -> String {
    let mut base = raw.trim_end_matches('/').to_string();
    for suffix in &[
        "/api/chat",
        "/api/generate",
        "/api/tags",
        "/api",
        "/chat/completions",
        "/completions",
        "/responses",
        "/messages",
        "/models",
    ] {
        if base.ends_with(suffix) {
            base.truncate(base.len() - suffix.len());
            break;
        }
    }
    base = base.trim_end_matches('/').to_string();
    if base.ends_with(":11434") {
        return format!("{base}/v1");
    }
    base
}

fn normalize_model_api_type(raw: &str) -> &'static str {
    match raw.trim() {
        "anthropic" | "anthropic-messages" => "anthropic-messages",
        "google-gemini" => "google-gemini",
        "openai" | "openai-completions" | "openai-responses" | "" => "openai-completions",
        _ => "openai-completions",
    }
}

fn normalize_base_url_for_api(raw: &str, api_type: &str) -> String {
    let mut base = normalize_base_url(raw);
    match normalize_model_api_type(api_type) {
        "anthropic-messages" => {
            if !base.ends_with("/v1") {
                base.push_str("/v1");
            }
            base
        }
        "google-gemini" => base,
        _ => {
            // 不再强制追加 /v1，尊重用户填写的 URL（火山引擎等第三方用 /v3 等路径）
            // 仅 Ollama (端口 11434) 自动补 /v1
            base
        }
    }
}

/// 剥离思考模型的 <think>...</think> 标签（MiniMax M2.7 / Kimi K2 等）
/// 思考内容在 <think> 标签内，实际回复在 </think> 之后
fn strip_think_tags(text: &str) -> String {
    // 先尝试匹配完整的 <think>...</think> 标签
    let mut result = text.to_string();
    while let Some(start) = result.find("<think>") {
        if let Some(end) = result[start..].find("</think>") {
            let end_pos = start + end + "</think>".len();
            result = format!("{}{}", &result[..start], &result[end_pos..]);
        } else {
            // 未闭合的 <think> 标签，删除从 <think> 到末尾的内容
            result = result[..start].to_string();
            break;
        }
    }
    let trimmed = result.trim().to_string();
    // 如果剥离后为空，返回原始文本（可能没有 think 标签）
    if trimmed.is_empty() {
        text.to_string()
    } else {
        trimmed
    }
}

/// 为 Anthropic Messages 兼容 API 添加认证 header
/// Kimi Code（api.kimi.com）使用 Bearer token，原生 Anthropic 使用 x-api-key
fn add_anthropic_auth(
    req: reqwest::RequestBuilder,
    api_key: &str,
    base_url: &str,
) -> reqwest::RequestBuilder {
    if api_key.is_empty() {
        return req;
    }
    // Kimi Code 等第三方 Anthropic 兼容 API 使用 Bearer 认证
    if base_url.contains("kimi.com") || api_key.starts_with("sk-kimi-") {
        req.header("Authorization", format!("Bearer {api_key}"))
    } else {
        req.header("x-api-key", api_key)
    }
}

/// 从 LLM 响应 JSON 中提取文本内容（兼容 Anthropic / OpenAI / Gemini / DashScope）
fn extract_llm_content(v: &serde_json::Value) -> Option<String> {
    // Anthropic 格式: content[].text
    if let Some(arr) = v.get("content").and_then(|c| c.as_array()) {
        let text = arr
            .iter()
            .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("");
        if !text.is_empty() {
            return Some(strip_think_tags(&text));
        }
    }
    // Gemini 格式: candidates[0].content.parts[0].text
    if let Some(t) = v
        .get("candidates")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.get(0))
        .and_then(|p| p.get("text"))
        .and_then(|t| t.as_str())
        .filter(|s| !s.is_empty())
    {
        return Some(strip_think_tags(t));
    }
    // OpenAI 格式: choices[0].message.content
    if let Some(msg) = v
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
    {
        let content = msg.get("content").and_then(|c| c.as_str()).unwrap_or("");
        if !content.is_empty() {
            return Some(strip_think_tags(content));
        }
        // reasoning 模型（DeepSeek R1 等）: reasoning_content 字段分离
        if let Some(rc) = msg
            .get("reasoning_content")
            .and_then(|c| c.as_str())
            .filter(|s| !s.is_empty())
        {
            return Some(format!("[reasoning] {rc}"));
        }
    }
    // DashScope 格式: output.text
    if let Some(t) = v
        .get("output")
        .and_then(|o| o.get("text"))
        .and_then(|t| t.as_str())
        .filter(|s| !s.is_empty())
    {
        return Some(strip_think_tags(t));
    }
    None
}

/// 从 LLM 响应 JSON 中提取 usage token 数据
fn extract_llm_usage(v: &serde_json::Value) -> (u64, u64) {
    if let Some(usage) = v.get("usage") {
        let input = usage
            .get("input_tokens")
            .or_else(|| usage.get("prompt_tokens"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let output = usage
            .get("output_tokens")
            .or_else(|| usage.get("completion_tokens"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        (input, output)
    } else if let Some(meta) = v.get("usageMetadata") {
        let input = meta
            .get("promptTokenCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let output = meta
            .get("candidatesTokenCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        (input, output)
    } else {
        (0, 0)
    }
}

fn extract_error_message(text: &str, status: reqwest::StatusCode) -> String {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|v| {
            v.get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .map(String::from)
                .or_else(|| v.get("message").and_then(|m| m.as_str()).map(String::from))
        })
        .unwrap_or_else(|| format!("HTTP {status}"))
}

/// 测试模型连通性：向 provider 发送一个简单的 chat completion 请求
#[tauri::command]
pub async fn test_model(
    base_url: String,
    api_key: String,
    model_id: String,
    api_type: Option<String>,
) -> Result<String, String> {
    let api_type = normalize_model_api_type(api_type.as_deref().unwrap_or("openai-completions"));
    let base = normalize_base_url_for_api(&base_url, api_type);

    let client =
        crate::commands::build_http_client_no_proxy(std::time::Duration::from_secs(30), None)
            .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let resp = match api_type {
        "anthropic-messages" => {
            let url = format!("{}/messages", base);
            let body = json!({
                "model": model_id,
                "messages": [{"role": "user", "content": "Hi"}],
                "max_tokens": 16,
            });
            let req = client
                .post(&url)
                .header("anthropic-version", "2023-06-01")
                .json(&body);
            add_anthropic_auth(req, &api_key, &base).send()
        }
        "google-gemini" => {
            let url = format!(
                "{}/models/{}:generateContent?key={}",
                base, model_id, api_key
            );
            let body = json!({
                "contents": [{"role": "user", "parts": [{"text": "Hi"}]}]
            });
            client.post(&url).json(&body).send()
        }
        _ => {
            let url = format!("{}/chat/completions", base);
            let body = json!({
                "model": model_id,
                "messages": [{"role": "user", "content": "Hi"}],
                "max_tokens": 16,
                "stream": false
            });
            let mut req = client.post(&url).json(&body);
            if !api_key.is_empty() {
                req = req.header("Authorization", format!("Bearer {api_key}"));
            }
            req.send()
        }
    }
    .await
    .map_err(|e| {
        if e.is_timeout() {
            "请求超时 (30s)".to_string()
        } else if e.is_connect() {
            format!("连接失败: {e}")
        } else {
            format!("请求失败: {e}")
        }
    })?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        let msg = extract_error_message(&text, status);
        // 401/403 是认证错误，一定要报错
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err(msg);
        }
        // 其他错误（400/422 等）：服务器可达、认证通过，仅模型对简单测试不兼容
        // 返回成功但带提示，避免误导用户认为模型不可用
        return Ok(format!(
            "⚠ 连接正常（API 返回 {status}，部分模型对简单测试不兼容，不影响实际使用）"
        ));
    }

    let reply = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| extract_llm_content(&v))
        .unwrap_or_else(|| "（模型已响应）".into());

    Ok(reply)
}

/// 将标准 messages 转换为 Gemini API 的 contents 格式
/// role 映射: "assistant" → "model", "user" → "user"
/// system 消息合并到第一条 user 消息前作为前缀
fn convert_messages_to_gemini(messages: &[serde_json::Value]) -> serde_json::Value {
    let mut system_parts: Vec<String> = Vec::new();
    let mut contents: Vec<serde_json::Value> = Vec::new();

    for msg in messages {
        let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("user");
        let content = msg
            .get("content")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();

        if role == "system" {
            system_parts.push(content);
            continue;
        }

        let gemini_role = if role == "assistant" { "model" } else { "user" };
        contents.push(json!({
            "role": gemini_role,
            "parts": [{"text": content}]
        }));
    }

    // system 消息注入到第一条 user 消息
    if !system_parts.is_empty() && !contents.is_empty() {
        let prefix = system_parts.join("\n\n");
        if let Some(first) = contents.first_mut() {
            if let Some(parts) = first.get_mut("parts").and_then(|p| p.as_array_mut()) {
                if let Some(first_part) = parts.first_mut() {
                    if let Some(text) = first_part.get("text").and_then(|t| t.as_str()) {
                        *first_part = json!({"text": format!("{}\n\n{}", prefix, text)});
                    }
                }
            }
        }
    }

    json!(contents)
}

// 社区版:ClawSwarm 直连 LLM 已移除
#[allow(dead_code)]
async fn _swarm_chat_complete_removed(
    messages: Vec<serde_json::Value>,
    model: String,
    api_type: Option<String>,
    api_key: String,
    base_url: String,
    max_tokens: Option<u32>,
) -> Result<serde_json::Value, String> {
    let api_type = normalize_model_api_type(api_type.as_deref().unwrap_or("openai-completions"));
    let base = normalize_base_url_for_api(&base_url, api_type);
    let max_tokens = max_tokens.unwrap_or(4096);

    let client =
        crate::commands::build_http_client_no_proxy(std::time::Duration::from_secs(120), None)
            .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let resp = match api_type {
        "anthropic-messages" => {
            // 分离 system 消息
            let mut system_text = String::new();
            let mut chat_messages: Vec<serde_json::Value> = Vec::new();
            for msg in &messages {
                let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("user");
                if role == "system" {
                    if !system_text.is_empty() {
                        system_text.push_str("\n\n");
                    }
                    system_text.push_str(msg.get("content").and_then(|c| c.as_str()).unwrap_or(""));
                } else {
                    chat_messages.push(msg.clone());
                }
            }

            let url = format!("{}/messages", base);
            let mut body = json!({
                "model": model,
                "messages": chat_messages,
                "max_tokens": max_tokens,
            });
            if !system_text.is_empty() {
                body["system"] = json!(system_text);
            }

            let req = client
                .post(&url)
                .header("anthropic-version", "2023-06-01")
                .json(&body);
            add_anthropic_auth(req, &api_key, &base).send()
        }
        "google-gemini" => {
            let contents = convert_messages_to_gemini(&messages);
            let url = format!("{}/models/{}:generateContent?key={}", base, model, api_key);
            let body = json!({
                "contents": contents,
                "generationConfig": {
                    "maxOutputTokens": max_tokens,
                }
            });
            client.post(&url).json(&body).send()
        }
        _ => {
            // OpenAI 兼容格式（含自定义 provider）
            let url = format!("{}/chat/completions", base);
            let body = json!({
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "stream": false
            });
            let mut req = client.post(&url).json(&body);
            if !api_key.is_empty() {
                req = req.header("Authorization", format!("Bearer {api_key}"));
            }
            req.send()
        }
    }
    .await
    .map_err(|e| {
        if e.is_timeout() {
            "请求超时 (120s)，请检查网络或尝试更短的提示".to_string()
        } else if e.is_connect() {
            format!("连接失败: {e}")
        } else {
            format!("请求失败: {e}")
        }
    })?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        let msg = extract_error_message(&text, status);
        return Err(format!("LLM 请求失败 ({}): {}", status.as_u16(), msg));
    }

    // 解析响应 JSON
    let parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("解析响应失败: {e}"))?;

    let content =
        extract_llm_content(&parsed).ok_or_else(|| "无法从 LLM 响应中提取文本内容".to_string())?;

    let (input_tokens, output_tokens) = extract_llm_usage(&parsed);

    Ok(json!({
        "content": content,
        "usage": {
            "input": input_tokens,
            "output": output_tokens,
        },
        "model": model,
    }))
}

/// 获取服务商的远程模型列表（调用 /models 接口）
#[tauri::command]
pub async fn list_remote_models(
    base_url: String,
    api_key: String,
    api_type: Option<String>,
) -> Result<Vec<String>, String> {
    let api_type = normalize_model_api_type(api_type.as_deref().unwrap_or("openai-completions"));
    let base = normalize_base_url_for_api(&base_url, api_type);

    let client =
        crate::commands::build_http_client_no_proxy(std::time::Duration::from_secs(15), None)
            .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let resp = match api_type {
        "anthropic-messages" => {
            let url = format!("{}/models", base);
            let req = client.get(&url).header("anthropic-version", "2023-06-01");
            add_anthropic_auth(req, &api_key, &base).send()
        }
        "google-gemini" => {
            let url = format!("{}/models?key={}", base, api_key);
            client.get(&url).send()
        }
        _ => {
            let url = format!("{}/models", base);
            let mut req = client.get(&url);
            if !api_key.is_empty() {
                req = req.header("Authorization", format!("Bearer {api_key}"));
            }
            req.send()
        }
    }
    .await
    .map_err(|e| {
        if e.is_timeout() {
            "请求超时 (15s)，该服务商可能不支持模型列表接口".to_string()
        } else if e.is_connect() {
            format!("连接失败，请检查接口地址是否正确: {e}")
        } else {
            format!("请求失败: {e}")
        }
    })?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        let msg = extract_error_message(&text, status);
        return Err(format!("获取模型列表失败: {msg}"));
    }

    // 解析 OpenAI / Anthropic / Gemini 格式的 /models 响应
    let ids = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .map(|v| {
            let mut ids: Vec<String> = if let Some(data) = v.get("data").and_then(|d| d.as_array())
            {
                data.iter()
                    .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(String::from))
                    .collect()
            } else if let Some(data) = v.get("models").and_then(|d| d.as_array()) {
                data.iter()
                    .filter_map(|m| {
                        m.get("name")
                            .and_then(|id| id.as_str())
                            .map(|s| s.trim_start_matches("models/").to_string())
                    })
                    .collect()
            } else {
                vec![]
            };
            ids.sort();
            ids
        })
        .unwrap_or_default();

    if ids.is_empty() {
        return Err("该服务商返回了空的模型列表，可能不支持 /models 接口".to_string());
    }

    Ok(ids)
}

/// 安装 Gateway 服务（执行 openclaw gateway install）
#[tauri::command]
pub async fn install_gateway() -> Result<String, String> {
    use crate::utils::openclaw_command_async;
    let _guardian_pause = GuardianPause::new("install gateway");
    // 先检测 openclaw CLI 是否可用
    let cli_check = openclaw_command_async().arg("--version").output().await;
    match cli_check {
        Ok(o) if o.status.success() => {}
        _ => {
            return Err("openclaw CLI 未安装。请先执行以下命令安装：\n\n\
                 npm install -g @qingchencloud/openclaw-zh\n\n\
                 安装完成后再点击此按钮安装 Gateway 服务。"
                .into());
        }
    }

    let output = openclaw_command_async()
        .args(["gateway", "install"])
        .output()
        .await
        .map_err(|e| format!("安装失败: {e}"))?;

    if output.status.success() {
        Ok("Gateway 服务已安装".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("安装失败: {stderr}"))
    }
}

/// 卸载 Gateway 服务
/// macOS: launchctl bootout + 删除 plist
/// Windows: 直接 taskkill
/// Linux: pkill
#[tauri::command]
pub fn uninstall_gateway() -> Result<String, String> {
    let _guardian_pause = GuardianPause::new("uninstall gateway");
    crate::commands::service::guardian_mark_manual_stop();
    #[cfg(target_os = "macos")]
    {
        let uid = get_uid()?;
        let target = format!("gui/{uid}/ai.openclaw.gateway");

        // 先停止服务
        let _ = Command::new("launchctl")
            .args(["bootout", &target])
            .output();

        // 删除 plist 文件
        let home = dirs::home_dir().unwrap_or_default();
        let plist = home.join("Library/LaunchAgents/ai.openclaw.gateway.plist");
        if plist.exists() {
            fs::remove_file(&plist).map_err(|e| format!("删除 plist 失败: {e}"))?;
        }
    }
    #[cfg(target_os = "windows")]
    {
        // 直接杀死 gateway 相关的 node.exe 进程，不走慢 CLI
        let _ = Command::new("taskkill")
            .args(["/f", "/im", "node.exe", "/fi", "WINDOWTITLE eq openclaw*"])
            .creation_flags(0x08000000)
            .output();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("pkill")
            .args(["-f", "openclaw.*gateway"])
            .output();
    }
    Ok("Gateway 服务已卸载".to_string())
}

/// 为 openclaw.json 中所有模型添加 input: ["text", "image"]，使 Gateway 识别模型支持图片输入
#[tauri::command]
pub fn patch_model_vision() -> Result<bool, String> {
    let path = super::openclaw_dir().join("openclaw.json");
    let content = fs::read_to_string(&path).map_err(|e| format!("读取配置失败: {e}"))?;
    let mut config: Value =
        serde_json::from_str(&content).map_err(|e| format!("解析 JSON 失败: {e}"))?;

    let vision_input = Value::Array(vec![
        Value::String("text".into()),
        Value::String("image".into()),
    ]);

    let mut changed = false;

    if let Some(obj) = config.as_object_mut() {
        if let Some(models_val) = obj.get_mut("models") {
            if let Some(models_obj) = models_val.as_object_mut() {
                if let Some(providers_val) = models_obj.get_mut("providers") {
                    if let Some(providers_obj) = providers_val.as_object_mut() {
                        for (_provider_name, provider_val) in providers_obj.iter_mut() {
                            if let Some(provider_obj) = provider_val.as_object_mut() {
                                if let Some(Value::Array(arr)) = provider_obj.get_mut("models") {
                                    for model in arr.iter_mut() {
                                        if let Some(mobj) = model.as_object_mut() {
                                            if !mobj.contains_key("input") {
                                                mobj.insert("input".into(), vision_input.clone());
                                                changed = true;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if changed {
        let bak = super::openclaw_dir().join("openclaw.json.bak");
        let _ = fs::copy(&path, &bak);
        let json = serde_json::to_string_pretty(&config).map_err(|e| format!("序列化失败: {e}"))?;
        fs::write(&path, json).map_err(|e| format!("写入失败: {e}"))?;
    }

    Ok(changed)
}

/// 检查 Privix 自身是否有新版本（GitHub → Gitee 自动降级）
#[tauri::command]
pub async fn check_panel_update() -> Result<Value, String> {
    let client =
        crate::commands::build_http_client(std::time::Duration::from_secs(8), Some("Privix"))
            .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    // 优先从当前仓库检查发布版本
    let sources = [(
        "https://api.github.com/repos/Hxitech/ProspectClaw/releases/latest",
        "https://github.com/Hxitech/ProspectClaw/releases",
        "github",
    )];

    let mut last_err = String::new();
    for (api_url, releases_url, source) in &sources {
        match client.get(*api_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                let json: Value = resp
                    .json()
                    .await
                    .map_err(|e| format!("解析响应失败: {e}"))?;

                let tag = json
                    .get("tag_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim_start_matches('v')
                    .to_string();

                if tag.is_empty() {
                    last_err = format!("{source}: 未找到版本号");
                    continue;
                }

                let mut result = serde_json::Map::new();
                result.insert("latest".into(), Value::String(tag));
                result.insert(
                    "url".into(),
                    json.get("html_url")
                        .cloned()
                        .unwrap_or(Value::String(releases_url.to_string())),
                );
                result.insert("source".into(), Value::String(source.to_string()));
                result.insert(
                    "downloadUrl".into(),
                    Value::String("https://www.privix.cn".into()),
                );
                return Ok(Value::Object(result));
            }
            Ok(resp) => {
                last_err = format!("{source}: HTTP {}", resp.status());
            }
            Err(e) => {
                last_err = format!("{source}: {e}");
            }
        }
    }

    Err(last_err)
}

// === 面板配置 (clawpanel.json) ===

#[tauri::command]
pub fn read_panel_config() -> Result<Value, String> {
    let path = super::panel_config_path();
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("读取失败: {e}"))?;
    let value = serde_json::from_str(&content).map_err(|e| format!("解析失败: {e}"))?;
    Ok(crate::commands::normalize_panel_config_for_command(value))
}

#[tauri::command]
pub fn write_panel_config(config: Value) -> Result<(), String> {
    let path = super::panel_config_path();
    let dir = path
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(super::panel_runtime_dir);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let normalized = crate::commands::normalize_panel_config_for_command(config);
    let json = serde_json::to_string_pretty(&normalized).map_err(|e| format!("序列化失败: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("写入失败: {e}"))?;
    // 面板配置变更可能影响 openclawDir → 清除缓存
    super::invalidate_openclaw_dir_cache();
    Ok(())
}

// ─── ClawSwarm 会话持久化 ────────────────────────────────

#[tauri::command]
pub fn read_swarm_sessions() -> Result<Value, String> {
    let path = super::panel_runtime_dir().join("swarm-sessions.json");
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("读取失败: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("解析失败: {e}"))
}

#[tauri::command]
pub fn write_swarm_sessions(data: Value) -> Result<(), String> {
    let dir = super::panel_runtime_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let path = dir.join("swarm-sessions.json");
    // 写入前备份
    if path.exists() {
        let bak = dir.join("swarm-sessions.json.bak");
        let _ = fs::copy(&path, &bak);
    }
    let json = serde_json::to_string_pretty(&data).map_err(|e| format!("序列化失败: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("写入失败: {e}"))
}

#[tauri::command]
pub fn get_openclaw_dir() -> Result<Value, String> {
    let default_dir = dirs::home_dir().unwrap_or_default().join(".openclaw");
    let custom = super::read_panel_config_value().and_then(|v| {
        v.get("openclawDir")
            .and_then(|value| value.as_str())
            .map(str::to_string)
    });
    let resolved = super::openclaw_dir();
    let is_custom = custom.is_some();
    Ok(json!({
        "path": resolved.clone(),
        "resolved": resolved,
        "default": default_dir,
        "custom": custom,
        "isCustom": is_custom
    }))
}

/// 运行 openclaw doctor --fix 自动修复配置问题
#[tauri::command]
pub async fn doctor_fix() -> Result<Value, String> {
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        crate::utils::openclaw_command_async()
            .args(["doctor", "--fix"])
            .output(),
    )
    .await;

    match result {
        Ok(Ok(o)) => {
            let stdout = String::from_utf8_lossy(&o.stdout).to_string();
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            Ok(json!({
                "success": o.status.success(),
                "output": stdout.trim(),
                "errors": stderr.trim(),
                "exitCode": o.status.code(),
            }))
        }
        Ok(Err(e)) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                Err("OpenClaw CLI 未找到，请先安装".to_string())
            } else {
                Err(format!("执行 doctor 失败: {e}"))
            }
        }
        Err(_) => Err("doctor --fix 执行超时 (30s)".to_string()),
    }
}

/// 运行 openclaw doctor（仅诊断，不修复）
#[tauri::command]
pub async fn doctor_check() -> Result<Value, String> {
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        crate::utils::openclaw_command_async()
            .args(["doctor"])
            .output(),
    )
    .await;

    match result {
        Ok(Ok(o)) => {
            let stdout = String::from_utf8_lossy(&o.stdout).to_string();
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            Ok(json!({
                "success": o.status.success(),
                "output": stdout.trim(),
                "errors": stderr.trim(),
                "exitCode": o.status.code(),
            }))
        }
        Ok(Err(e)) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                Err("OpenClaw CLI 未找到，请先安装".to_string())
            } else {
                Err(format!("执行 doctor 失败: {e}"))
            }
        }
        Err(_) => Err("doctor 执行超时 (30s)".to_string()),
    }
}

/// 测试代理连通性：通过配置的代理访问指定 URL，返回状态码和耗时
#[tauri::command]
pub async fn test_proxy(url: Option<String>) -> Result<Value, String> {
    let proxy_url = crate::commands::configured_proxy_url()
        .ok_or("未配置代理地址，请先在面板设置中保存代理地址")?;

    let target = url.unwrap_or_else(|| "https://registry.npmjs.org/-/ping".to_string());

    let client =
        crate::commands::build_http_client(std::time::Duration::from_secs(10), Some("Privix"))
            .map_err(|e| format!("创建代理客户端失败: {e}"))?;

    let start = std::time::Instant::now();
    let resp = client.get(&target).send().await.map_err(|e| {
        let elapsed = start.elapsed().as_millis();
        format!("代理连接失败 ({elapsed}ms): {e}")
    })?;

    let elapsed = start.elapsed().as_millis();
    let status = resp.status().as_u16();

    Ok(json!({
        "ok": status < 500,
        "status": status,
        "elapsed_ms": elapsed,
        "proxy": proxy_url,
        "target": target,
    }))
}

#[tauri::command]
pub fn get_npm_registry() -> Result<String, String> {
    Ok(get_configured_registry())
}

#[tauri::command]
pub fn set_npm_registry(registry: String) -> Result<(), String> {
    let path = super::openclaw_dir().join("npm-registry.txt");
    fs::write(&path, registry.trim()).map_err(|e| format!("保存失败: {e}"))
}

/// 检测 Git 是否已安装
#[tauri::command]
pub fn check_git() -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    let configured = configured_git_path();
    let git = configured.clone().unwrap_or_else(|| "git".into());
    let is_custom = configured.is_some();
    let mut cmd = Command::new(&git);
    cmd.arg("--version");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    match cmd.output() {
        Ok(o) if o.status.success() => {
            let ver = String::from_utf8_lossy(&o.stdout).trim().to_string();
            result.insert("installed".into(), Value::Bool(true));
            result.insert("version".into(), Value::String(ver));
            let git_path = if is_custom {
                git.clone()
            } else {
                find_git_path()
            };
            result.insert("gitPath".into(), Value::String(git_path));
            result.insert("isCustom".into(), Value::Bool(is_custom));
        }
        _ => {
            result.insert("installed".into(), Value::Bool(false));
            result.insert("version".into(), Value::Null);
            result.insert("isCustom".into(), Value::Bool(is_custom));
        }
    }
    Ok(Value::Object(result))
}

/// 扫描常见路径，返回所有找到的 Git 安装
#[tauri::command]
pub fn scan_git_paths() -> Result<Value, String> {
    let mut found: Vec<Value> = vec![];
    let mut candidates: Vec<(String, String)> = vec![]; // (path, source)

    #[cfg(target_os = "windows")]
    {
        let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
        let pf86 =
            std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".into());
        let localappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
        candidates.push((format!(r"{}\Git\cmd\git.exe", pf), "SYSTEM".into()));
        candidates.push((format!(r"{}\Git\cmd\git.exe", pf86), "SYSTEM".into()));
        for drive in &["C", "D", "E", "F", "G"] {
            candidates.push((format!(r"{}:\Git\cmd\git.exe", drive), "MANUAL".into()));
            candidates.push((
                format!(r"{}:\Program Files\Git\cmd\git.exe", drive),
                "SYSTEM".into(),
            ));
            for sub in &["Tools", "Dev", "AI", "Apps", "Software"] {
                candidates.push((
                    format!(r"{}:\{}\Git\cmd\git.exe", drive, sub),
                    "MANUAL".into(),
                ));
            }
        }
        for drive in &["C", "D", "E", "F"] {
            candidates.push((
                format!(r"{}:\Data\exeApp\Git\cmd\git.exe", drive),
                "MANUAL".into(),
            ));
        }
        if !localappdata.is_empty() {
            let gh_dir = std::path::Path::new(&localappdata).join("GitHubDesktop");
            if gh_dir.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&gh_dir) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.is_dir() {
                            let git_exe = p
                                .join("resources")
                                .join("app")
                                .join("git")
                                .join("cmd")
                                .join("git.exe");
                            if git_exe.exists() {
                                candidates.push((
                                    git_exe.to_string_lossy().to_string(),
                                    "GITHUB_DESKTOP".into(),
                                ));
                            }
                        }
                    }
                }
            }
        }
        if !localappdata.is_empty() {
            let vscode_git = std::path::Path::new(&localappdata).join(r"Programs\Microsoft VS Code\resources\app\node_modules.asar.unpacked\vscode-git\git\cmd\git.exe");
            if vscode_git.exists() {
                candidates.push((vscode_git.to_string_lossy().to_string(), "VSCODE".into()));
            }
        }
        candidates.push((format!(r"{}\Git\mingw64\bin\git.exe", pf), "MINGW".into()));
        for drive in &["C", "D"] {
            candidates.push((
                format!(r"{}:\msys64\usr\bin\git.exe", drive),
                "MSYS2".into(),
            ));
            candidates.push((format!(r"{}:\msys2\usr\bin\git.exe", drive), "MSYS2".into()));
        }
        let home = dirs::home_dir().unwrap_or_default();
        candidates.push((
            format!(r"{}\scoop\apps\git\current\cmd\git.exe", home.display()),
            "SCOOP".into(),
        ));
        candidates.push((
            format!(r"{}\scoop\shims\git.exe", home.display()),
            "SCOOP".into(),
        ));
        let choco_dir = std::env::var("ChocolateyInstall")
            .unwrap_or_else(|_| r"C:\ProgramData\chocolatey".into());
        candidates.push((format!(r"{}\bin\git.exe", choco_dir), "CHOCOLATEY".into()));
    }

    #[cfg(not(target_os = "windows"))]
    {
        candidates.push(("/usr/bin/git".into(), "SYSTEM".into()));
        candidates.push(("/usr/local/bin/git".into(), "SYSTEM".into()));
        candidates.push(("/opt/homebrew/bin/git".into(), "BREW".into()));
        candidates.push((
            "/Library/Developer/CommandLineTools/usr/bin/git".into(),
            "XCODE_CLT".into(),
        ));
        candidates.push((
            "/Applications/Xcode.app/Contents/Developer/usr/bin/git".into(),
            "XCODE".into(),
        ));
        candidates.push(("/snap/bin/git".into(), "SNAP".into()));
        let home = dirs::home_dir().unwrap_or_default();
        candidates.push((
            format!("{}/.nix-profile/bin/git", home.display()),
            "NIX".into(),
        ));
        candidates.push((
            format!("{}/.linuxbrew/bin/git", home.display()),
            "BREW".into(),
        ));
        candidates.push(("/home/linuxbrew/.linuxbrew/bin/git".into(), "BREW".into()));
    }

    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (path, source) in &candidates {
        let p = std::path::Path::new(path);
        if !p.exists() {
            continue;
        }
        let canonical = p.to_string_lossy().to_string();
        if seen.contains(&canonical) {
            continue;
        }
        seen.insert(canonical.clone());
        let mut cmd = Command::new(path);
        cmd.arg("--version");
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        if let Ok(o) = cmd.output() {
            if o.status.success() {
                let ver = String::from_utf8_lossy(&o.stdout).trim().to_string();
                let mut entry = serde_json::Map::new();
                entry.insert("path".into(), Value::String(canonical));
                entry.insert("version".into(), Value::String(ver));
                entry.insert("source".into(), Value::String(source.clone()));
                found.push(Value::Object(entry));
            }
        }
    }

    Ok(Value::Array(found))
}

/// 尝试自动安装 Git（Windows: winget; macOS: xcode-select; Linux: apt/yum）
#[tauri::command]
pub async fn auto_install_git(app: tauri::AppHandle) -> Result<String, String> {
    use std::process::Stdio;
    use tauri::Emitter;

    let _ = app.emit("upgrade-log", "正在尝试自动安装 Git...");

    #[cfg(target_os = "windows")]
    {
        use std::io::{BufRead, BufReader};
        // 尝试 winget
        let _ = app.emit("upgrade-log", "尝试使用 winget 安装 Git...");
        let mut child = Command::new("winget")
            .args([
                "install",
                "--id",
                "Git.Git",
                "-e",
                "--source",
                "winget",
                "--accept-package-agreements",
                "--accept-source-agreements",
            ])
            .creation_flags(0x08000000)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("winget 不可用，请手动安装 Git: {e}"))?;

        let stderr = child.stderr.take();
        let stdout = child.stdout.take();
        let app2 = app.clone();
        let handle = std::thread::spawn(move || {
            if let Some(pipe) = stderr {
                for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                    let _ = app2.emit("upgrade-log", &line);
                }
            }
        });
        if let Some(pipe) = stdout {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let _ = app.emit("upgrade-log", &line);
            }
        }
        let _ = handle.join();
        let status = child
            .wait()
            .map_err(|e| format!("等待 winget 完成失败: {e}"))?;
        if status.success() {
            let _ = app.emit("upgrade-log", "Git 安装成功！");
            return Ok("Git 已通过 winget 安装".to_string());
        }
        Err("winget 安装 Git 失败，请手动下载安装: https://git-scm.com/downloads".to_string())
    }

    #[cfg(target_os = "macos")]
    {
        let _ = app.emit("upgrade-log", "尝试通过 xcode-select 安装 Git...");
        let mut child = Command::new("xcode-select")
            .arg("--install")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("xcode-select 不可用: {e}"))?;
        let status = child.wait().map_err(|e| format!("等待安装完成失败: {e}"))?;
        if status.success() {
            let _ = app.emit("upgrade-log", "Git 安装已触发，请在弹出的窗口中确认安装。");
            return Ok("已触发 xcode-select 安装，请在弹窗中确认".to_string());
        }
        Err(
            "xcode-select 安装失败，请手动安装 Xcode Command Line Tools 或 brew install git"
                .to_string(),
        )
    }

    #[cfg(target_os = "linux")]
    {
        use std::io::{BufRead, BufReader};
        // 检测包管理器
        let pkg_mgr = if Command::new("apt-get")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            "apt"
        } else if Command::new("yum")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            "yum"
        } else if Command::new("dnf")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            "dnf"
        } else if Command::new("pacman")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            "pacman"
        } else {
            return Err(
                "未找到包管理器，请手动安装 Git: sudo apt install git 或 sudo yum install git"
                    .to_string(),
            );
        };

        let (cmd_name, args): (&str, Vec<&str>) = match pkg_mgr {
            "apt" => ("sudo", vec!["apt-get", "install", "-y", "git"]),
            "yum" => ("sudo", vec!["yum", "install", "-y", "git"]),
            "dnf" => ("sudo", vec!["dnf", "install", "-y", "git"]),
            "pacman" => ("sudo", vec!["pacman", "-S", "--noconfirm", "git"]),
            _ => return Err("不支持的包管理器".to_string()),
        };

        let _ = app.emit(
            "upgrade-log",
            format!("执行: {} {}", cmd_name, args.join(" ")),
        );
        let mut child = Command::new(cmd_name)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("安装命令执行失败: {e}"))?;

        let stderr = child.stderr.take();
        let stdout = child.stdout.take();
        let app2 = app.clone();
        let handle = std::thread::spawn(move || {
            if let Some(pipe) = stderr {
                for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                    let _ = app2.emit("upgrade-log", &line);
                }
            }
        });
        if let Some(pipe) = stdout {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let _ = app.emit("upgrade-log", &line);
            }
        }
        let _ = handle.join();
        let status = child.wait().map_err(|e| format!("等待安装完成失败: {e}"))?;
        if status.success() {
            let _ = app.emit("upgrade-log", "Git 安装成功！");
            return Ok("Git 已安装".to_string());
        }
        Err("Git 安装失败，请手动执行: sudo apt install git".to_string())
    }
}

/// 配置 Git 使用 HTTPS 替代 SSH，解决国内用户 SSH 不通的问题
#[tauri::command]
pub fn configure_git_https() -> Result<String, String> {
    let success = configure_git_https_rules();
    if success > 0 {
        Ok(format!(
            "已配置 Git 使用 HTTPS（{success}/{} 条规则）",
            GIT_HTTPS_REWRITES.len()
        ))
    } else {
        Err("Git 未安装或配置失败".to_string())
    }
}

/// 刷新 enhanced_path 缓存，使新设置的 Node.js 路径立即生效
#[tauri::command]
pub fn invalidate_path_cache() -> Result<(), String> {
    super::refresh_enhanced_path();
    crate::commands::service::invalidate_cli_detection_cache();
    Ok(())
}
