//! CLI Agent 自动检测
//!
//! 扫描本机是否安装了常见的 AI Agent CLI 工具,
//! 用于 Privix 的 "Agent Studio" 统一入口页。
//!
//! 检测流程:
//!   1. 在增强 PATH (enhanced_path) 中查找已知二进制文件
//!   2. 对每个找到的二进制,使用 `<bin> --version` 获取版本(3s 超时)
//!   3. 返回结构化检测结果,未安装的附带官网/安装指引链接
//!
//! 支持的 CLI Agent: Claude Code、OpenAI Codex、Gemini CLI、Qwen Code、
//! Goose、OpenClaw、iFlow、Kimi CLI、OpenCode、Factory Droid、Qoder、CodeBuddy

use serde::Serialize;
use std::path::{Path, PathBuf};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 已知 Agent 元数据
struct KnownAgent {
    /// 内部 ID(小写,用于 key)
    id: &'static str,
    /// 展示名
    label: &'static str,
    /// 可执行文件候选(按优先级尝试,首个找到即停止)
    binaries: &'static [&'static str],
    /// 获取版本使用的参数
    version_args: &'static [&'static str],
    /// 一句话描述
    description: &'static str,
    /// 官网 / 文档首页
    homepage: &'static str,
    /// 安装指引 URL
    install_url: &'static str,
}

const KNOWN_AGENTS: &[KnownAgent] = &[
    KnownAgent {
        id: "claude",
        label: "Claude Code",
        binaries: &["claude"],
        version_args: &["--version"],
        description: "Anthropic 官方 CLI,Claude 4.5/4.6 驱动",
        homepage: "https://claude.com/claude-code",
        install_url: "https://docs.claude.com/en/docs/claude-code/quickstart",
    },
    KnownAgent {
        id: "codex",
        label: "OpenAI Codex",
        binaries: &["codex"],
        version_args: &["--version"],
        description: "OpenAI 开源 CLI Agent",
        homepage: "https://developers.openai.com/codex/cli",
        install_url: "https://github.com/openai/codex",
    },
    KnownAgent {
        id: "gemini",
        label: "Gemini CLI",
        binaries: &["gemini"],
        version_args: &["--version"],
        description: "Google 官方 Gemini CLI Agent",
        homepage: "https://github.com/google-gemini/gemini-cli",
        install_url: "https://github.com/google-gemini/gemini-cli",
    },
    KnownAgent {
        id: "qwen",
        label: "Qwen Code",
        binaries: &["qwen"],
        version_args: &["--version"],
        description: "阿里通义千问 CLI Agent",
        homepage: "https://github.com/QwenLM/qwen-code",
        install_url: "https://github.com/QwenLM/qwen-code",
    },
    KnownAgent {
        id: "goose",
        label: "Goose",
        binaries: &["goose"],
        version_args: &["--version"],
        description: "Block 开源 AI Agent 框架",
        homepage: "https://block.github.io/goose/",
        install_url: "https://block.github.io/goose/docs/getting-started/installation",
    },
    KnownAgent {
        id: "openclaw",
        label: "OpenClaw",
        binaries: &["openclaw"],
        version_args: &["--version"],
        description: "OpenClaw 多 Agent 编排引擎(Privix 内置)",
        homepage: "https://www.openclaw.ai",
        install_url: "https://www.openclaw.ai",
    },
    KnownAgent {
        id: "iflow",
        label: "iFlow CLI",
        binaries: &["iflow"],
        version_args: &["--version"],
        description: "心流 AI CLI Agent",
        homepage: "https://iflow.cn",
        install_url: "https://iflow.cn",
    },
    KnownAgent {
        id: "kimi",
        label: "Kimi CLI",
        binaries: &["kimi"],
        version_args: &["--version"],
        description: "Moonshot Kimi for Coding CLI",
        homepage: "https://www.kimi.com/code",
        install_url: "https://www.kimi.com/code",
    },
    KnownAgent {
        id: "opencode",
        label: "OpenCode",
        binaries: &["opencode"],
        version_args: &["--version"],
        description: "SST 开源 Terminal AI Coder",
        homepage: "https://opencode.ai",
        install_url: "https://opencode.ai/docs",
    },
    KnownAgent {
        id: "droid",
        label: "Factory Droid",
        binaries: &["droid"],
        version_args: &["--version"],
        description: "Factory 企业级 Droid CLI",
        homepage: "https://www.factory.ai",
        install_url: "https://docs.factory.ai",
    },
    KnownAgent {
        id: "qoder",
        label: "Qoder CLI",
        binaries: &["qoder"],
        version_args: &["--version"],
        description: "Qoder 代码助手 CLI",
        homepage: "https://qoder.com",
        install_url: "https://qoder.com",
    },
    KnownAgent {
        id: "codebuddy",
        label: "CodeBuddy",
        binaries: &["codebuddy"],
        version_args: &["--version"],
        description: "腾讯 CodeBuddy AI 助手",
        homepage: "https://copilot.tencent.com",
        install_url: "https://copilot.tencent.com",
    },
];

