use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// Knowledge base root directory: ~/.openclaw/privix-community/knowledge/
fn kb_root_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".openclaw")
        .join("privix-community")
        .join("knowledge")
}

fn index_path() -> PathBuf {
    kb_root_dir().join("index.json")
}

fn read_index() -> Vec<Value> {
    let path = index_path();
    if !path.exists() {
        return vec![];
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<Value>>(&s).ok())
        .unwrap_or_default()
}

fn write_index(entries: &[Value]) -> Result<(), String> {
    let root = kb_root_dir();
    fs::create_dir_all(&root).map_err(|e| format!("创建知识库目录失败: {e}"))?;
    let data =
        serde_json::to_string_pretty(entries).map_err(|e| format!("序列化 index 失败: {e}"))?;
    fs::write(index_path(), data).map_err(|e| format!("写入 index.json 失败: {e}"))
}

fn read_meta(kb_id: &str) -> Result<Value, String> {
    let meta_path = kb_root_dir().join(kb_id).join("meta.json");
    let content =
        fs::read_to_string(&meta_path).map_err(|e| format!("读取 meta.json 失败: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("解析 meta.json 失败: {e}"))
}

fn write_meta(kb_id: &str, meta: &Value) -> Result<(), String> {
    let meta_path = kb_root_dir().join(kb_id).join("meta.json");
    let data = serde_json::to_string_pretty(meta).map_err(|e| format!("序列化 meta 失败: {e}"))?;
    fs::write(meta_path, data).map_err(|e| format!("写入 meta.json 失败: {e}"))
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

// ---------------------------------------------------------------------------
// 文件类型判断
// ---------------------------------------------------------------------------

/// 判断文件是否为需要外部工具提取文本的富文档格式
fn is_rich_document(file_name: &str) -> bool {
    let lower = file_name.to_ascii_lowercase();
    lower.ends_with(".pdf")
        || lower.ends_with(".docx")
        || lower.ends_with(".doc")
        || lower.ends_with(".xlsx")
        || lower.ends_with(".xls")
        || lower.ends_with(".pptx")
}

/// 提取文本的缓存文件名
fn extracted_text_name(file_name: &str) -> String {
    format!("{}.extracted.txt", file_name)
}

// ---------------------------------------------------------------------------
// 外部工具文本提取
// ---------------------------------------------------------------------------

/// 使用外部工具（pandoc / pdftotext）从富文档中提取纯文本
async fn extract_text_from_file(file_path: &Path) -> Result<String, String> {
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match ext.as_str() {
        "pdf" => extract_pdf(file_path).await,
        "docx" | "doc" => extract_with_pandoc(file_path, "docx").await,
        "xlsx" | "xls" => extract_with_pandoc(file_path, "xlsx").await,
        "pptx" => extract_with_pandoc(file_path, "pptx").await,
        "csv" | "tsv" => {
            fs::read_to_string(file_path).map_err(|e| format!("读取 CSV 文件失败: {e}"))
        }
        _ => fs::read_to_string(file_path).map_err(|e| format!("读取文件失败: {e}")),
    }
}

/// PDF: 优先 pdftotext（poppler），降级到 pandoc
async fn extract_pdf(file_path: &Path) -> Result<String, String> {
    let path_str = file_path.to_string_lossy().to_string();

    // 尝试 pdftotext（poppler-utils）
    let result = tokio::process::Command::new("pdftotext")
        .args(["-layout", &path_str, "-"])
        .output()
        .await;

    if let Ok(output) = result {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout).to_string();
            if !text.trim().is_empty() {
                return Ok(text);
            }
        }
    }

    // 降级: 尝试 pandoc
    extract_with_pandoc(file_path, "pdf").await
}

/// 使用 pandoc 转换为纯文本
async fn extract_with_pandoc(file_path: &Path, from_format: &str) -> Result<String, String> {
    let path_str = file_path.to_string_lossy().to_string();

    // pandoc 对 xlsx 使用不同的 input 格式
    let pandoc_from = match from_format {
        "xlsx" | "xls" => "csv", // pandoc 不直接支持 xlsx，后面会特殊处理
        other => other,
    };

    // xlsx/xls: pandoc 不直接支持，尝试用 ssconvert (gnumeric) 或 libreoffice 转 csv
    if from_format == "xlsx" || from_format == "xls" {
        return extract_spreadsheet(file_path).await;
    }

    let result = tokio::process::Command::new("pandoc")
        .args(["-f", pandoc_from, "-t", "plain", "--wrap=none", &path_str])
        .output()
        .await
        .map_err(|e| {
            format!(
                "调用 pandoc 失败: {e}\n\n请安装 pandoc: https://pandoc.org/installing.html\nmacOS: brew install pandoc\nWindows: choco install pandoc"
            )
        })?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!("pandoc 转换失败: {stderr}"));
    }

    let text = String::from_utf8_lossy(&result.stdout).to_string();
    Ok(text)
}

