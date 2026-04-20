use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ServiceStatus {
    pub label: String,
    pub pid: Option<u32>,
    pub running: bool,
    pub description: String,
    /// CLI 工具是否已安装（Windows/Linux: openclaw CLI）
    pub cli_installed: bool,
    /// Gateway 归属状态: "stopped" | "owned" | "foreign"
    pub ownership: Option<String>,
    /// 是否属于当前面板实例
    pub owned_by_current_instance: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenClawInstallation {
    pub path: String,
    pub source: String,
    pub version: Option<String>,
    pub active: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VersionInfo {
    pub current: Option<String>,
    pub latest: Option<String>,
    pub recommended: Option<String>,
    pub update_available: bool,
    pub latest_update_available: bool,
    pub is_recommended: bool,
    pub ahead_of_recommended: bool,
    pub panel_version: String,
    pub source: String,
    /// 活跃 CLI 路径
    pub cli_path: Option<String>,
    /// CLI 安装来源分类
    pub cli_source: Option<String>,
    /// 所有检测到的 OpenClaw 安装
    pub all_installations: Option<Vec<OpenClawInstallation>>,
}