/// 单个 Agent 的检测结果
#[derive(Serialize)]
pub struct AgentDetection {
    pub id: String,
    pub label: String,
    pub description: String,
    pub homepage: String,
    #[serde(rename = "installUrl")]
    pub install_url: String,
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub binary: String,
}

/// 在 enhanced_path 中查找二进制文件的完整路径
fn find_in_path(binary: &str) -> Option<PathBuf> {
    let enhanced = super::enhanced_path();
    let extensions: &[&str] = if cfg!(target_os = "windows") {
        &["", ".exe", ".cmd", ".bat"]
    } else {
        &[""]
    };

    let separator = if cfg!(target_os = "windows") {
        ';'
    } else {
        ':'
    };

    for dir_str in enhanced.split(separator) {
        let trimmed = dir_str.trim();
        if trimmed.is_empty() {
            continue;
        }
        let dir = Path::new(trimmed);
        if !dir.is_dir() {
            continue;
        }
        for ext in extensions {
            let candidate = dir.join(format!("{binary}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// 执行 `<bin> --version` 获取版本字符串,带 3 秒超时
async fn probe_version(path: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(path);
    cmd.args(args);
    cmd.env("PATH", super::enhanced_path());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = match timeout(Duration::from_secs(3), cmd.output()).await {
        Ok(Ok(out)) => out,
        _ => return None,
    };

    let stdout_text = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_text = String::from_utf8_lossy(&output.stderr).to_string();

    // 有些 CLI 把版本打到 stderr,两者都看
    let raw = if !stdout_text.trim().is_empty() {
        stdout_text
    } else {
        stderr_text
    };

    let first_line = raw.lines().next()?.trim().to_string();
    if first_line.is_empty() {
        return None;
    }

    // 限制长度,避免极端情况下返回超长字符串
    let truncated = if first_line.chars().count() > 128 {
        format!("{}…", first_line.chars().take(128).collect::<String>())
    } else {
        first_line
    };
    Some(truncated)
}

/// 检测所有已知 Agent 的安装状态
///
/// 分两阶段:
///   1. 同步 PATH 扫描(全部 agent,纯磁盘 stat,毫秒级)
///   2. 并行 `--version` 探测(仅已安装的,每个 3s 超时,join_all 并发)
#[tauri::command]
pub async fn detect_agents() -> Result<Vec<AgentDetection>, String> {
    // ── 阶段 1:PATH 扫描(同步,极快) ──
    let scan: Vec<_> = KNOWN_AGENTS
        .iter()
        .map(|agent| {
            let mut found: Option<(String, PathBuf)> = None;
            for binary in agent.binaries {
                if let Some(path) = find_in_path(binary) {
                    found = Some(((*binary).to_string(), path));
                    break;
                }
            }
            (agent, found)
        })
        .collect();

    // ── 阶段 2:并行版本探测(仅已安装的) ──
    let version_futures: Vec<_> = scan
        .iter()
        .map(|(agent, found)| async move {
            match found {
                Some((_, path)) => probe_version(path, agent.version_args).await,
                None => None,
            }
        })
        .collect();
    let versions = futures_util::future::join_all(version_futures).await;

    // ── 组装结果 ──
    let results = scan
        .into_iter()
        .zip(versions)
        .map(|((agent, found), version)| {
            let display_binary = agent.binaries.first().copied().unwrap_or("").to_string();
            match found {
                Some((binary_used, path)) => AgentDetection {
                    id: agent.id.to_string(),
                    label: agent.label.to_string(),
                    description: agent.description.to_string(),
                    homepage: agent.homepage.to_string(),
                    install_url: agent.install_url.to_string(),
                    installed: true,
                    version,
                    path: Some(path.to_string_lossy().into_owned()),
                    binary: binary_used,
                },
                None => AgentDetection {
                    id: agent.id.to_string(),
                    label: agent.label.to_string(),
                    description: agent.description.to_string(),
                    homepage: agent.homepage.to_string(),
                    install_url: agent.install_url.to_string(),
                    installed: false,
                    version: None,
                    path: None,
                    binary: display_binary,
                },
            }
        })
        .collect();

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_agents_have_unique_ids() {
        let mut ids: Vec<&str> = KNOWN_AGENTS.iter().map(|a| a.id).collect();
        let count = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(count, ids.len(), "Agent IDs must be unique");
    }

    #[test]
    fn known_agents_have_binaries() {
        for agent in KNOWN_AGENTS {
            assert!(
                !agent.binaries.is_empty(),
                "{} has no binaries",
                agent.id
            );
        }
    }
}