/// 电子表格提取：尝试 libreoffice → ssconvert → 纯二进制读取
async fn extract_spreadsheet(file_path: &Path) -> Result<String, String> {
    let path_str = file_path.to_string_lossy().to_string();

    // 尝试 ssconvert (gnumeric)
    let tmp_csv = format!("{}.tmp.csv", path_str);
    let result = tokio::process::Command::new("ssconvert")
        .args([&path_str, &tmp_csv])
        .output()
        .await;

    if let Ok(output) = result {
        if output.status.success() {
            if let Ok(text) = fs::read_to_string(&tmp_csv) {
                let _ = fs::remove_file(&tmp_csv);
                return Ok(text);
            }
            let _ = fs::remove_file(&tmp_csv);
        }
    }

    // 尝试 libreoffice --headless
    let tmp_dir = file_path.parent().unwrap_or(Path::new("/tmp"));
    let result = tokio::process::Command::new("libreoffice")
        .args([
            "--headless",
            "--convert-to",
            "csv",
            "--outdir",
            &tmp_dir.to_string_lossy(),
            &path_str,
        ])
        .output()
        .await;

    if let Ok(output) = result {
        if output.status.success() {
            let csv_name = file_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
                + ".csv";
            let csv_path = tmp_dir.join(&csv_name);
            if let Ok(text) = fs::read_to_string(&csv_path) {
                let _ = fs::remove_file(&csv_path);
                return Ok(text);
            }
        }
    }

    Err("无法提取电子表格内容。请安装以下任一工具:\n\
         - ssconvert (gnumeric): brew install gnumeric\n\
         - libreoffice: brew install --cask libreoffice"
        .into())
}

/// 尝试对文件提取文本并保存为 .extracted.txt 缓存
async fn try_extract_and_cache(files_dir: &Path, file_name: &str) -> Option<String> {
    let file_path = files_dir.join(file_name);
    if !file_path.is_file() {
        return None;
    }

    match extract_text_from_file(&file_path).await {
        Ok(text) if !text.trim().is_empty() => {
            let cache_path = files_dir.join(extracted_text_name(file_name));
            let _ = fs::write(&cache_path, &text);
            Some(text)
        }
        _ => None,
    }
}

/// 读取已缓存的提取文本，不存在则返回 None
fn read_extracted_cache(files_dir: &Path, file_name: &str) -> Option<String> {
    let cache_path = files_dir.join(extracted_text_name(file_name));
    fs::read_to_string(&cache_path).ok()
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kb_list_libraries() -> Result<Value, String> {
    Ok(Value::Array(read_index()))
}

#[tauri::command]
pub async fn kb_create_library(name: String, desc: String) -> Result<Value, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_iso();

    let kb_dir = kb_root_dir().join(&id);
    let files_dir = kb_dir.join("files");
    fs::create_dir_all(&files_dir).map_err(|e| format!("创建知识库目录失败: {e}"))?;

    let meta = json!({
        "id": id,
        "name": name,
        "desc": desc,
        "files": []
    });
    write_meta(&id, &meta)?;

    let entry = json!({
        "id": id,
        "name": name,
        "desc": desc,
        "enabled": true,
        "createdAt": now,
        "updatedAt": now,
    });
    let mut index = read_index();
    index.push(entry.clone());
    write_index(&index)?;

    Ok(entry)
}

