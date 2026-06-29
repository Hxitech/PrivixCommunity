#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// 排除非 OpenClaw CLI 路径（如 CherryStudio 内置的同名命令）
pub fn is_rejected_cli_path(cli_path: &str) -> bool {
    let lower = cli_path.replace('\\', "/").to_lowercase();
    lower.contains("/.cherrystudio/") || lower.contains("cherry-studio")
}

/// 读取 clawpanel.json 中用户绑定的 CLI 路径
fn bound_cli_path() -> Option<std::path::PathBuf> {
    let config = crate::commands::read_panel_config_value()?;
    let raw = config.get("openclawCliPath")?.as_str()?;
    if raw.is_empty() {
        return None;
    }
    let p = std::path::PathBuf::from(raw);
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

/// Windows: 候选路径去重(按规范化小写路径)。
#[cfg(target_os = "windows")]
fn push_unique_candidate(
    candidates: &mut Vec<std::path::PathBuf>,
    seen: &mut std::collections::HashSet<String>,
    path: std::path::PathBuf,
) {
    let key = path.to_string_lossy().replace('/', "\\").to_lowercase();
    if seen.insert(key) {
        candidates.push(path);
    }
}

/// Windows OpenClaw CLI 的 5 种入口相对路径:旧 npm shim(openclaw.cmd)、新安装器
/// (openclaw.exe / 无后缀 openclaw)、node_modules 直装出 bin/openclaw.js(需 node 调用)。
/// 同步上游 v0.16.5(invest e748b72/d2cf86e):新内核安装器不再只出 .cmd shim,
/// 之前只查 openclaw.cmd 会导致"装了新版但面板找不到 CLI / 版本切换失效"。
#[cfg(target_os = "windows")]
pub(crate) fn windows_openclaw_entry_relpaths() -> [std::path::PathBuf; 5] {
    [
        std::path::PathBuf::from("openclaw.cmd"),
        std::path::PathBuf::from("openclaw.exe"),
        std::path::PathBuf::from("openclaw"),
        [
            "node_modules",
            "@qingchencloud",
            "openclaw-zh",
            "bin",
            "openclaw.js",
        ]
        .iter()
        .collect(),
        ["node_modules", "openclaw", "bin", "openclaw.js"]
            .iter()
            .collect(),
    ]
}

/// Windows: 给一个 base 目录补全所有可能的 OpenClaw CLI 入口文件(去重)。
#[cfg(target_os = "windows")]
fn push_windows_cli_files(
    candidates: &mut Vec<std::path::PathBuf>,
    seen: &mut std::collections::HashSet<String>,
    base: std::path::PathBuf,
) {
    for rel in windows_openclaw_entry_relpaths() {
        push_unique_candidate(candidates, seen, base.join(rel));
    }
}

/// Windows: 枚举所有候选目录下的 OpenClaw CLI 入口(按 enhanced PATH 优先级,
/// 再 APPDATA\npm、npm global prefix、standalone 目录、LOCALAPPDATA)。
#[cfg(target_os = "windows")]
fn common_windows_cli_candidates() -> Vec<std::path::PathBuf> {
    let mut candidates = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for dir in crate::commands::enhanced_path().split(';') {
        let dir = dir.trim();
        if !dir.is_empty() {
            push_windows_cli_files(&mut candidates, &mut seen, std::path::PathBuf::from(dir));
        }
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        push_windows_cli_files(
            &mut candidates,
            &mut seen,
            std::path::PathBuf::from(appdata).join("npm"),
        );
    }
    if let Some(prefix) = crate::commands::windows_npm_global_prefix() {
        push_windows_cli_files(&mut candidates, &mut seen, std::path::PathBuf::from(prefix));
    }
    for sa_dir in crate::commands::config::all_standalone_dirs() {
        push_windows_cli_files(&mut candidates, &mut seen, sa_dir);
    }
    if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
        let localappdata = std::path::PathBuf::from(localappdata);
        push_windows_cli_files(
            &mut candidates,
            &mut seen,
            localappdata.join("Programs").join("OpenClaw"),
        );
        push_windows_cli_files(&mut candidates, &mut seen, localappdata.join("OpenClaw"));
    }
    candidates
}

/// 解析后的 CLI 路径缓存(Windows)。`find_openclaw_cmd` 在网关状态轮询(15s)及
/// 每次 openclaw_command* 调用链上都会跑,而 `common_windows_cli_candidates` 每次会
/// spawn `npm config get prefix` 进程 + 数十次文件系统 stat。用 60s TTL 缓存解析结果,
/// 与 mod.rs 的 ENHANCED_PATH_CACHE 一致。用户绑定路径(bound_cli_path)在缓存之前判定,
/// 改绑即时生效;node 路径变更经 invalidate_openclaw_cli_cache() 主动失效。
#[cfg(target_os = "windows")]
static RESOLVED_CLI_CACHE: std::sync::Mutex<
    Option<(Option<std::path::PathBuf>, std::time::Instant)>,
> = std::sync::Mutex::new(None);

/// 清空 Windows CLI 路径缓存(node 路径 / CLI 绑定变更后调用)。
pub fn invalidate_openclaw_cli_cache() {
    #[cfg(target_os = "windows")]
    if let Ok(mut guard) = RESOLVED_CLI_CACHE.lock() {
        *guard = None;
    }
}

