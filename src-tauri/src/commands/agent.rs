use crate::utils::openclaw_command_async;
/// Agent 管理命令 — 调用 openclaw CLI 实现增删改查
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const CORE_SOURCE_FILES: [&str; 5] = ["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md", "TOOLS.md"];
const COMMON_SOURCE_FILES: [&str; 4] = ["agent.md", "AGENT.md", "CLAUDE.md", "README.md"];
const TARGET_WORKSPACE_FILES: [&str; 4] = ["IDENTITY.md", "SOUL.md", "AGENTS.md", "TOOLS.md"];
const SOURCE_FILE_CHAR_LIMIT: usize = 6000;
const SOURCE_TRUNCATION_NOTICE: &str = "\n\n[内容已截断，仅保留前文以控制预览和提示词体积。]";

/// 获取 agent 列表
#[tauri::command]
pub async fn list_agents() -> Result<Value, String> {
    let output = openclaw_command_async()
        .args(["agents", "list", "--json"])
        .output()
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "OpenClaw CLI 未找到，请确认已安装并重启 Privix。\n如果使用 nvm 安装，请从终端启动 Privix。".to_string()
            } else {
                format!("执行失败: {e}")
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("获取 Agent 列表失败: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    crate::commands::skills::extract_json_pub(&stdout)
        .ok_or_else(|| "解析 JSON 失败: 输出中未找到有效 JSON".to_string())
}

/// 创建新 agent
#[tauri::command]
pub async fn add_agent(
    name: String,
    model: String,
    workspace: Option<String>,
) -> Result<Value, String> {
    let ws = match workspace {
        Some(ref w) if !w.is_empty() => std::path::PathBuf::from(w),
        _ => super::openclaw_dir()
            .join("agents")
            .join(&name)
            .join("workspace"),
    };

    let mut args = vec![
        "agents".to_string(),
        "add".to_string(),
        name.clone(),
        "--non-interactive".to_string(),
        "--workspace".to_string(),
        ws.to_string_lossy().to_string(),
        "--json".to_string(),
    ];

    if !model.is_empty() {
        args.push("--model".to_string());
        args.push(model);
    }

    let output = openclaw_command_async()
        .args(&args)
        .output()
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "OpenClaw CLI 未找到，请确认已安装并重启 Privix。".to_string()
            } else {
                format!("执行失败: {e}")
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("创建 Agent 失败: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&stdout).unwrap_or(Value::String("ok".into()));
    // 返回最新列表
    list_agents().await
}

async fn resolve_agent_workspace(agent_id: &str) -> Result<PathBuf, String> {
    let agents = list_agents().await?;
    if let Some(arr) = agents.as_array() {
        for agent in arr {
            if agent.get("id").and_then(|v| v.as_str()) == Some(agent_id) {
                if let Some(ws) = agent.get("workspace").and_then(|v| v.as_str()) {
                    return Ok(PathBuf::from(ws));
                }
            }
        }
    }
    Err(format!("Agent「{agent_id}」不存在或无 workspace"))
}

fn derive_workspace_from_create_spec(create_spec: &Value) -> Result<PathBuf, String> {
    let agent_id = create_spec
        .get("agentId")
        .or_else(|| create_spec.get("id"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or("createSpec.agentId 不能为空")?;

    if let Some(workspace) = create_spec
        .get("workspace")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        return Ok(PathBuf::from(workspace));
    }

    Ok(super::openclaw_dir()
        .join("agents")
        .join(agent_id)
        .join("workspace"))
}

fn backup_root_dir() -> PathBuf {
    super::panel_runtime_dir().join("agent-config-backups")
}

fn read_optional_file(path: &Path) -> Option<String> {
    fs::read_to_string(path).ok()
}

fn truncate_source_content(value: String, limit: usize) -> String {
    let char_count = value.chars().count();
    if char_count <= limit {
        return value;
    }

    let notice_len = SOURCE_TRUNCATION_NOTICE.chars().count();
    if limit <= notice_len {
        return value.chars().take(limit).collect();
    }

    let prefix: String = value.chars().take(limit - notice_len).collect();
    format!("{prefix}{SOURCE_TRUNCATION_NOTICE}")
}

fn excerpt(value: &str, limit: usize) -> String {
    let compact = value
        .replace('\r', "")
        .replace('\n', " ")
        .trim()
        .to_string();
    if compact.len() <= limit {
        compact
    } else {
        format!("{}...", &compact[..limit])
    }
}

fn summarize_diff(current: Option<&str>, generated: &str) -> Value {
    let current_text = current.unwrap_or("");
    let status = if current.is_none() || current_text.trim().is_empty() {
        "created"
    } else if current_text == generated {
        "unchanged"
    } else {
        "updated"
    };
    json!({
        "status": status,
        "currentExcerpt": if current.is_some() { Value::String(excerpt(current_text, 160)) } else { Value::Null },
        "nextExcerpt": excerpt(generated, 160),
        "currentLines": if current.is_some() { Value::from(current_text.lines().count() as u64) } else { Value::Null },
        "nextLines": generated.lines().count(),
    })
}

fn validate_target_file_name(file_name: &str) -> Result<(), String> {
    if TARGET_WORKSPACE_FILES.contains(&file_name) {
        Ok(())
    } else {
        Err(format!("不支持写入目标文件: {file_name}"))
    }
}

async fn resolve_workspace_for_target(
    target: &Value,
) -> Result<(Option<String>, PathBuf, bool), String> {
    if let Some(agent_id) = target.get("agentId").and_then(|v| v.as_str()) {
        let workspace = resolve_agent_workspace(agent_id).await?;
        return Ok((
            Some(agent_id.to_string()),
            workspace.clone(),
            workspace.exists(),
        ));
    }

    if let Some(create_spec) = target.get("createSpec") {
        let agent_id = create_spec
            .get("agentId")
            .or_else(|| create_spec.get("id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let workspace = derive_workspace_from_create_spec(create_spec)?;
        return Ok((agent_id, workspace.clone(), workspace.exists()));
    }

    Err("预览目标缺少 agentId 或 createSpec".into())
}

fn collect_source_files(workspace: &Path, source_scope: &str, source_role: &str) -> Vec<Value> {
    let mut files = Vec::new();
    for file_name in CORE_SOURCE_FILES.iter() {
        let file_path = workspace.join(file_name);
        let content = read_optional_file(&file_path)
            .map(|value| truncate_source_content(value, SOURCE_FILE_CHAR_LIMIT));
        files.push(json!({
            "sourceRole": source_role,
            "name": file_name,
            "path": file_path.to_string_lossy().to_string(),
            "exists": content.is_some(),
            "content": content,
        }));
    }
    if source_scope == "core_and_common" {
        for file_name in COMMON_SOURCE_FILES.iter() {
            let file_path = workspace.join(file_name);
            let content = read_optional_file(&file_path)
                .map(|value| truncate_source_content(value, SOURCE_FILE_CHAR_LIMIT));
            files.push(json!({
                "sourceRole": source_role,
                "name": file_name,
                "path": file_path.to_string_lossy().to_string(),
                "exists": content.is_some(),
                "content": content,
            }));
        }
    }
    files
}

#[tauri::command]
pub async fn preview_agent_workspace_generation(payload: Value) -> Result<Value, String> {
    let source_scope = payload
        .get("sourceScope")
        .and_then(|v| v.as_str())
        .unwrap_or("core_and_common");
    let mode = payload
        .get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or("configure");
    let current_agent_id = payload.get("agentId").and_then(|v| v.as_str());
    let parent_agent_id = payload.get("parentAgentId").and_then(|v| v.as_str());
    let read_target_sources = payload
        .get("readTargetSources")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let read_parent_sources = payload
        .get("readParentSources")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let mut sources = Vec::new();
    let mut context = json!({
        "mode": mode,
        "sourceScope": source_scope,
        "agentId": current_agent_id,
        "parentAgentId": parent_agent_id,
    });

    if mode == "configure" {
        let agent_id = current_agent_id.ok_or("agentId 不能为空")?;
        let workspace = resolve_agent_workspace(agent_id).await?;
        context["workspace"] = Value::String(workspace.to_string_lossy().to_string());
        if read_target_sources {
            sources.extend(collect_source_files(&workspace, source_scope, "target"));
        }
    } else if let Some(create_spec) = payload.get("createSpec") {
        let workspace = derive_workspace_from_create_spec(create_spec)?;
        context["workspace"] = Value::String(workspace.to_string_lossy().to_string());
        context["targetExists"] = Value::Bool(workspace.exists());
        if read_target_sources {
            sources.extend(collect_source_files(&workspace, source_scope, "target"));
        }
    }

    if let Some(parent_id) = parent_agent_id {
        let parent_workspace = resolve_agent_workspace(parent_id).await?;
        context["parentWorkspace"] = Value::String(parent_workspace.to_string_lossy().to_string());
        if read_parent_sources {
            sources.extend(collect_source_files(
                &parent_workspace,
                source_scope,
                "parent",
            ));
        }
    }

    let mut preview_targets = Vec::new();
    if let Some(targets) = payload.get("generatedTargets").and_then(|v| v.as_array()) {
        for target in targets {
            let (agent_id, workspace, exists) = resolve_workspace_for_target(target).await?;
            let label = target
                .get("label")
                .and_then(|v| v.as_str())
                .unwrap_or("Agent");
            let files = target
                .get("files")
                .and_then(|v| v.as_object())
                .ok_or("generatedTargets.files 格式错误")?;
            let mut diff_files = serde_json::Map::new();
            let mut backup_files = Vec::new();

            for (file_name, generated) in files {
                validate_target_file_name(file_name)?;
                let content = generated.as_str().unwrap_or("");
                let current_path = workspace.join(file_name);
                let current_content = read_optional_file(&current_path);
                if current_content.is_some() {
                    backup_files.push(Value::String(file_name.clone()));
                }
                diff_files.insert(
                    file_name.clone(),
                    summarize_diff(current_content.as_deref(), content),
                );
            }

            preview_targets.push(json!({
                "key": target.get("key").cloned().unwrap_or(Value::String("target".into())),
                "label": label,
                "agentId": agent_id,
                "workspace": workspace.to_string_lossy().to_string(),
                "exists": exists,
                "diffs": diff_files,
                "backupPlan": {
                    "root": backup_root_dir().to_string_lossy().to_string(),
                    "files": backup_files,
                }
            }));
        }
    }

    Ok(json!({
        "sourceScope": source_scope,
        "sources": sources,
        "context": context,
        "previewTargets": preview_targets,
        "targetFiles": TARGET_WORKSPACE_FILES,
    }))
}

#[tauri::command]
pub async fn apply_agent_workspace_generation(payload: Value) -> Result<Value, String> {
    let targets = payload
        .get("generatedTargets")
        .and_then(|v| v.as_array())
        .ok_or("generatedTargets 不能为空")?;
    if targets.is_empty() {
        return Err("generatedTargets 不能为空".into());
    }

    let backup_stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let backup_root = backup_root_dir().join(&backup_stamp);
    fs::create_dir_all(&backup_root).map_err(|e| format!("创建备份目录失败: {e}"))?;

    let mut created_agents = Vec::new();
    let mut written_files = Vec::new();

    for target in targets {
        let create_spec = target.get("createSpec");
        if let Some(spec) = create_spec {
            if let Some(agent_id) = spec
                .get("agentId")
                .or_else(|| spec.get("id"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                if resolve_agent_workspace(agent_id).await.is_err() {
                    let model = spec
                        .get("model")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let workspace = derive_workspace_from_create_spec(spec)?
                        .to_string_lossy()
                        .to_string();
                    add_agent(agent_id.to_string(), model, Some(workspace)).await?;
                    created_agents.push(json!({
                        "agentId": agent_id,
                    }));
                }
            }
        }

        let (agent_id, workspace, _) = resolve_workspace_for_target(target).await?;
        fs::create_dir_all(&workspace).map_err(|e| format!("创建 workspace 失败: {e}"))?;

        let files = target
            .get("files")
            .and_then(|v| v.as_object())
            .ok_or("generatedTargets.files 格式错误")?;

        let backup_target_dir = backup_root.join(agent_id.clone().unwrap_or_else(|| {
            target
                .get("key")
                .and_then(|v| v.as_str())
                .unwrap_or("target")
                .to_string()
        }));
        fs::create_dir_all(&backup_target_dir).map_err(|e| format!("创建备份子目录失败: {e}"))?;

        for (file_name, generated) in files {
            validate_target_file_name(file_name)?;
            let file_path = workspace.join(file_name);
            if let Some(existing) = read_optional_file(&file_path) {
                fs::write(backup_target_dir.join(file_name), existing)
                    .map_err(|e| format!("写入备份失败: {e}"))?;
            }
            let content = generated.as_str().unwrap_or("");
            fs::write(&file_path, content).map_err(|e| format!("写入 {} 失败: {e}", file_name))?;
            written_files.push(json!({
                "agentId": agent_id,
                "file": file_name,
                "path": file_path.to_string_lossy().to_string(),
            }));
        }
    }

    Ok(json!({
        "backupRoot": backup_root.to_string_lossy().to_string(),
        "createdAgents": created_agents,
        "writtenFiles": written_files,
    }))
}

/// 删除 agent
#[tauri::command]
pub async fn delete_agent(id: String) -> Result<String, String> {
    if id == "main" {
        return Err("不能删除默认 Agent".into());
    }

    let output = openclaw_command_async()
        // 桌面端通过 Tauri 非交互调用 CLI，删除时需要显式跳过确认。
        .args(["agents", "delete", "--force", &id])
        .output()
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "OpenClaw CLI 未找到，请确认已安装并重启 Privix。".to_string()
            } else {
                format!("执行失败: {e}")
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("删除 Agent 失败: {stderr}"));
    }

    Ok("已删除".into())
}

/// 更新 agent 身份信息
#[tauri::command]
pub fn update_agent_identity(
    id: String,
    name: Option<String>,
    emoji: Option<String>,
) -> Result<String, String> {
    let path = super::openclaw_dir().join("openclaw.json");
    let content = fs::read_to_string(&path).map_err(|e| format!("读取配置失败: {e}"))?;
    let mut config: Value =
        serde_json::from_str(&content).map_err(|e| format!("解析 JSON 失败: {e}"))?;

    let agents_list = config
        .get_mut("agents")
        .and_then(|a| a.get_mut("list"))
        .and_then(|l| l.as_array_mut())
        .ok_or("配置格式错误")?;

    let agent = agents_list
        .iter_mut()
        .find(|a| a.get("id").and_then(|v| v.as_str()) == Some(&id))
        .ok_or(format!("Agent「{id}」不存在"))?;

    // 确保 identity 字段存在且为对象
    if agent.get("identity").and_then(|i| i.as_object()).is_none() {
        agent
            .as_object_mut()
            .ok_or("Agent 格式错误")?
            .insert("identity".to_string(), serde_json::json!({}));
    }

    let identity = agent
        .get_mut("identity")
        .and_then(|i| i.as_object_mut())
        .ok_or("identity 格式错误")?;

    if let Some(n) = name {
        if !n.is_empty() {
            identity.insert("name".to_string(), Value::String(n));
        }
    }
    if let Some(e) = emoji {
        if !e.is_empty() {
            identity.insert("emoji".to_string(), Value::String(e));
        }
    }

    // 提前提取 workspace 路径（克隆为 String，避免借用冲突）
    let workspace_path = agent
        .get("workspace")
        .and_then(|w| w.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            config
                .get("agents")
                .and_then(|a| a.get("defaults"))
                .and_then(|d| d.get("workspace"))
                .and_then(|w| w.as_str())
                .map(|s| s.to_string())
        });

    let json = serde_json::to_string_pretty(&config).map_err(|e| format!("序列化失败: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("写入配置失败: {e}"))?;

    // 删除 IDENTITY.md 文件，让配置文件生效
    if let Some(ws_str) = workspace_path {
        let identity_file = std::path::PathBuf::from(ws_str).join("IDENTITY.md");
        if identity_file.exists() {
            let _ = fs::remove_file(&identity_file);
        }
    }

    Ok("已更新".into())
}

/// 备份 agent 数据（agent 配置 + 会话记录）打包为 zip
#[tauri::command]
pub fn backup_agent(id: String) -> Result<String, String> {
    let agent_dir = super::openclaw_dir().join("agents").join(&id);
    if !agent_dir.exists() {
        return Err(format!("Agent「{id}」数据目录不存在"));
    }

    let tmp_dir = std::env::temp_dir();
    let now = chrono::Local::now();
    let zip_name = format!("agent-{}-{}.zip", id, now.format("%Y%m%d-%H%M%S"));
    let zip_path = tmp_dir.join(&zip_name);

    let file = fs::File::create(&zip_path).map_err(|e| format!("创建 zip 失败: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    collect_dir_to_zip(&agent_dir, &agent_dir, &mut zip, options)?;

    zip.finish().map_err(|e| format!("完成 zip 失败: {e}"))?;
    Ok(zip_path.to_string_lossy().to_string())
}

fn collect_dir_to_zip(
    base: &std::path::Path,
    dir: &std::path::Path,
    zip: &mut zip::ZipWriter<fs::File>,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("读取目录失败: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let rel = path
            .strip_prefix(base)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        if path.is_dir() {
            collect_dir_to_zip(base, &path, zip, options)?;
        } else {
            let content = fs::read(&path).map_err(|e| format!("读取 {rel} 失败: {e}"))?;
            zip.start_file(&rel, options)
                .map_err(|e| format!("写入 zip 失败: {e}"))?;
            zip.write_all(&content)
                .map_err(|e| format!("写入内容失败: {e}"))?;
        }
    }
    Ok(())
}

/// 更新 agent 模型配置
#[tauri::command]
pub fn update_agent_model(id: String, model: String) -> Result<String, String> {
    let path = super::openclaw_dir().join("openclaw.json");
    let content = fs::read_to_string(&path).map_err(|e| format!("读取配置失败: {e}"))?;
    let mut config: Value =
        serde_json::from_str(&content).map_err(|e| format!("解析 JSON 失败: {e}"))?;

    let agents_list = config
        .get_mut("agents")
        .and_then(|a| a.get_mut("list"))
        .and_then(|l| l.as_array_mut())
        .ok_or("配置格式错误")?;

    let agent = agents_list
        .iter_mut()
        .find(|a| a.get("id").and_then(|v| v.as_str()) == Some(&id))
        .ok_or(format!("Agent「{id}」不存在"))?;

    let model_obj = serde_json::json!({ "primary": model });
    agent
        .as_object_mut()
        .ok_or("Agent 格式错误")?
        .insert("model".to_string(), model_obj);

    let json = serde_json::to_string_pretty(&config).map_err(|e| format!("序列化失败: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("写入配置失败: {e}"))?;

    Ok("已更新".into())
}

/// 展开用户路径（~ → home dir），供其他模块调用
pub fn expand_user_path_pub(raw: &str) -> std::path::PathBuf {
    let trimmed = raw.trim();
    let path = if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        dirs::home_dir().unwrap_or_default().join(rest)
    } else {
        std::path::PathBuf::from(trimmed)
    };

    if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(&path))
            .unwrap_or(path)
    }
}