#[tauri::command]
pub async fn kb_delete_library(id: String) -> Result<String, String> {
    let kb_dir = kb_root_dir().join(&id);
    if kb_dir.exists() {
        fs::remove_dir_all(&kb_dir).map_err(|e| format!("删除知识库目录失败: {e}"))?;
    }

    let mut index = read_index();
    index.retain(|e| e.get("id").and_then(|v| v.as_str()) != Some(&id));
    write_index(&index)?;

    Ok("ok".into())
}

#[tauri::command]
pub async fn kb_update_library(
    id: String,
    name: Option<String>,
    desc: Option<String>,
    enabled: Option<bool>,
) -> Result<Value, String> {
    let now = now_iso();

    // Update meta.json
    let mut meta = read_meta(&id)?;
    if let Some(ref n) = name {
        meta["name"] = Value::String(n.clone());
    }
    if let Some(ref d) = desc {
        meta["desc"] = Value::String(d.clone());
    }
    write_meta(&id, &meta)?;

    // Update index.json
    let mut index = read_index();
    for entry in index.iter_mut() {
        if entry.get("id").and_then(|v| v.as_str()) == Some(&id) {
            if let Some(ref n) = name {
                entry["name"] = Value::String(n.clone());
            }
            if let Some(ref d) = desc {
                entry["desc"] = Value::String(d.clone());
            }
            if let Some(e) = enabled {
                entry["enabled"] = Value::Bool(e);
            }
            entry["updatedAt"] = Value::String(now.clone());
            break;
        }
    }
    write_index(&index)?;

    // Return the updated entry
    let updated = index
        .into_iter()
        .find(|e| e.get("id").and_then(|v| v.as_str()) == Some(&id))
        .unwrap_or(json!({"id": id}));
    Ok(updated)
}

#[tauri::command]
pub async fn kb_list_files(kb_id: String) -> Result<Value, String> {
    let meta = read_meta(&kb_id)?;
    let files = meta.get("files").cloned().unwrap_or(json!([]));
    Ok(files)
}

#[tauri::command]
pub async fn kb_add_text(kb_id: String, name: String, content: String) -> Result<Value, String> {
    let files_dir = kb_root_dir().join(&kb_id).join("files");
    fs::create_dir_all(&files_dir).map_err(|e| format!("创建 files 目录失败: {e}"))?;

    let file_path = files_dir.join(&name);
    fs::write(&file_path, &content).map_err(|e| format!("写入文件失败: {e}"))?;

    let size = content.len() as u64;
    let now = now_iso();

    // Update meta.json
    let mut meta = read_meta(&kb_id)?;
    let files = meta
        .get_mut("files")
        .and_then(|v| v.as_array_mut())
        .ok_or("meta.json files 字段异常")?;

    // Remove existing entry with same name if any
    files.retain(|f| f.get("name").and_then(|v| v.as_str()) != Some(&name));
    let file_entry = json!({ "name": name, "size": size, "addedAt": now });
    files.push(file_entry.clone());
    write_meta(&kb_id, &meta)?;

    Ok(file_entry)
}