/// Windows: 查找 OpenClaw CLI 入口的完整路径
/// 避免通过 `cmd /c openclaw` 调用时 npm .cmd shim 中的引号导致
/// "\"node\"" is not recognized 错误
#[cfg(target_os = "windows")]
fn find_openclaw_cmd() -> Option<std::path::PathBuf> {
    // 优先使用用户绑定的路径(便宜 + 改绑即时生效,不进缓存)
    if let Some(bound) = bound_cli_path() {
        return Some(bound);
    }
    const TTL: std::time::Duration = std::time::Duration::from_secs(60);
    if let Ok(guard) = RESOLVED_CLI_CACHE.lock() {
        if let Some((ref cached, ts)) = *guard {
            if ts.elapsed() < TTL {
                return cached.clone();
            }
        }
    }
    let resolved = common_windows_cli_candidates()
        .into_iter()
        .find(|candidate| candidate.exists() && !is_rejected_cli_path(&candidate.to_string_lossy()));
    if let Ok(mut guard) = RESOLVED_CLI_CACHE.lock() {
        *guard = Some((resolved.clone(), std::time::Instant::now()));
    }
    resolved
}

/// Windows: 给 cmd 设置正确的 OpenClaw 调用方式 —— .js 入口需走 `node <path>`,
/// 其它(.cmd/.exe/无后缀)直接 `cmd /c <path>`。
#[cfg(target_os = "windows")]
fn apply_windows_openclaw_invocation(
    cmd: &mut std::process::Command,
    cli_path: &std::path::Path,
) {
    if cli_path
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("js"))
    {
        cmd.arg("/c").arg("node").arg(cli_path);
    } else {
        cmd.arg("/c").arg(cli_path);
    }
}

#[cfg(target_os = "windows")]
fn apply_windows_openclaw_invocation_tokio(
    cmd: &mut tokio::process::Command,
    cli_path: &std::path::Path,
) {
    if cli_path
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("js"))
    {
        cmd.arg("/c").arg("node").arg(cli_path);
    } else {
        cmd.arg("/c").arg(cli_path);
    }
}

/// 解析当前实际使用的 openclaw CLI 完整路径（跨平台）
pub fn resolve_openclaw_cli_path() -> Option<String> {
    // 优先使用用户绑定的路径
    if let Some(bound) = bound_cli_path() {
        return Some(bound.to_string_lossy().to_string());
    }
    #[cfg(target_os = "windows")]
    {
        // find_openclaw_cmd already checks bound_cli_path + enhanced_path
        find_openclaw_cmd().map(|p| p.to_string_lossy().to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        // enhanced_path() already includes standalone dirs, ~/.local/bin, /opt/homebrew/bin, etc.
        let path = crate::commands::enhanced_path();
        for dir in path.split(':') {
            let candidate = std::path::Path::new(dir).join("openclaw");
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        None
    }
}

/// 根据 CLI 路径判断安装来源
pub fn classify_cli_source(cli_path: &str) -> String {
    let lower = cli_path.replace('\\', "/").to_lowercase();
    // standalone 安装
    if lower.contains("/programs/openclaw/")
        || lower.contains("/openclaw-bin/")
        || lower.contains("/opt/openclaw/")
    {
        return "standalone".into();
    }
    // npm 汉化版
    if lower.contains("openclaw-zh") || lower.contains("@qingchencloud") {
        return "npm-zh".into();
    }
    // npm 全局（大概率官方版）
    if lower.contains("/npm/") || lower.contains("/node_modules/") {
        return "npm-official".into();
    }
    // Homebrew
    if lower.contains("/homebrew/") || lower.contains("/usr/local/bin") {
        return "npm-global".into();
    }
    "unknown".into()
}

/// 跨平台获取 openclaw 命令的方法（同步版本）
#[allow(dead_code)]
pub fn openclaw_command() -> std::process::Command {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let enhanced = crate::commands::enhanced_path();
        // 优先：找到 CLI 完整路径，用 cmd /c "完整路径" 避免引号问题(.js 入口走 node)
        if let Some(cmd_path) = find_openclaw_cmd() {
            let mut cmd = std::process::Command::new("cmd");
            apply_windows_openclaw_invocation(&mut cmd, &cmd_path);
            cmd.env("PATH", &enhanced);
            crate::commands::apply_proxy_env(&mut cmd);
            cmd.creation_flags(CREATE_NO_WINDOW);
            return cmd;
        }
        // 兜底：直接用 cmd /c openclaw
        let mut cmd = std::process::Command::new("cmd");
        cmd.arg("/c").arg("openclaw");
        cmd.env("PATH", &enhanced);
        crate::commands::apply_proxy_env(&mut cmd);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = std::process::Command::new("openclaw");
        cmd.env("PATH", crate::commands::enhanced_path());
        crate::commands::apply_proxy_env(&mut cmd);
        cmd
    }
}

/// 异步版本的 openclaw 命令（推荐使用，避免阻塞 UI）
pub fn openclaw_command_async() -> tokio::process::Command {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let enhanced = crate::commands::enhanced_path();
        // 优先：找到 CLI 完整路径(.js 入口走 node)
        if let Some(cmd_path) = find_openclaw_cmd() {
            let mut cmd = tokio::process::Command::new("cmd");
            apply_windows_openclaw_invocation_tokio(&mut cmd, &cmd_path);
            cmd.env("PATH", &enhanced);
            crate::commands::apply_proxy_env_tokio(&mut cmd);
            cmd.creation_flags(CREATE_NO_WINDOW);
            return cmd;
        }
        // 兜底
        let mut cmd = tokio::process::Command::new("cmd");
        cmd.arg("/c").arg("openclaw");
        cmd.env("PATH", &enhanced);
        crate::commands::apply_proxy_env_tokio(&mut cmd);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = tokio::process::Command::new("openclaw");
        cmd.env("PATH", crate::commands::enhanced_path());
        crate::commands::apply_proxy_env_tokio(&mut cmd);
        cmd
    }
}
