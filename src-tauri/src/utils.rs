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

/// Windows: 在 PATH 中查找 openclaw.cmd 的完整路径
/// 避免通过 `cmd /c openclaw` 调用时 npm .cmd shim 中的引号导致
/// "\"node\"" is not recognized 错误
#[cfg(target_os = "windows")]
fn find_openclaw_cmd() -> Option<std::path::PathBuf> {
    // 优先使用用户绑定的路径
    if let Some(bound) = bound_cli_path() {
        return Some(bound);
    }
    let path = crate::commands::enhanced_path();
    for dir in path.split(';') {
        let candidate = std::path::Path::new(dir).join("openclaw.cmd");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
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
        // 优先：找到 openclaw.cmd 完整路径，用 cmd /c "完整路径" 避免引号问题
        if let Some(cmd_path) = find_openclaw_cmd() {
            let mut cmd = std::process::Command::new("cmd");
            cmd.arg("/c").arg(cmd_path);
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
        // 优先：找到 openclaw.cmd 完整路径
        if let Some(cmd_path) = find_openclaw_cmd() {
            let mut cmd = tokio::process::Command::new("cmd");
            cmd.arg("/c").arg(cmd_path);
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