#[tauri::command]
pub async fn kb_add_file(kb_id: String, source_path: String) -> Result<Value, String> {
    let src = std::path::Path::new(&source_path);
    if !src.is_file() {
        return Err(format!("源文件不存在: {source_path}"));
    }

    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("无法获取文件名")?
        .to_string();

    let files_dir = kb_root_dir().join(&kb_id).join("files");
    fs::create_dir_all(&files_dir).map_err(|e| format!("创建 files 目录失败: {e}"))?;

    let dst = files_dir.join(&file_name);
    fs::copy(src, &dst).map_err(|e| format!("复制文件失败: {e}"))?;

    let size = fs::metadata(&dst).map(|m| m.len()).unwrap_or(0);
    let now = now_iso();

    // Update meta.json
    let mut meta = read_meta(&kb_id)?;
    let files = meta
        .get_mut("files")
        .and_then(|v| v.as_array_mut())
        .ok_or("meta.json files 字段异常")?;

    files.retain(|f| f.get("name").and_then(|v| v.as_str()) != Some(&file_name));
    let file_entry = json!({ "name": file_name, "size": size, "addedAt": now });
    files.push(file_entry.clone());
    write_meta(&kb_id, &meta)?;

    // 对富文档格式自动提取文本（后台执行，不阻塞返回）
    if is_rich_document(&file_name) {
        let files_dir_clone = files_dir.clone();
        let name_clone = file_name.clone();
        tokio::spawn(async move {
            let _ = try_extract_and_cache(&files_dir_clone, &name_clone).await;
        });
    }

    Ok(file_entry)
}

#[tauri::command]
pub async fn kb_read_file(kb_id: String, file_name: String) -> Result<String, String> {
    let files_dir = kb_root_dir().join(&kb_id).join("files");
    let file_path = files_dir.join(&file_name);
    if !file_path.is_file() {
        return Err(format!("文件不存在: {file_name}"));
    }

    // 对富文档格式：优先读取已提取的文本缓存
    if is_rich_document(&file_name) {
        // 1. 尝试读缓存
        if let Some(cached) = read_extracted_cache(&files_dir, &file_name) {
            return Ok(cached);
        }
        // 2. 缓存不存在，实时提取
        if let Some(text) = try_extract_and_cache(&files_dir, &file_name).await {
            return Ok(text);
        }
        // 3. 提取失败，返回提示
        return Ok(format!(
            "[此文件为 {} 格式，文本提取失败。请确保已安装 pandoc 或 pdftotext 工具。]\n\n\
             安装方法:\n\
             macOS: brew install pandoc poppler\n\
             Windows: choco install pandoc\n\
             Linux: sudo apt install pandoc poppler-utils",
            file_path
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_uppercase()
        ));
    }

    // 普通文本文件：直接读取
    let bytes = fs::read(&file_path).map_err(|e| format!("读取文件失败: {e}"))?;

    // Truncate at 200KB
    const MAX_SIZE: usize = 200 * 1024;
    let content = if bytes.len() > MAX_SIZE {
        String::from_utf8_lossy(&bytes[..MAX_SIZE]).into_owned()
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    };

    Ok(content)
}

#[tauri::command]
pub async fn kb_delete_file(kb_id: String, file_name: String) -> Result<String, String> {
    let files_dir = kb_root_dir().join(&kb_id).join("files");
    let file_path = files_dir.join(&file_name);
    if file_path.is_file() {
        fs::remove_file(&file_path).map_err(|e| format!("删除文件失败: {e}"))?;
    }

    // 同时删除提取缓存
    let cache_path = files_dir.join(extracted_text_name(&file_name));
    if cache_path.is_file() {
        let _ = fs::remove_file(&cache_path);
    }

    // Update meta.json
    let mut meta = read_meta(&kb_id)?;
    if let Some(files) = meta.get_mut("files").and_then(|v| v.as_array_mut()) {
        files.retain(|f| f.get("name").and_then(|v| v.as_str()) != Some(&file_name));
    }
    write_meta(&kb_id, &meta)?;

    Ok("ok".into())
}

#[tauri::command]
pub async fn kb_sync_to_agent(kb_id: String, agent_id: String) -> Result<Value, String> {
    // Read all files from KB
    let meta = read_meta(&kb_id)?;
    let kb_name = meta
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Knowledge Base");
    let files = meta
        .get("files")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let files_dir = kb_root_dir().join(&kb_id).join("files");
    let mut markdown = format!("# Knowledge Base: {kb_name}\n\n");
    let mut synced_count = 0u32;

    for file_entry in &files {
        let fname = match file_entry.get("name").and_then(|v| v.as_str()) {
            Some(n) => n,
            None => continue,
        };
        let fpath = files_dir.join(fname);
        if !fpath.is_file() {
            continue;
        }

        // 对富文档格式使用提取后的文本
        let content = if is_rich_document(fname) {
            // 优先读缓存
            if let Some(cached) = read_extracted_cache(&files_dir, fname) {
                cached
            } else if let Some(extracted) = try_extract_and_cache(&files_dir, fname).await {
                extracted
            } else {
                format!("[{fname}: 文本提取失败，请安装 pandoc/pdftotext]")
            }
        } else {
            match fs::read_to_string(&fpath) {
                Ok(c) => c,
                Err(_) => continue,
            }
        };

        markdown.push_str(&format!("## {fname}\n\n{content}\n\n"));
        synced_count += 1;
    }

    // Resolve agent workspace using same pattern as agent.rs
    let workspace = resolve_agent_workspace_for_kb(&agent_id).await?;
    fs::create_dir_all(&workspace).map_err(|e| format!("创建 workspace 目录失败: {e}"))?;

    let user_md_path = workspace.join("USER.md");
    fs::write(&user_md_path, &markdown).map_err(|e| format!("写入 USER.md 失败: {e}"))?;

    Ok(json!({
        "kbId": kb_id,
        "agentId": agent_id,
        "syncedFiles": synced_count,
        "userMdPath": user_md_path.to_string_lossy(),
    }))
}

/// 检测外部文本提取工具是否已安装
#[tauri::command]
pub async fn kb_check_extract_tools() -> Result<Value, String> {
    let pandoc_ok = tokio::process::Command::new("pandoc")
        .arg("--version")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);

    let pdftotext_ok = tokio::process::Command::new("pdftotext")
        .arg("-v")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);

    // pdftotext -v 在某些平台输出到 stderr 且 exit code 非零
    let pdftotext_ok = if !pdftotext_ok {
        tokio::process::Command::new("pdftotext")
            .arg("-v")
            .output()
            .await
            .map(|o| !o.stderr.is_empty() || !o.stdout.is_empty())
            .unwrap_or(false)
    } else {
        true
    };

    Ok(json!({
        "pandoc": pandoc_ok,
        "pdftotext": pdftotext_ok,
        "supported": pandoc_ok || pdftotext_ok,
        "installHint": if pandoc_ok && pdftotext_ok {
            "所有工具已就绪"
        } else if cfg!(target_os = "macos") {
            "brew install pandoc poppler"
        } else if cfg!(target_os = "windows") {
            "choco install pandoc"
        } else {
            "sudo apt install pandoc poppler-utils"
        }
    }))
}

/// Resolve agent workspace path by reading the agents list from openclaw CLI output,
/// mirroring the pattern used in agent.rs.
async fn resolve_agent_workspace_for_kb(agent_id: &str) -> Result<PathBuf, String> {
    // Try to find agent config via the same mechanism as agent.rs:
    // Read agents list from openclaw dir
    let agents_json = super::openclaw_dir().join("agents.json");
    if agents_json.exists() {
        if let Ok(content) = fs::read_to_string(&agents_json) {
            if let Ok(agents) = serde_json::from_str::<Vec<Value>>(&content) {
                for agent in &agents {
                    if agent.get("id").and_then(|v| v.as_str()) == Some(agent_id) {
                        if let Some(ws) = agent.get("workspace").and_then(|v| v.as_str()) {
                            return Ok(PathBuf::from(ws));
                        }
                    }
                }
            }
        }
    }

    // Fallback: call list_agents via the same pattern as agent module
    let agents = super::agent::list_agents().await?;
    if let Some(arr) = agents.as_array() {
        for agent in arr {
            if agent.get("id").and_then(|v| v.as_str()) == Some(agent_id) {
                if let Some(ws) = agent.get("workspace").and_then(|v| v.as_str()) {
                    return Ok(PathBuf::from(ws));
                }
            }
        }
    }

    // Default workspace path
    Ok(super::openclaw_dir()
        .join("agents")
        .join(agent_id)
        .join("workspace"))
}
