/// 消息渠道管理
/// 负责 Telegram / Discord / QQ Bot 等消息渠道的配置持久化与凭证校验
/// 配置写入 openclaw.json 的 channels / plugins 节点
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const OPENCLAW_QQBOT_PLUGIN_ID: &str = "qqbot";
const OPENCLAW_QQBOT_EXTENSION_FOLDER: &str = "openclaw-qqbot";
const TENCENT_OPENCLAW_QQBOT_PACKAGE: &str = "@tencent-connect/openclaw-qqbot@latest";
const QQBOT_DEFAULT_ACCOUNT_ID: &str = "default";
const QQ_OPENCLAW_FAQ_URL: &str = "https://q.qq.com/qqbot/openclaw/faq.html";

fn platform_storage_key(platform: &str) -> &str {
    match platform {
        "dingtalk" | "dingtalk-connector" => "dingtalk-connector",
        "weixin" | "openclaw-weixin" => "openclaw-weixin",
        _ => platform,
    }
}

fn platform_list_id(platform: &str) -> &str {
    match platform {
        "dingtalk-connector" => "dingtalk",
        "openclaw-weixin" => "weixin",
        _ => platform,
    }
}

fn ensure_chat_completions_enabled(cfg: &mut Value) -> Result<(), String> {
    let root = cfg.as_object_mut().ok_or("配置格式错误")?;
    let gateway = root.entry("gateway").or_insert_with(|| json!({}));
    let gateway_obj = gateway.as_object_mut().ok_or("gateway 节点格式错误")?;
    let http = gateway_obj.entry("http").or_insert_with(|| json!({}));
    let http_obj = http.as_object_mut().ok_or("gateway.http 节点格式错误")?;
    let endpoints = http_obj.entry("endpoints").or_insert_with(|| json!({}));
    let endpoints_obj = endpoints
        .as_object_mut()
        .ok_or("gateway.http.endpoints 节点格式错误")?;
    let chat = endpoints_obj
        .entry("chatCompletions")
        .or_insert_with(|| json!({}));
    let chat_obj = chat
        .as_object_mut()
        .ok_or("gateway.http.endpoints.chatCompletions 节点格式错误")?;
    chat_obj.insert("enabled".into(), Value::Bool(true));
    Ok(())
}

fn gateway_auth_mode(cfg: &Value) -> Option<&str> {
    cfg.get("gateway")
        .and_then(|g| g.get("auth"))
        .and_then(|a| a.get("mode"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
}

fn gateway_auth_value(cfg: &Value, key: &str) -> Option<String> {
    cfg.get("gateway")
        .and_then(|g| g.get("auth"))
        .and_then(|a| a.get(key))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
}

fn qqbot_channel_has_credentials(val: &Value) -> bool {
    val.get("appId")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.trim().is_empty())
        || val
            .get("clientSecret")
            .or_else(|| val.get("appSecret"))
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.trim().is_empty())
        || val
            .get("token")
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.trim().is_empty())
}

fn gateway_listen_port() -> u16 {
    super::gateway_listen_port()
}

/// 读取指定平台的当前配置（从 openclaw.json 中提取表单可用的值）
#[tauri::command]
pub async fn read_platform_config(
    platform: String,
    account_id: Option<String>,
) -> Result<Value, String> {
    let cfg = super::config::load_openclaw_json()?;
    let storage_key = platform_storage_key(&platform);

    let mut form = Map::new();
    let channel_root = cfg.get("channels").and_then(|c| c.get(storage_key));
    let saved = match (&account_id, channel_root) {
        (Some(acct), Some(ch)) if !acct.trim().is_empty() => ch
            .get("accounts")
            .and_then(|a| a.get(acct.as_str()))
            .cloned()
            .or_else(|| {
                ch.get("appId")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|_| ch.clone())
            })
            .unwrap_or(Value::Null),
        (_, Some(ch)) => ch.clone(),
        _ => Value::Null,
    };
    let exists = !saved.is_null();

    match platform.as_str() {
        "discord" => {
            if saved.is_null() {
                return Ok(json!({ "exists": false }));
            }
            // Discord 配置在 openclaw.json 中是展开的 guilds 结构
            // 需要反向提取成表单字段：token, guildId, channelId
            if let Some(t) = saved.get("token").and_then(|v| v.as_str()) {
                form.insert("token".into(), Value::String(t.into()));
            }
            if let Some(guilds) = saved.get("guilds").and_then(|v| v.as_object()) {
                if let Some(gid) = guilds.keys().next() {
                    form.insert("guildId".into(), Value::String(gid.clone()));
                    if let Some(channels) = guilds[gid].get("channels").and_then(|v| v.as_object())
                    {
                        let cids: Vec<&String> =
                            channels.keys().filter(|k| k.as_str() != "*").collect();
                        if let Some(cid) = cids.first() {
                            form.insert("channelId".into(), Value::String((*cid).clone()));
                        }
                    }
                }
            }
        }
        "telegram" => {
            if saved.is_null() {
                return Ok(json!({ "exists": false }));
            }
            // Telegram: botToken 直接保存, allowFrom 数组需要拼回逗号字符串
            if let Some(t) = saved.get("botToken").and_then(|v| v.as_str()) {
                form.insert("botToken".into(), Value::String(t.into()));
            }
            if let Some(arr) = saved.get("allowFrom").and_then(|v| v.as_array()) {
                let users: Vec<&str> = arr.iter().filter_map(|v| v.as_str()).collect();
                form.insert("allowedUsers".into(), Value::String(users.join(", ")));
            }
        }
        "qqbot" => {
            let qqbot_val: &Value = match (&account_id, channel_root) {
                (Some(acct), Some(ch)) if !acct.trim().is_empty() => ch
                    .get("accounts")
                    .and_then(|a| a.get(acct.as_str()))
                    .filter(|v| !v.is_null())
                    .unwrap_or(&Value::Null),
                (_, Some(ch)) => {
                    if qqbot_channel_has_credentials(ch) {
                        ch
                    } else {
                        ch.get("accounts")
                            .and_then(|a| a.get(QQBOT_DEFAULT_ACCOUNT_ID))
                            .filter(|v| !v.is_null())
                            .unwrap_or(ch)
                    }
                }
                _ => &Value::Null,
            };

            let mut app_id_val: Option<&str> = qqbot_val
                .get("appId")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty());
            let mut client_secret_val: Option<&str> = qqbot_val
                .get("clientSecret")
                .or_else(|| qqbot_val.get("appSecret"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty());
            if (app_id_val.is_none() || client_secret_val.is_none())
                && qqbot_val.get("token").and_then(|v| v.as_str()).is_some()
            {
                if let Some(token) = qqbot_val.get("token").and_then(|v| v.as_str()) {
                    if let Some((aid, secret)) = token.split_once(':') {
                        if app_id_val.is_none() {
                            app_id_val = Some(aid.trim());
                        }
                        if client_secret_val.is_none() {
                            client_secret_val = Some(secret.trim());
                        }
                    }
                }
            }

            if app_id_val.is_none() && client_secret_val.is_none() {
                return Ok(json!({ "exists": false }));
            }
            if let Some(v) = app_id_val {
                form.insert("appId".into(), Value::String(v.into()));
            }
            if let Some(v) = client_secret_val {
                form.insert("clientSecret".into(), Value::String(v.into()));
            }
            return Ok(json!({ "exists": true, "values": Value::Object(form) }));
        }
        "feishu" => {
            if let Some(v) = saved.get("appId").and_then(|v| v.as_str()) {
                form.insert("appId".into(), Value::String(v.into()));
            }
            if let Some(v) = saved.get("appSecret").and_then(|v| v.as_str()) {
                form.insert("appSecret".into(), Value::String(v.into()));
            }
            let shared_root = channel_root.unwrap_or(&saved);
            if let Some(v) = shared_root.get("domain").and_then(|v| v.as_str()) {
                form.insert("domain".into(), Value::String(v.into()));
            }
        }
        "dingtalk" | "dingtalk-connector" => {
            if let Some(v) = saved.get("clientId").and_then(|v| v.as_str()) {
                form.insert("clientId".into(), Value::String(v.into()));
            }
            if let Some(v) = saved.get("clientSecret").and_then(|v| v.as_str()) {
                form.insert("clientSecret".into(), Value::String(v.into()));
            }
            if let Some(v) = saved.get("gatewayToken").and_then(|v| v.as_str()) {
                form.insert("gatewayToken".into(), Value::String(v.into()));
            }
            if let Some(v) = saved.get("gatewayPassword").and_then(|v| v.as_str()) {
                form.insert("gatewayPassword".into(), Value::String(v.into()));
            }
            match gateway_auth_mode(&cfg) {
                Some("token") => {
                    if let Some(v) = gateway_auth_value(&cfg, "token") {
                        form.insert("gatewayToken".into(), Value::String(v));
                    }
                    form.remove("gatewayPassword");
                }
                Some("password") => {
                    if let Some(v) = gateway_auth_value(&cfg, "password") {
                        form.insert("gatewayPassword".into(), Value::String(v));
                    }
                    form.remove("gatewayToken");
                }
                _ => {}
            }
        }
        _ => {
            if saved.is_null() {
                return Ok(json!({ "exists": false }));
            }
            // 通用：原样返回字符串类型字段
            if let Some(obj) = saved.as_object() {
                for (k, v) in obj {
                    if k == "enabled" {
                        continue;
                    }
                    if let Some(s) = v.as_str() {
                        form.insert(k.clone(), Value::String(s.into()));
                    }
                }
            }
        }
    }

    Ok(json!({ "exists": exists, "values": Value::Object(form) }))
}

/// 保存平台配置到 openclaw.json
/// 前端传入的是表单字段，后端负责转换成 OpenClaw 要求的结构
#[tauri::command]
pub async fn save_messaging_platform(
    platform: String,
    form: Value,
    account_id: Option<String>,
    agent_id: Option<String>,
    original_account_id: Option<String>,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    let mut cfg = super::config::load_openclaw_json()?;
    let storage_key = platform_storage_key(&platform).to_string();

    let channels = cfg
        .as_object_mut()
        .ok_or("配置格式错误")?
        .entry("channels")
        .or_insert_with(|| json!({}));
    let channels_map = channels.as_object_mut().ok_or("channels 节点格式错误")?;

    let form_obj = form.as_object().ok_or("表单数据格式错误")?;
    let saved_account_id = account_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let original_saved_account_id = original_account_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    match platform.as_str() {
        "discord" => {
            let mut entry = Map::new();

            // Bot Token
            if let Some(t) = form_obj.get("token").and_then(|v| v.as_str()) {
                entry.insert("token".into(), Value::String(t.trim().into()));
            }
            entry.insert("enabled".into(), Value::Bool(true));
            entry.insert("groupPolicy".into(), Value::String("allowlist".into()));
            entry.insert("dm".into(), json!({ "enabled": false }));
            entry.insert(
                "retry".into(),
                json!({
                    "attempts": 3,
                    "minDelayMs": 500,
                    "maxDelayMs": 30000,
                    "jitter": 0.1
                }),
            );

            // guildId + channelId 展开为 guilds 嵌套结构
            let guild_id = form_obj
                .get("guildId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if !guild_id.is_empty() {
                let channel_id = form_obj
                    .get("channelId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string();
                let channel_key = if channel_id.is_empty() {
                    "*".to_string()
                } else {
                    channel_id
                };
                entry.insert(
                    "guilds".into(),
                    json!({
                        guild_id: {
                            "users": ["*"],
                            "requireMention": true,
                            "channels": {
                                channel_key: { "allow": true, "requireMention": true }
                            }
                        }
                    }),
                );
            }

            channels_map.insert("discord".into(), Value::Object(entry));
        }
        "telegram" => {
            let mut entry = Map::new();

            if let Some(t) = form_obj.get("botToken").and_then(|v| v.as_str()) {
                entry.insert("botToken".into(), Value::String(t.trim().into()));
            }
            entry.insert("enabled".into(), Value::Bool(true));

            // allowedUsers 逗号字符串 → allowFrom 数组
            if let Some(users_str) = form_obj.get("allowedUsers").and_then(|v| v.as_str()) {
                let users: Vec<Value> = users_str
                    .split(',')
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| Value::String(s.into()))
                    .collect();
                if !users.is_empty() {
                    entry.insert("allowFrom".into(), Value::Array(users));
                }
            }

            channels_map.insert("telegram".into(), Value::Object(entry));
        }
        "qqbot" => {
            let app_id = form_obj
                .get("appId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let client_secret = form_obj
                .get("clientSecret")
                .or_else(|| form_obj.get("appSecret"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();

            if app_id.is_empty() {
                return Err("AppID 不能为空".into());
            }
            if client_secret.is_empty() {
                return Err("ClientSecret 不能为空".into());
            }

            let token = format!("{}:{}", app_id, client_secret);
            let acct_key = saved_account_id
                .as_deref()
                .unwrap_or(QQBOT_DEFAULT_ACCOUNT_ID);
            let qqbot_node = channels_map
                .entry("qqbot")
                .or_insert_with(|| json!({ "enabled": true }));
            let qqbot_obj = qqbot_node.as_object_mut().ok_or("qqbot 节点格式错误")?;
            qqbot_obj.insert("enabled".into(), Value::Bool(true));
            qqbot_obj.remove("appId");
            qqbot_obj.remove("clientSecret");
            qqbot_obj.remove("appSecret");
            qqbot_obj.remove("token");
            let accounts = qqbot_obj.entry("accounts").or_insert_with(|| json!({}));
            let accounts_obj = accounts.as_object_mut().ok_or("accounts 格式错误")?;

            let mut entry = Map::new();
            entry.insert("appId".into(), Value::String(app_id));
            entry.insert("clientSecret".into(), Value::String(client_secret));
            entry.insert("token".into(), Value::String(token));
            entry.insert("enabled".into(), Value::Bool(true));
            accounts_obj.insert(acct_key.to_string(), Value::Object(entry));
            if let Some(original_acct) = original_saved_account_id.as_deref() {
                if original_acct != acct_key {
                    accounts_obj.remove(original_acct);
                }
            }

            ensure_openclaw_qqbot_plugin(&mut cfg)?;
            ensure_chat_completions_enabled(&mut cfg)?;
            let _ = cleanup_legacy_plugin_backup_dir("qqbot");
            let _ = cleanup_legacy_plugin_backup_dir(OPENCLAW_QQBOT_EXTENSION_FOLDER);
        }
        "feishu" => {
            let app_id = form_obj
                .get("appId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let app_secret = form_obj
                .get("appSecret")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();

            if app_id.is_empty() || app_secret.is_empty() {
                return Err("App ID 和 App Secret 不能为空".into());
            }

            let mut entry = Map::new();
            entry.insert("appId".into(), Value::String(app_id));
            entry.insert("appSecret".into(), Value::String(app_secret));
            entry.insert("enabled".into(), Value::Bool(true));
            entry.insert("connectionMode".into(), Value::String("websocket".into()));

            // 域名（默认 feishu，国际版选 lark）
            let domain = form_obj
                .get("domain")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if !domain.is_empty() {
                entry.insert("domain".into(), Value::String(domain));
            }

            if let Some(acct) = saved_account_id.as_deref() {
                let feishu = channels_map
                    .entry(storage_key.clone())
                    .or_insert_with(|| json!({ "enabled": true }));
                let feishu_obj = feishu.as_object_mut().ok_or("飞书节点格式错误")?;
                feishu_obj.insert("enabled".into(), Value::Bool(true));
                if let Some(domain_value) = entry.get("domain").cloned() {
                    feishu_obj.insert("domain".into(), domain_value);
                }
                feishu_obj.insert("connectionMode".into(), Value::String("websocket".into()));
                let accounts = feishu_obj.entry("accounts").or_insert_with(|| json!({}));
                let accounts_obj = accounts.as_object_mut().ok_or("accounts 格式错误")?;
                let mut account_entry = entry;
                account_entry.remove("domain");
                account_entry.remove("connectionMode");
                accounts_obj.insert(acct.to_string(), Value::Object(account_entry));
                if let Some(original_acct) = original_saved_account_id.as_deref() {
                    if original_acct != acct {
                        accounts_obj.remove(original_acct);
                    }
                }
            } else {
                channels_map.insert("feishu".into(), Value::Object(entry));
            }
            ensure_plugin_allowed(&mut cfg, "openclaw-lark")?;
            disable_legacy_plugin(&mut cfg, "feishu");
            let _ = cleanup_legacy_plugin_backup_dir("feishu");
            let _ = cleanup_legacy_plugin_backup_dir("openclaw-lark");
        }
        "dingtalk" | "dingtalk-connector" => {
            let client_id = form_obj
                .get("clientId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let client_secret = form_obj
                .get("clientSecret")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();

            if client_id.is_empty() || client_secret.is_empty() {
                return Err("Client ID 和 Client Secret 不能为空".into());
            }

            let mut entry = Map::new();
            entry.insert("clientId".into(), Value::String(client_id));
            entry.insert("clientSecret".into(), Value::String(client_secret));
            entry.insert("enabled".into(), Value::Bool(true));

            let gateway_token = form_obj
                .get("gatewayToken")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if !gateway_token.is_empty() {
                entry.insert("gatewayToken".into(), Value::String(gateway_token.into()));
            }

            let gateway_password = form_obj
                .get("gatewayPassword")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if !gateway_password.is_empty() {
                entry.insert(
                    "gatewayPassword".into(),
                    Value::String(gateway_password.into()),
                );
            }

            channels_map.insert(storage_key, Value::Object(entry));
            ensure_plugin_allowed(&mut cfg, "dingtalk-connector")?;
            ensure_chat_completions_enabled(&mut cfg)?;
            let _ = cleanup_legacy_plugin_backup_dir("dingtalk-connector");
        }
        _ => {
            // 通用平台：直接保存表单字段
            let mut entry = Map::new();
            for (k, v) in form_obj {
                entry.insert(k.clone(), v.clone());
            }
            entry.insert("enabled".into(), Value::Bool(true));
            channels_map.insert(storage_key, Value::Object(entry));
        }
    }

    if let Some(agent) = agent_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        create_agent_binding(
            &mut cfg,
            agent,
            platform_storage_key(&platform),
            saved_account_id.clone(),
        )?;
    }

    // 写回配置并重载 Gateway
    super::config::save_openclaw_json(&cfg)?;

    // Gateway 重载在后台进行，不阻塞 UI 响应
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = super::config::do_reload_gateway(&app2).await;
    });

    Ok(json!({ "ok": true }))
}

/// 删除指定平台配置
#[tauri::command]
pub async fn remove_messaging_platform(
    platform: String,
    account_id: Option<String>,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    let mut cfg = super::config::load_openclaw_json()?;
    let storage_key = platform_storage_key(&platform);

    match account_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(acct) => {
            if let Some(channel) = cfg.get_mut("channels").and_then(|c| c.get_mut(storage_key)) {
                if let Some(accounts) = channel.get_mut("accounts").and_then(|a| a.as_object_mut())
                {
                    accounts.remove(acct);
                }
            }
        }
        None => {
            if let Some(channels) = cfg.get_mut("channels").and_then(|c| c.as_object_mut()) {
                channels.remove(storage_key);
            }
        }
    }

    if let Some(bindings) = cfg.get_mut("bindings").and_then(|b| b.as_array_mut()) {
        let binding_channel = platform_storage_key(&platform);
        bindings.retain(|binding| {
            let Some(match_obj) = binding.get("match").and_then(|m| m.as_object()) else {
                return true;
            };
            if match_obj.get("channel").and_then(|v| v.as_str()) != Some(binding_channel) {
                return true;
            }
            match account_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                Some(acct) => match_obj.get("accountId").and_then(|v| v.as_str()) != Some(acct),
                None => false,
            }
        });
    }

    super::config::save_openclaw_json(&cfg)?;
    // Gateway 重载在后台进行，不阻塞 UI 响应
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = super::config::do_reload_gateway(&app2).await;
    });

    Ok(json!({ "ok": true }))
}

/// 切换平台启用/禁用
#[tauri::command]
pub async fn toggle_messaging_platform(
    platform: String,
    enabled: bool,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    let mut cfg = super::config::load_openclaw_json()?;
    let storage_key = platform_storage_key(&platform);

    if let Some(entry) = cfg
        .get_mut("channels")
        .and_then(|c| c.get_mut(storage_key))
        .and_then(|v| v.as_object_mut())
    {
        entry.insert("enabled".into(), Value::Bool(enabled));
    } else {
        return Err(format!("平台 {} 未配置", platform));
    }

    super::config::save_openclaw_json(&cfg)?;
    // Gateway 重载在后台进行，不阻塞 UI 响应
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = super::config::do_reload_gateway(&app2).await;
    });

    Ok(json!({ "ok": true }))
}

/// 在线校验 Bot 凭证（调用平台 API 验证 Token 是否有效）
#[tauri::command]
pub async fn verify_bot_token(platform: String, form: Value) -> Result<Value, String> {
    let form_obj = form.as_object().ok_or("表单数据格式错误")?;
    let client = super::build_http_client(std::time::Duration::from_secs(15), None)
        .map_err(|e| format!("HTTP 客户端初始化失败: {}", e))?;

    match platform.as_str() {
        "discord" => verify_discord(&client, form_obj).await,
        "telegram" => verify_telegram(&client, form_obj).await,
        "qqbot" => verify_qqbot(&client, form_obj).await,
        "feishu" => verify_feishu(&client, form_obj).await,
        "dingtalk" | "dingtalk-connector" => verify_dingtalk(&client, form_obj).await,
        _ => Ok(json!({
            "valid": true,
            "warnings": ["该平台暂不支持在线校验"]
        })),
    }
}

/// 列出当前已配置的平台清单
#[tauri::command]
pub async fn list_configured_platforms() -> Result<Value, String> {
    let cfg = super::config::load_openclaw_json()?;
    let mut result: Vec<Value> = vec![];

    if let Some(channels) = cfg.get("channels").and_then(|c| c.as_object()) {
        for (name, val) in channels {
            let enabled = val.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
            let mut accounts: Vec<Value> = vec![];
            if let Some(accts) = val.get("accounts").and_then(|a| a.as_object()) {
                for (acct_id, acct_val) in accts {
                    let mut entry = json!({ "accountId": acct_id });
                    if let Some(app_id) = acct_val.get("appId").and_then(|v| v.as_str()) {
                        entry["appId"] = Value::String(app_id.to_string());
                    }
                    accounts.push(entry);
                }
            }
            result.push(json!({
                "id": platform_list_id(name),
                "enabled": enabled,
                "accounts": accounts
            }));
        }
    }

    Ok(json!(result))
}

#[tauri::command]
pub async fn get_channel_plugin_status(plugin_id: String) -> Result<Value, String> {
    let plugin_id = plugin_id.trim();
    if plugin_id.is_empty() {
        return Err("plugin_id 不能为空".into());
    }

    let plugin_dir = if plugin_id == OPENCLAW_QQBOT_PLUGIN_ID {
        let preferred = generic_plugin_dir(OPENCLAW_QQBOT_EXTENSION_FOLDER);
        if preferred.is_dir() && plugin_install_marker_exists(&preferred) {
            preferred
        } else {
            qqbot_plugin_dir()
        }
    } else {
        generic_plugin_dir(plugin_id)
    };
    let installed = plugin_dir.is_dir() && plugin_install_marker_exists(&plugin_dir);
    let legacy_backup_detected = legacy_plugin_backup_dir(plugin_id).exists()
        || (plugin_id == OPENCLAW_QQBOT_PLUGIN_ID
            && legacy_plugin_backup_dir(OPENCLAW_QQBOT_EXTENSION_FOLDER).exists());

    // 检测插件是否为 OpenClaw 内置（新版 openclaw/openclaw-zh 打包了 feishu 等插件）
    let builtin = is_plugin_builtin(plugin_id);

    let cfg = super::config::load_openclaw_json().unwrap_or_else(|_| json!({}));
    let allowed = cfg
        .get("plugins")
        .and_then(|p| p.get("allow"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().any(|v| v.as_str() == Some(plugin_id)))
        .unwrap_or(false);
    let enabled = cfg
        .get("plugins")
        .and_then(|p| p.get("entries"))
        .and_then(|e| e.get(plugin_id))
        .and_then(|entry| entry.get("enabled"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    Ok(json!({
        "installed": installed,
        "builtin": builtin,
        "path": plugin_dir.to_string_lossy(),
        "allowed": allowed,
        "enabled": enabled,
        "legacyBackupDetected": legacy_backup_detected
    }))
}

// ── Discord 凭证校验 ──────────────────────────────────────

async fn verify_discord(
    client: &reqwest::Client,
    form: &Map<String, Value>,
) -> Result<Value, String> {
    let token = form
        .get("token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if token.is_empty() {
        return Ok(json!({ "valid": false, "errors": ["Bot Token 不能为空"] }));
    }

    // 验证 Bot Token
    let me_resp = client
        .get("https://discord.com/api/v10/users/@me")
        .header("Authorization", format!("Bot {}", token))
        .send()
        .await
        .map_err(|e| format!("Discord API 连接失败: {}", e))?;

    if me_resp.status() == 401 {
        return Ok(json!({ "valid": false, "errors": ["Bot Token 无效，请检查后重试"] }));
    }
    if !me_resp.status().is_success() {
        return Ok(json!({
            "valid": false,
            "errors": [format!("Discord API 返回异常: {}", me_resp.status())]
        }));
    }

    let me: Value = me_resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;
    if me.get("bot").and_then(|v| v.as_bool()) != Some(true) {
        return Ok(json!({
            "valid": false,
            "errors": ["提供的 Token 不属于 Bot 账号，请使用 Bot Token"]
        }));
    }

    let bot_name = me
        .get("username")
        .and_then(|v| v.as_str())
        .unwrap_or("未知");
    let mut details = vec![format!("Bot: @{}", bot_name)];

    // 验证 Guild（可选）
    let guild_id = form
        .get("guildId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if !guild_id.is_empty() {
        match client
            .get(format!("https://discord.com/api/v10/guilds/{}", guild_id))
            .header("Authorization", format!("Bot {}", token))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                let guild: Value = resp.json().await.unwrap_or_default();
                let name = guild.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                details.push(format!("服务器: {}", name));
            }
            Ok(resp) if resp.status().as_u16() == 403 || resp.status().as_u16() == 404 => {
                return Ok(json!({
                    "valid": false,
                    "errors": [format!("无法访问服务器 {}，请确认 Bot 已加入该服务器", guild_id)]
                }));
            }
            _ => {
                details.push("服务器 ID 未能验证（网络问题）".into());
            }
        }
    }

    Ok(json!({
        "valid": true,
        "errors": [],
        "details": details
    }))
}

// ── QQ Bot 凭证校验 ──────────────────────────────────────

async fn verify_qqbot(
    client: &reqwest::Client,
    form: &Map<String, Value>,
) -> Result<Value, String> {
    let app_id = form
        .get("appId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let client_secret = form
        .get("clientSecret")
        .or_else(|| form.get("appSecret"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    if app_id.is_empty() {
        return Ok(json!({ "valid": false, "errors": ["AppID 不能为空"] }));
    }
    if client_secret.is_empty() {
        return Ok(json!({ "valid": false, "errors": ["ClientSecret 不能为空"] }));
    }

    // 通过 QQ Bot API 获取 access_token 验证凭证
    let resp = client
        .post("https://bots.qq.com/app/getAppAccessToken")
        .json(&json!({
            "appId": app_id,
            "clientSecret": client_secret
        }))
        .send()
        .await
        .map_err(|e| format!("QQ Bot API 连接失败: {}", e))?;

    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    if body.get("access_token").and_then(|v| v.as_str()).is_some() {
        Ok(json!({
            "valid": true,
            "errors": [],
            "details": [format!("AppID: {}", app_id)]
        }))
    } else {
        let msg = body
            .get("message")
            .or_else(|| body.get("msg"))
            .and_then(|v| v.as_str())
            .unwrap_or("凭证无效，请检查 AppID 和 AppSecret");
        Ok(json!({
            "valid": false,
            "errors": [msg]
        }))
    }
}

fn ensure_plugin_allowed(cfg: &mut Value, plugin_id: &str) -> Result<(), String> {
    let root = cfg.as_object_mut().ok_or("配置格式错误")?;
    let plugins = root.entry("plugins").or_insert_with(|| json!({}));
    let plugins_map = plugins.as_object_mut().ok_or("plugins 节点格式错误")?;

    let allow = plugins_map.entry("allow").or_insert_with(|| json!([]));
    let allow_arr = allow.as_array_mut().ok_or("plugins.allow 节点格式错误")?;
    if !allow_arr.iter().any(|v| v.as_str() == Some(plugin_id)) {
        allow_arr.push(Value::String(plugin_id.to_string()));
    }

    let entries = plugins_map.entry("entries").or_insert_with(|| json!({}));
    let entries_map = entries
        .as_object_mut()
        .ok_or("plugins.entries 节点格式错误")?;
    let entry = entries_map
        .entry(plugin_id.to_string())
        .or_insert_with(|| json!({}));
    let entry_obj = entry
        .as_object_mut()
        .ok_or("plugins.entries 条目格式错误")?;
    entry_obj.insert("enabled".into(), Value::Bool(true));
    Ok(())
}

fn disable_legacy_plugin(cfg: &mut Value, plugin_id: &str) {
    if let Some(root) = cfg.as_object_mut() {
        if let Some(plugins) = root.get_mut("plugins").and_then(|p| p.as_object_mut()) {
            if let Some(allow) = plugins.get_mut("allow").and_then(|a| a.as_array_mut()) {
                allow.retain(|v| v.as_str() != Some(plugin_id));
            }
            if let Some(entries) = plugins.get_mut("entries").and_then(|e| e.as_object_mut()) {
                if let Some(entry) = entries.get_mut(plugin_id).and_then(|v| v.as_object_mut()) {
                    entry.insert("enabled".into(), Value::Bool(false));
                }
            }
        }
    }
}

fn strip_legacy_qqbot_plugin_config_keys(cfg: &mut Value) {
    let Some(plugins) = cfg.get_mut("plugins").and_then(|p| p.as_object_mut()) else {
        return;
    };
    if let Some(allow) = plugins.get_mut("allow").and_then(|a| a.as_array_mut()) {
        allow.retain(|v| v.as_str() != Some(OPENCLAW_QQBOT_EXTENSION_FOLDER));
    }
}

fn ensure_openclaw_qqbot_plugin(cfg: &mut Value) -> Result<(), String> {
    strip_legacy_qqbot_plugin_config_keys(cfg);
    ensure_plugin_allowed(cfg, OPENCLAW_QQBOT_PLUGIN_ID)
}

fn qqbot_plugins_allow_flags(cfg: &Value) -> (bool, bool) {
    let allow = cfg
        .get("plugins")
        .and_then(|p| p.get("allow"))
        .and_then(|v| v.as_array());
    let allow_qqbot = allow
        .map(|items| {
            items
                .iter()
                .any(|v| v.as_str() == Some(OPENCLAW_QQBOT_PLUGIN_ID))
        })
        .unwrap_or(false);
    let allow_legacy = allow
        .map(|items| {
            items
                .iter()
                .any(|v| v.as_str() == Some(OPENCLAW_QQBOT_EXTENSION_FOLDER))
        })
        .unwrap_or(false);
    (allow_qqbot, allow_legacy)
}

fn qqbot_extension_installed() -> (bool, Option<String>) {
    let preferred = generic_plugin_dir(OPENCLAW_QQBOT_EXTENSION_FOLDER);
    if preferred.is_dir() && plugin_install_marker_exists(&preferred) {
        return (true, Some(preferred.to_string_lossy().to_string()));
    }
    let legacy = qqbot_plugin_dir();
    if legacy.is_dir() && plugin_install_marker_exists(&legacy) {
        return (true, Some(legacy.to_string_lossy().to_string()));
    }
    (false, None)
}

fn qqbot_entry_enabled_ok(cfg: &Value, plugin_id: &str) -> bool {
    let has_entry = cfg
        .get("plugins")
        .and_then(|p| p.get("entries"))
        .and_then(|e| e.get(plugin_id))
        .is_some();
    if !has_entry {
        return true;
    }
    cfg.get("plugins")
        .and_then(|p| p.get("entries"))
        .and_then(|e| e.get(plugin_id))
        .and_then(|entry| entry.get("enabled"))
        .and_then(|v| v.as_bool())
        != Some(false)
}

fn qqbot_plugin_diagnose(cfg: &Value) -> (bool, String) {
    let (installed, location) = qqbot_extension_installed();
    let (allow_qqbot, allow_legacy) = qqbot_plugins_allow_flags(cfg);
    let entry_ok = qqbot_entry_enabled_ok(cfg, OPENCLAW_QQBOT_PLUGIN_ID);
    let plugin_ok = installed && allow_qqbot && entry_ok;
    let mut detail = format!(
        "本地扩展：{}（目录：{}）；plugins.allow：qqbot={}、误识别 openclaw-qqbot={}；plugins.entries.qqbot 未禁用={}",
        if installed {
            "已检测到插件文件"
        } else {
            "未检测到（~/.openclaw/extensions/openclaw-qqbot 或旧版 …/qqbot）"
        },
        location.as_deref().unwrap_or("—"),
        allow_qqbot,
        allow_legacy,
        entry_ok
    );
    if allow_legacy && !allow_qqbot {
        detail.push_str("。plugins.allow 仅有 openclaw-qqbot 不够，需包含 qqbot。");
    } else if installed && allow_qqbot && !entry_ok {
        detail.push_str("。plugins.entries.qqbot 已存在但被禁用，请启用后重试。");
    }
    (plugin_ok, detail)
}

fn plugin_backup_root() -> PathBuf {
    super::openclaw_dir()
        .join("backups")
        .join("plugin-installs")
}

fn qqbot_plugin_dir() -> PathBuf {
    super::openclaw_dir().join("extensions").join("qqbot")
}

fn legacy_plugin_backup_dir(plugin_id: &str) -> PathBuf {
    super::openclaw_dir()
        .join("extensions")
        .join(format!("{plugin_id}.__clawpanel_backup"))
}

fn cleanup_legacy_plugin_backup_dir(plugin_id: &str) -> Result<bool, String> {
    let legacy_backup = legacy_plugin_backup_dir(plugin_id);
    if !legacy_backup.exists() {
        return Ok(false);
    }
    if legacy_backup.is_dir() {
        fs::remove_dir_all(&legacy_backup).map_err(|e| format!("清理旧版插件备份失败: {e}"))?;
    } else {
        fs::remove_file(&legacy_backup).map_err(|e| format!("清理旧版插件备份失败: {e}"))?;
    }
    Ok(true)
}

fn plugin_install_marker_exists(plugin_dir: &Path) -> bool {
    plugin_dir.join("package.json").is_file()
        || plugin_dir.join("plugin.ts").is_file()
        || plugin_dir.join("index.js").is_file()
        || plugin_dir.join("dist").join("index.js").is_file()
}

fn restore_path(backup: &Path, target: &Path) -> Result<(), String> {
    if target.exists() {
        if target.is_dir() {
            fs::remove_dir_all(target).map_err(|e| format!("清理目录失败: {e}"))?;
        } else {
            fs::remove_file(target).map_err(|e| format!("清理文件失败: {e}"))?;
        }
    }
    if backup.exists() {
        fs::rename(backup, target).map_err(|e| format!("恢复备份失败: {e}"))?;
    }
    Ok(())
}

fn cleanup_failed_extension_install(
    plugin_dir: &Path,
    plugin_backup: &Path,
    config_backup: &Path,
    had_plugin_backup: bool,
    had_config_backup: bool,
) -> Result<(), String> {
    let config_path = super::openclaw_dir().join("openclaw.json");

    if plugin_dir.exists() {
        fs::remove_dir_all(plugin_dir).map_err(|e| format!("清理坏插件目录失败: {e}"))?;
    }
    if had_plugin_backup {
        restore_path(plugin_backup, plugin_dir)?;
    } else if plugin_backup.exists() {
        fs::remove_dir_all(plugin_backup).map_err(|e| format!("清理插件备份失败: {e}"))?;
    }

    if had_config_backup {
        restore_path(config_backup, &config_path)?;
    } else if config_backup.exists() {
        fs::remove_file(config_backup).map_err(|e| format!("清理配置备份失败: {e}"))?;
    }

    Ok(())
}

/// 检测插件是否为 OpenClaw 内置（作为 npm 依赖打包在 openclaw/openclaw-zh 中）
fn is_plugin_builtin(plugin_id: &str) -> bool {
    // 插件 ID → npm 包名映射
    let pkg_name = match plugin_id {
        "feishu" => "@openclaw/feishu",
        "openclaw-lark" => "@larksuite/openclaw-lark",
        "dingtalk-connector" => "@dingtalk-real-ai/dingtalk-connector",
        _ => return false,
    };
    // 在全局 npm node_modules 中查找 openclaw 安装目录
    let npm_dirs: Vec<PathBuf> = {
        let mut dirs = Vec::new();
        #[cfg(target_os = "windows")]
        if let Some(appdata) = std::env::var_os("APPDATA") {
            let base = PathBuf::from(appdata).join("npm").join("node_modules");
            dirs.push(base.join("@qingchencloud").join("openclaw-zh"));
            dirs.push(base.join("openclaw"));
        }
        #[cfg(target_os = "macos")]
        {
            dirs.push(PathBuf::from(
                "/opt/homebrew/lib/node_modules/@qingchencloud/openclaw-zh",
            ));
            dirs.push(PathBuf::from("/opt/homebrew/lib/node_modules/openclaw"));
            dirs.push(PathBuf::from(
                "/usr/local/lib/node_modules/@qingchencloud/openclaw-zh",
            ));
            dirs.push(PathBuf::from("/usr/local/lib/node_modules/openclaw"));
        }
        #[cfg(target_os = "linux")]
        {
            dirs.push(PathBuf::from(
                "/usr/local/lib/node_modules/@qingchencloud/openclaw-zh",
            ));
            dirs.push(PathBuf::from("/usr/local/lib/node_modules/openclaw"));
            dirs.push(PathBuf::from(
                "/usr/lib/node_modules/@qingchencloud/openclaw-zh",
            ));
            dirs.push(PathBuf::from("/usr/lib/node_modules/openclaw"));
        }
        dirs
    };
    // 插件包名拆分成路径片段，如 @openclaw/feishu → @openclaw/feishu
    let pkg_path: PathBuf = pkg_name.split('/').collect();
    for base in &npm_dirs {
        let candidate = base.join("node_modules").join(&pkg_path);
        if candidate.join("package.json").is_file() {
            return true;
        }
    }
    false
}

fn generic_plugin_dir(plugin_id: &str) -> PathBuf {
    super::openclaw_dir().join("extensions").join(plugin_id)
}

fn generic_plugin_backup_dir(plugin_id: &str) -> PathBuf {
    plugin_backup_root().join(format!("{plugin_id}.__clawpanel_backup"))
}

fn generic_plugin_config_backup_path(plugin_id: &str) -> PathBuf {
    plugin_backup_root().join(format!("openclaw.{plugin_id}-install.bak"))
}

fn cleanup_failed_plugin_install(
    plugin_id: &str,
    had_plugin_backup: bool,
    had_config_backup: bool,
) -> Result<(), String> {
    let plugin_dir = generic_plugin_dir(plugin_id);
    let plugin_backup = generic_plugin_backup_dir(plugin_id);
    let config_path = super::openclaw_dir().join("openclaw.json");
    let config_backup = generic_plugin_config_backup_path(plugin_id);

    if plugin_dir.exists() {
        fs::remove_dir_all(&plugin_dir).map_err(|e| format!("清理坏插件目录失败: {e}"))?;
    }
    if had_plugin_backup {
        restore_path(&plugin_backup, &plugin_dir)?;
    } else if plugin_backup.exists() {
        fs::remove_dir_all(&plugin_backup).map_err(|e| format!("清理插件备份失败: {e}"))?;
    }

    if had_config_backup {
        restore_path(&config_backup, &config_path)?;
    } else if config_backup.exists() {
        fs::remove_file(&config_backup).map_err(|e| format!("清理配置备份失败: {e}"))?;
    }

    Ok(())
}

// ── QQ Bot 插件安装（带日志流） ──────────────────────────

#[tauri::command]
pub async fn install_channel_plugin(
    app: tauri::AppHandle,
    package_name: String,
    plugin_id: String,
) -> Result<String, String> {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;
    use tauri::Emitter;

    let package_name = package_name.trim();
    let plugin_id = plugin_id.trim();
    if package_name.is_empty() || plugin_id.is_empty() {
        return Err("package_name 和 plugin_id 不能为空".into());
    }
    let plugin_dir = generic_plugin_dir(plugin_id);
    let plugin_backup = generic_plugin_backup_dir(plugin_id);
    let config_path = super::openclaw_dir().join("openclaw.json");
    let config_backup = generic_plugin_config_backup_path(plugin_id);
    let had_existing_plugin = plugin_dir.exists();
    let had_existing_config = config_path.exists();

    let _ = app.emit("plugin-log", format!("正在安装插件 {} ...", package_name));
    let _ = app.emit("plugin-progress", 10);

    fs::create_dir_all(plugin_backup_root()).map_err(|e| format!("创建插件备份目录失败: {e}"))?;
    if cleanup_legacy_plugin_backup_dir(plugin_id)? {
        let _ = app.emit("plugin-log", "已清理旧版插件备份目录");
    }

    if plugin_backup.exists() {
        let _ = fs::remove_dir_all(&plugin_backup);
    }
    if had_existing_plugin {
        fs::rename(&plugin_dir, &plugin_backup).map_err(|e| format!("备份旧插件失败: {e}"))?;
        let _ = app.emit(
            "plugin-log",
            format!("检测到旧插件目录，已备份 {}", plugin_dir.display()),
        );
    }

    if config_backup.exists() {
        let _ = fs::remove_file(&config_backup);
    }
    if had_existing_config {
        fs::copy(&config_path, &config_backup).map_err(|e| format!("备份配置失败: {e}"))?;
    }

    let spawn_result = crate::utils::openclaw_command()
        .args(["plugins", "install", package_name])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match spawn_result {
        Ok(child) => child,
        Err(e) => {
            let _ =
                cleanup_failed_plugin_install(plugin_id, had_existing_plugin, had_existing_config);
            return Err(format!("启动 openclaw 失败: {}", e));
        }
    };

    let stderr = child.stderr.take();
    let app2 = app.clone();
    let handle = std::thread::spawn(move || {
        if let Some(pipe) = stderr {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let _ = app2.emit("plugin-log", &line);
            }
        }
    });

    let _ = app.emit("plugin-progress", 30);
    let mut progress = 30;
    if let Some(pipe) = child.stdout.take() {
        for line in BufReader::new(pipe).lines().map_while(Result::ok) {
            let _ = app.emit("plugin-log", &line);
            if progress < 90 {
                progress += 10;
                let _ = app.emit("plugin-progress", progress);
            }
        }
    }

    let _ = handle.join();
    let _ = app.emit("plugin-progress", 95);

    let status = child
        .wait()
        .map_err(|e| format!("等待安装进程失败: {}", e))?;
    if !status.success() {
        let rollback_err =
            cleanup_failed_plugin_install(plugin_id, had_existing_plugin, had_existing_config)
                .err()
                .unwrap_or_default();
        let _ = app.emit(
            "plugin-log",
            format!("插件 {} 安装失败，已回退", package_name),
        );
        return if rollback_err.is_empty() {
            Err(format!("插件安装失败：{}", package_name))
        } else {
            Err(format!(
                "插件安装失败：{}；回退失败：{}",
                package_name, rollback_err
            ))
        };
    }

    let finalize = (|| -> Result<(), String> {
        let mut cfg = super::config::load_openclaw_json()?;
        ensure_plugin_allowed(&mut cfg, plugin_id)?;
        super::config::save_openclaw_json(&cfg)?;
        Ok(())
    })();

    if let Err(err) = finalize {
        let rollback_err =
            cleanup_failed_plugin_install(plugin_id, had_existing_plugin, had_existing_config)
                .err()
                .unwrap_or_default();
        let _ = app.emit(
            "plugin-log",
            format!("插件 {} 安装后收尾失败，已回退: {}", package_name, err),
        );
        return if rollback_err.is_empty() {
            Err(format!("插件安装失败：{err}"))
        } else {
            Err(format!("插件安装失败：{err}；回退失败：{rollback_err}"))
        };
    }

    if plugin_backup.exists() {
        let _ = fs::remove_dir_all(&plugin_backup);
    }
    if config_backup.exists() {
        let _ = fs::remove_file(&config_backup);
    }
    let _ = app.emit("plugin-progress", 100);
    let _ = app.emit("plugin-log", format!("插件 {} 安装完成", package_name));
    Ok("安装成功".into())
}

#[tauri::command]
pub async fn install_qqbot_plugin(app: tauri::AppHandle) -> Result<String, String> {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;
    use tauri::Emitter;

    let plugin_dir = generic_plugin_dir(OPENCLAW_QQBOT_EXTENSION_FOLDER);
    let plugin_backup = generic_plugin_backup_dir(OPENCLAW_QQBOT_EXTENSION_FOLDER);
    let config_path = super::openclaw_dir().join("openclaw.json");
    let config_backup = generic_plugin_config_backup_path(OPENCLAW_QQBOT_EXTENSION_FOLDER);
    let had_existing_plugin = plugin_dir.exists();
    let had_existing_config = config_path.exists();

    let _ = app.emit(
        "plugin-log",
        format!(
            "正在安装腾讯 OpenClaw QQ 插件 {} ...",
            TENCENT_OPENCLAW_QQBOT_PACKAGE
        ),
    );
    let _ = app.emit("plugin-progress", 10);

    fs::create_dir_all(plugin_backup_root()).map_err(|e| format!("创建插件备份目录失败: {e}"))?;
    if cleanup_legacy_plugin_backup_dir(OPENCLAW_QQBOT_EXTENSION_FOLDER)? {
        let _ = app.emit("plugin-log", "已清理旧版 QQBot 插件备份目录");
    }

    if plugin_backup.exists() {
        let _ = fs::remove_dir_all(&plugin_backup);
    }
    if had_existing_plugin {
        fs::rename(&plugin_dir, &plugin_backup)
            .map_err(|e| format!("备份旧 QQBot 插件失败: {e}"))?;
    }

    if config_backup.exists() {
        let _ = fs::remove_file(&config_backup);
    }
    if had_existing_config {
        fs::copy(&config_path, &config_backup).map_err(|e| format!("备份配置失败: {e}"))?;
    }

    let spawn_result = crate::utils::openclaw_command()
        .args(["plugins", "install", TENCENT_OPENCLAW_QQBOT_PACKAGE])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match spawn_result {
        Ok(child) => child,
        Err(e) => {
            let _ = cleanup_failed_extension_install(
                &plugin_dir,
                &plugin_backup,
                &config_backup,
                had_existing_plugin,
                had_existing_config,
            );
            return Err(format!("启动 openclaw 失败: {}", e));
        }
    };

    let stderr = child.stderr.take();
    let app2 = app.clone();
    let qqbot_stderr_lines = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let qqbot_stderr_clone = qqbot_stderr_lines.clone();
    let handle = std::thread::spawn(move || {
        if let Some(pipe) = stderr {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let _ = app2.emit("plugin-log", &line);
                qqbot_stderr_clone.lock().unwrap().push(line);
            }
        }
    });

    let _ = app.emit("plugin-progress", 30);

    let mut progress = 30;
    let mut qqbot_stdout_lines = Vec::new();
    if let Some(pipe) = child.stdout.take() {
        for line in BufReader::new(pipe).lines().map_while(Result::ok) {
            let _ = app.emit("plugin-log", &line);
            qqbot_stdout_lines.push(line);
            if progress < 90 {
                progress += 10;
                let _ = app.emit("plugin-progress", progress);
            }
        }
    }

    let _ = handle.join();
    let _ = app.emit("plugin-progress", 95);

    let status = child
        .wait()
        .map_err(|e| format!("等待安装进程失败: {}", e))?;

    // 检测 native binding 缺失（macOS/Linux 上 OpenClaw CLI 自身启动失败）
    let all_output = {
        let stderr_guard = qqbot_stderr_lines.lock().unwrap();
        let mut combined = qqbot_stdout_lines.join("\n");
        combined.push('\n');
        combined.push_str(&stderr_guard.join("\n"));
        combined
    };
    if all_output.contains("native binding") || all_output.contains("Failed to start CLI") {
        let _ = app.emit("plugin-log", "");
        let _ = app.emit(
            "plugin-log",
            "⚠️ 检测到 OpenClaw CLI 原生依赖问题（native binding 缺失）",
        );
        let _ = app.emit(
            "plugin-log",
            "这是 OpenClaw 的上游依赖问题，非 QQBot 插件本身的问题。",
        );
        let _ = app.emit("plugin-log", "请在终端手动执行以下命令重装 OpenClaw：");
        let _ = app.emit("plugin-log", "  npm i -g @qingchencloud/openclaw-zh@latest --registry https://registry.npmmirror.com");
        let _ = app.emit("plugin-log", "重装完成后再回来安装 QQBot 插件。");
        let _ = cleanup_failed_extension_install(
            &plugin_dir,
            &plugin_backup,
            &config_backup,
            had_existing_plugin,
            had_existing_config,
        );
        let _ = app.emit("plugin-progress", 100);
        return Err("OpenClaw CLI 原生依赖缺失，请先在终端重装 OpenClaw（详见上方日志）".into());
    }

    let finalize = (|| -> Result<(), String> {
        if !status.success() {
            return Err("openclaw plugins install 进程退出码非零".into());
        }
        if !plugin_install_marker_exists(&plugin_dir) {
            return Err(format!(
                "安装后未在 extensions/{} 检测到插件",
                OPENCLAW_QQBOT_EXTENSION_FOLDER
            ));
        }

        let mut cfg = super::config::load_openclaw_json()?;
        ensure_openclaw_qqbot_plugin(&mut cfg)?;
        super::config::save_openclaw_json(&cfg)?;
        let _ = app.emit(
            "plugin-log",
            "已补齐 plugins.allow 与 entries.qqbot.enabled",
        );
        Ok(())
    })();

    match finalize {
        Ok(()) => {
            let _ = app.emit("plugin-progress", 100);
            if plugin_backup.exists() {
                let _ = fs::remove_dir_all(&plugin_backup);
            }
            if config_backup.exists() {
                let _ = fs::remove_file(&config_backup);
            }
            let _ = app.emit("plugin-log", "QQBot 插件安装完成");
            Ok("安装成功".into())
        }
        Err(err) => {
            let _ = app.emit("plugin-log", format!("QQ 插件安装失败，正在回退: {err}"));
            let rollback_err = cleanup_failed_extension_install(
                &plugin_dir,
                &plugin_backup,
                &config_backup,
                had_existing_plugin,
                had_existing_config,
            )
            .err()
            .unwrap_or_default();
            let _ = app.emit("plugin-progress", 100);
            let _ = app.emit("plugin-log", "QQBot 插件安装失败，已自动回退到安装前状态");
            if rollback_err.is_empty() {
                Err(format!("插件安装失败：{err}"))
            } else {
                Err(format!("插件安装失败：{err}；回退失败：{rollback_err}"))
            }
        }
    }
}

#[tauri::command]
pub async fn diagnose_channel(
    platform: String,
    account_id: Option<String>,
) -> Result<Value, String> {
    match platform.as_str() {
        "qqbot" => diagnose_qqbot_channel(account_id).await,
        _ => Err(format!(
            "暂不支持平台「{}」的深度诊断（当前仅实现 qqbot）",
            platform
        )),
    }
}

#[tauri::command]
pub async fn repair_qqbot_channel_setup(app: tauri::AppHandle) -> Result<Value, String> {
    let (installed, _) = qqbot_extension_installed();
    if !installed {
        install_qqbot_plugin(app.clone()).await?;
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = super::config::do_reload_gateway(&app2).await;
        });
        return Ok(json!({
            "ok": true,
            "action": "installed",
            "message": "已安装腾讯 openclaw-qqbot 插件并触发 Gateway 重载"
        }));
    }

    let mut cfg = super::config::load_openclaw_json()?;
    ensure_openclaw_qqbot_plugin(&mut cfg)?;
    super::config::save_openclaw_json(&cfg)?;
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = super::config::do_reload_gateway(&app2).await;
    });
    Ok(json!({
        "ok": true,
        "action": "config_repaired",
        "message": "已补齐 QQ 插件配置并重载 Gateway"
    }))
}

async fn diagnose_qqbot_channel(account_id: Option<String>) -> Result<Value, String> {
    let port = gateway_listen_port();
    let cfg = super::config::load_openclaw_json().unwrap_or_else(|_| json!({}));
    let mut checks: Vec<Value> = vec![];

    let saved = read_platform_config("qqbot".to_string(), account_id.clone()).await?;
    let exists = saved
        .get("exists")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let values = saved
        .get("values")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();

    let cred_ok = if !exists {
        checks.push(json!({
            "id": "credentials",
            "ok": false,
            "title": "QQ 凭证已写入配置",
            "detail": "未在 openclaw.json 中找到 qqbot 渠道配置，请先在「消息渠道」页完成接入并保存。"
        }));
        false
    } else {
        match verify_qqbot(
            &super::build_http_client(Duration::from_secs(15), None)
                .map_err(|e| format!("HTTP 客户端初始化失败: {}", e))?,
            &values,
        )
        .await
        {
            Ok(result) if result.get("valid").and_then(|v| v.as_bool()) == Some(true) => {
                let details: Vec<String> = result
                    .get("details")
                    .and_then(|v| v.as_array())
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|item| item.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default();
                checks.push(json!({
                    "id": "credentials",
                    "ok": true,
                    "title": "QQ 开放平台凭证（getAppAccessToken）",
                    "detail": if details.is_empty() {
                        "AppID / ClientSecret 可通过腾讯接口换取 access_token。".to_string()
                    } else {
                        details.join(" · ")
                    }
                }));
                true
            }
            Ok(result) => {
                let errors: Vec<String> = result
                    .get("errors")
                    .and_then(|v| v.as_array())
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|item| item.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_else(|| vec!["凭证校验失败".into()]);
                checks.push(json!({
                    "id": "credentials",
                    "ok": false,
                    "title": "QQ 开放平台凭证（getAppAccessToken）",
                    "detail": errors.join("；")
                }));
                false
            }
            Err(err) => {
                checks.push(json!({
                    "id": "credentials",
                    "ok": false,
                    "title": "QQ 开放平台凭证（getAppAccessToken）",
                    "detail": err
                }));
                false
            }
        }
    };

    let qq_node = cfg.get("channels").and_then(|c| c.get("qqbot"));
    let qq_enabled = qq_node
        .and_then(|node| node.get("enabled"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    checks.push(json!({
        "id": "qq_channel_enabled",
        "ok": qq_enabled,
        "title": "配置中 QQ 渠道已启用",
        "detail": if qq_enabled {
            "channels.qqbot.enabled 为 true（或未显式关闭）。"
        } else {
            "channels.qqbot.enabled 为 false，Gateway 不会连接 QQ，请在渠道卡片中启用。"
        }
    }));

    let chat_on = cfg
        .get("gateway")
        .and_then(|g| g.get("http"))
        .and_then(|h| h.get("endpoints"))
        .and_then(|e| e.get("chatCompletions"))
        .and_then(|c| c.get("enabled"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    checks.push(json!({
        "id": "chat_completions",
        "ok": chat_on,
        "title": "Gateway HTTP · chatCompletions 端点",
        "detail": if chat_on {
            "gateway.http.endpoints.chatCompletions.enabled 已开启。"
        } else {
            "未启用 chatCompletions 时，QQ 机器人常见表现是无法正常回复或返回 405。"
        }
    }));

    let (plugin_ok, plugin_detail) = qqbot_plugin_diagnose(&cfg);
    checks.push(json!({
        "id": "qq_plugin",
        "ok": plugin_ok,
        "title": "QQ 机器人插件（qqbot / openclaw-qqbot）",
        "detail": plugin_detail
    }));

    let tcp_ok = tokio::task::spawn_blocking(move || {
        let addr = format!("127.0.0.1:{port}");
        match addr.parse::<std::net::SocketAddr>() {
            Ok(parsed) => {
                std::net::TcpStream::connect_timeout(&parsed, Duration::from_secs(2)).is_ok()
            }
            Err(_) => false,
        }
    })
    .await
    .unwrap_or(false);
    checks.push(json!({
        "id": "gateway_tcp",
        "ok": tcp_ok,
        "title": format!("本机 Gateway 端口 {}（TCP）", port),
        "detail": if tcp_ok {
            format!("2 秒内可连接到 127.0.0.1:{}。", port)
        } else {
            format!("无法连接 127.0.0.1:{}。QQ 提示「灵魂不在线」时，最常见原因是本机 Gateway 未运行或端口未监听。", port)
        }
    }));

    let (http_ok, http_detail) = if tcp_ok {
        let candidates = ["/__api/health", "/health"];
        let client = super::build_http_client(Duration::from_secs(3), None)
            .map_err(|e| format!("HTTP 客户端初始化失败: {}", e))?;
        let mut last_detail = String::new();
        let mut success = false;
        for path in candidates {
            let url = format!("http://127.0.0.1:{}{}", port, path);
            match client.get(&url).send().await {
                Ok(resp) if resp.status().is_success() || resp.status().is_redirection() => {
                    last_detail = format!("GET {} -> HTTP {}", url, resp.status());
                    success = true;
                    break;
                }
                Ok(resp) => {
                    last_detail = format!("GET {} -> HTTP {}", url, resp.status());
                }
                Err(err) => {
                    last_detail = format!("请求 {} 失败: {}", url, err);
                }
            }
        }
        (success, last_detail)
    } else {
        (false, "已跳过（TCP 未连通）。".to_string())
    };
    checks.push(json!({
        "id": "gateway_http",
        "ok": http_ok,
        "title": "Gateway HTTP 健康探测",
        "detail": http_detail
    }));

    let overall_ready = cred_ok && qq_enabled && chat_on && plugin_ok && tcp_ok && http_ok;
    let hints = vec![
        "QQ 客户端提示「灵魂不在线」通常表示腾讯侧能收到消息，但本机 OpenClaw Gateway 未就绪或 QQ 长连接未建立。".to_string(),
        format!("请确认 Gateway 已启动，且配置中的 gateway.port（当前 {}）与实际监听端口一致。", port),
        format!("如仍异常，请继续对照官方 FAQ：{}", QQ_OPENCLAW_FAQ_URL),
    ];

    Ok(json!({
        "platform": "qqbot",
        "gatewayPort": port,
        "faqUrl": QQ_OPENCLAW_FAQ_URL,
        "checks": checks,
        "overallReady": overall_ready,
        "userHints": hints,
    }))
}

#[tauri::command]
pub async fn check_weixin_plugin_status() -> Result<Value, String> {
    let ext_dir = super::openclaw_dir()
        .join("extensions")
        .join("openclaw-weixin");
    let mut installed = false;
    let mut installed_version: Option<String> = None;

    let pkg_json = ext_dir.join("package.json");
    if pkg_json.is_file() {
        installed = true;
        if let Ok(content) = std::fs::read_to_string(&pkg_json) {
            if let Ok(pkg) = serde_json::from_str::<Value>(&content) {
                installed_version = pkg
                    .get("version")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
        }
    }

    let mut latest_version: Option<String> = None;
    let client = super::build_http_client(std::time::Duration::from_secs(8), None)
        .unwrap_or_else(|_| reqwest::Client::new());
    if let Ok(resp) = client
        .get("https://registry.npmjs.org/@tencent-weixin/openclaw-weixin/latest")
        .header("Accept", "application/json")
        .send()
        .await
    {
        if let Ok(body) = resp.json::<Value>().await {
            latest_version = body
                .get("version")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }
    }

    let update_available = match (&installed_version, &latest_version) {
        (Some(cur), Some(lat)) => {
            let parse = |s: &str| -> Vec<u32> {
                s.split('.').filter_map(|part| part.parse().ok()).collect()
            };
            parse(lat) > parse(cur)
        }
        _ => false,
    };

    Ok(json!({
        "installed": installed,
        "installedVersion": installed_version,
        "latestVersion": latest_version,
        "updateAvailable": update_available,
        "extensionDir": ext_dir.to_string_lossy(),
    }))
}

/// Generic plugin version check — reads local package.json + queries npm registry.
/// Reusable for any OpenClaw plugin (feishu/lark, dingtalk, etc.).
#[tauri::command]
pub async fn check_plugin_version_status(
    plugin_id: String,
    npm_package: String,
) -> Result<Value, String> {
    let ext_dir = super::openclaw_dir().join("extensions").join(&plugin_id);
    let mut installed = false;
    let mut installed_version: Option<String> = None;

    let pkg_json = ext_dir.join("package.json");
    if pkg_json.is_file() {
        installed = true;
        if let Ok(content) = std::fs::read_to_string(&pkg_json) {
            if let Ok(pkg) = serde_json::from_str::<Value>(&content) {
                installed_version = pkg
                    .get("version")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
        }
    }

    let mut latest_version: Option<String> = None;
    let registry_url = format!("https://registry.npmjs.org/{}/latest", npm_package);
    let client = super::build_http_client(std::time::Duration::from_secs(8), None)
        .unwrap_or_else(|_| reqwest::Client::new());
    if let Ok(resp) = client
        .get(&registry_url)
        .header("Accept", "application/json")
        .send()
        .await
    {
        if let Ok(body) = resp.json::<Value>().await {
            latest_version = body
                .get("version")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }
    }

    let update_available = match (&installed_version, &latest_version) {
        (Some(cur), Some(lat)) => {
            let parse = |s: &str| -> Vec<u32> {
                s.split('.').filter_map(|part| part.parse().ok()).collect()
            };
            parse(lat) > parse(cur)
        }
        _ => false,
    };

    Ok(json!({
        "installed": installed,
        "installedVersion": installed_version,
        "latestVersion": latest_version,
        "updateAvailable": update_available,
        "pluginId": plugin_id,
        "extensionDir": ext_dir.to_string_lossy(),
    }))
}

// ── 插件管理 ──────────────────────────────────────────────

/// 列出所有已安装/已配置的插件
#[tauri::command]
pub async fn list_all_plugins() -> Result<Value, String> {
    let cfg = super::config::load_openclaw_json().unwrap_or_else(|_| json!({}));
    let entries = cfg
        .pointer("/plugins/entries")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let allow_arr = cfg
        .pointer("/plugins/allow")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let ext_dir = super::openclaw_dir().join("extensions");
    let mut plugins: Vec<Value> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // 扫描 extensions 目录
    if ext_dir.is_dir() {
        if let Ok(rd) = std::fs::read_dir(&ext_dir) {
            for entry in rd.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let p = entry.path();
                if !p.is_dir() {
                    continue;
                }
                let has_marker = p.join("package.json").is_file()
                    || p.join("plugin.ts").is_file()
                    || p.join("index.js").is_file();
                if !has_marker {
                    continue;
                }

                let plugin_id = name.clone();
                seen.insert(plugin_id.clone());

                let entry_cfg = entries.get(&plugin_id);
                let enabled = entry_cfg
                    .and_then(|e| e.get("enabled"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let allowed = allow_arr.iter().any(|v| v.as_str() == Some(&plugin_id));
                let builtin = is_plugin_builtin(&plugin_id);

                let pkg_json = std::fs::read_to_string(p.join("package.json"))
                    .ok()
                    .and_then(|s| serde_json::from_str::<Value>(&s).ok());
                let version = pkg_json
                    .as_ref()
                    .and_then(|v| v.get("version").and_then(|v| v.as_str().map(String::from)));
                let description = pkg_json.as_ref().and_then(|v| {
                    v.get("description")
                        .and_then(|v| v.as_str().map(String::from))
                });

                plugins.push(json!({
                    "id": plugin_id,
                    "installed": true,
                    "builtin": builtin,
                    "enabled": enabled,
                    "allowed": allowed,
                    "version": version,
                    "description": description,
                    "config": entry_cfg.and_then(|e| e.get("config")),
                }));
            }
        }
    }

    // 补充配置中存在但 extensions 目录中不存在的条目（内置插件等）
    for (pid, entry_val) in &entries {
        if seen.contains(pid.as_str()) {
            continue;
        }
        seen.insert(pid.clone());
        let enabled = entry_val
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let allowed = allow_arr.iter().any(|v| v.as_str() == Some(pid.as_str()));
        let builtin = is_plugin_builtin(pid);
        plugins.push(json!({
            "id": pid,
            "installed": builtin,
            "builtin": builtin,
            "enabled": enabled,
            "allowed": allowed,
            "version": null,
            "description": null,
            "config": entry_val.get("config"),
        }));
    }

    plugins.sort_by(|a, b| {
        let ae = a.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
        let be = b.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
        be.cmp(&ae).then_with(|| {
            let an = a.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let bn = b.get("id").and_then(|v| v.as_str()).unwrap_or("");
            an.cmp(bn)
        })
    });

    Ok(json!({ "plugins": plugins }))
}

/// 启用/禁用插件
#[tauri::command]
pub async fn toggle_plugin(plugin_id: String, enabled: bool) -> Result<Value, String> {
    let plugin_id = plugin_id.trim();
    if plugin_id.is_empty() {
        return Err("plugin_id 不能为空".into());
    }

    let mut cfg = super::config::load_openclaw_json().unwrap_or_else(|_| json!({}));

    if enabled {
        ensure_plugin_allowed(&mut cfg, plugin_id)?;
    } else {
        disable_legacy_plugin(&mut cfg, plugin_id);
    }

    super::config::save_openclaw_json(&cfg)?;

    Ok(json!({ "ok": true, "enabled": enabled, "pluginId": plugin_id }))
}

/// 通过 OpenClaw CLI 安装插件
#[tauri::command]
pub async fn install_plugin(package_name: String) -> Result<Value, String> {
    let package_name = package_name.trim().to_string();
    if package_name.is_empty() {
        return Err("包名不能为空".into());
    }

    let cli = crate::utils::resolve_openclaw_cli_path()
        .ok_or_else(|| "找不到 OpenClaw CLI，请先安装".to_string())?;
    let mut cmd = std::process::Command::new(&cli);
    cmd.args(["plugins", "install", &package_name])
        .current_dir(dirs::home_dir().unwrap_or_default())
        .env("PATH", super::enhanced_path());
    crate::commands::apply_proxy_env(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("执行 openclaw plugins install 失败: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!("安装失败: {}{}", stdout, stderr));
    }

    Ok(json!({ "ok": true, "output": format!("{}{}", stdout, stderr).trim().to_string() }))
}

#[tauri::command]
pub async fn run_channel_action(
    app: tauri::AppHandle,
    platform: String,
    action: String,
) -> Result<String, String> {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;
    use std::sync::{Arc, Mutex};
    use tauri::Emitter;

    let platform = platform.trim().to_string();
    let action = action.trim().to_string();
    if platform.is_empty() || action.is_empty() {
        return Err("platform 和 action 不能为空".into());
    }

    if platform == "weixin" && (action == "install" || action == "upgrade") {
        let _ = app.emit("channel-action-log", json!({
            "platform": &platform,
            "action": &action,
            "kind": "info",
            "message": format!("开始{}微信插件: npx -y @tencent-weixin/openclaw-weixin-cli@latest install", if action == "upgrade" { "升级" } else { "安装" })
        }));
        let _ = app.emit(
            "channel-action-progress",
            json!({ "platform": &platform, "action": &action, "progress": 5 }),
        );

        #[cfg(target_os = "windows")]
        let mut cmd = {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let mut c = std::process::Command::new("cmd");
            c.args([
                "/c",
                "npx",
                "-y",
                "@tencent-weixin/openclaw-weixin-cli@latest",
                "install",
            ]);
            c.creation_flags(CREATE_NO_WINDOW);
            c
        };
        #[cfg(not(target_os = "windows"))]
        let mut cmd = {
            let mut c = std::process::Command::new("npx");
            c.args([
                "-y",
                "@tencent-weixin/openclaw-weixin-cli@latest",
                "install",
            ]);
            c
        };

        cmd.env("PATH", super::enhanced_path());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        crate::commands::apply_proxy_env(&mut cmd);

        let mut child = cmd.spawn().map_err(|e| format!("启动 npx 失败: {}", e))?;
        let stderr = child.stderr.take();
        let app2 = app.clone();
        let platform2 = platform.clone();
        let action2 = action.clone();
        let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let err_lines = lines.clone();
        let handle = std::thread::spawn(move || {
            if let Some(pipe) = stderr {
                for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                    if let Ok(mut guard) = err_lines.lock() {
                        guard.push(line.clone());
                    }
                    let _ = app2.emit(
                        "channel-action-log",
                        json!({ "platform": platform2, "action": action2, "message": line, "kind": "stderr" }),
                    );
                }
            }
        });

        let mut progress: u32 = 15;
        if let Some(pipe) = child.stdout.take() {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                if let Ok(mut guard) = lines.lock() {
                    guard.push(line.clone());
                }
                let _ = app.emit(
                    "channel-action-log",
                    json!({ "platform": &platform, "action": &action, "message": line, "kind": "stdout" }),
                );
                if progress < 90 {
                    progress += 5;
                    let _ = app.emit(
                        "channel-action-progress",
                        json!({ "platform": &platform, "action": &action, "progress": progress }),
                    );
                }
            }
        }

        let _ = handle.join();
        let status = child
            .wait()
            .map_err(|e| format!("等待命令结束失败: {}", e))?;
        let text = lines
            .lock()
            .ok()
            .map(|guard| guard.join("\n"))
            .unwrap_or_default();
        let _ = app.emit(
            "channel-action-progress",
            json!({ "platform": &platform, "action": &action, "progress": 100 }),
        );
        return if status.success() {
            Ok(text)
        } else {
            Err(format!(
                "微信插件{}失败 (exit {})\n{}",
                if action == "upgrade" {
                    "升级"
                } else {
                    "安装"
                },
                status.code().unwrap_or(-1),
                text
            ))
        };
    }

    let channel_id = if platform == "weixin" {
        "openclaw-weixin".to_string()
    } else {
        platform.clone()
    };
    let args = match action.as_str() {
        "login" => vec![
            "channels".to_string(),
            "login".to_string(),
            "--channel".to_string(),
            channel_id,
        ],
        _ => return Err(format!("不支持的渠道动作: {}", action)),
    };

    let emit_log = |app: &tauri::AppHandle, kind: &str, message: String| {
        let _ = app.emit(
            "channel-action-log",
            json!({
                "platform": &platform,
                "action": &action,
                "kind": kind,
                "message": message
            }),
        );
    };
    let emit_progress = |app: &tauri::AppHandle, progress: u32| {
        let _ = app.emit(
            "channel-action-progress",
            json!({ "platform": &platform, "action": &action, "progress": progress }),
        );
    };

    emit_log(
        &app,
        "info",
        format!("开始执行 openclaw {}", args.join(" ")),
    );
    emit_progress(&app, 5);

    let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let mut child = crate::utils::openclaw_command()
        .args(args.iter().map(|s| s.as_str()))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 openclaw 失败: {}", e))?;

    let stderr = child.stderr.take();
    let app2 = app.clone();
    let platform2 = platform.clone();
    let action2 = action.clone();
    let err_lines = lines.clone();
    let handle = std::thread::spawn(move || {
        if let Some(pipe) = stderr {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                if let Ok(mut guard) = err_lines.lock() {
                    guard.push(line.clone());
                }
                let _ = app2.emit(
                    "channel-action-log",
                    json!({ "platform": platform2, "action": action2, "message": line, "kind": "stderr" }),
                );
            }
        }
    });

    let mut progress = 15;
    if let Some(pipe) = child.stdout.take() {
        for line in BufReader::new(pipe).lines().map_while(Result::ok) {
            if let Ok(mut guard) = lines.lock() {
                guard.push(line.clone());
            }
            let _ = app.emit(
                "channel-action-log",
                json!({ "platform": &platform, "action": &action, "message": line, "kind": "stdout" }),
            );
            if progress < 90 {
                progress += 5;
                emit_progress(&app, progress);
            }
        }
    }

    let _ = handle.join();
    let status = child
        .wait()
        .map_err(|e| format!("等待命令结束失败: {}", e))?;
    let message = lines
        .lock()
        .ok()
        .map(|guard| {
            let text = guard.join("\n");
            if text.trim().is_empty() {
                "操作完成".to_string()
            } else {
                text
            }
        })
        .unwrap_or_else(|| "操作完成".into());

    if status.success() {
        if platform == "weixin" && action == "login" {
            if let Ok(mut cfg) = super::config::load_openclaw_json() {
                if let Some(channels) = cfg
                    .as_object_mut()
                    .map(|root| root.entry("channels").or_insert_with(|| json!({})))
                    .and_then(|channels| channels.as_object_mut())
                {
                    let entry = channels
                        .entry("openclaw-weixin")
                        .or_insert_with(|| json!({}));
                    if let Some(obj) = entry.as_object_mut() {
                        obj.insert("enabled".into(), Value::Bool(true));
                    }
                    let _ = super::config::save_openclaw_json(&cfg);
                }
            }
        }
        emit_progress(&app, 100);
        Ok(message)
    } else {
        Err(message)
    }
}

fn create_agent_binding(
    cfg: &mut Value,
    agent_id: &str,
    channel: &str,
    account_id: Option<String>,
) -> Result<(), String> {
    let bindings = cfg
        .as_object_mut()
        .ok_or("配置格式错误")?
        .entry("bindings")
        .or_insert_with(|| json!([]));
    let bindings_arr = bindings.as_array_mut().ok_or("bindings 节点格式错误")?;

    let mut binding_value = Map::new();
    binding_value.insert("type".into(), Value::String("route".into()));
    binding_value.insert("agentId".into(), Value::String(agent_id.to_string()));

    let mut match_config = Map::new();
    match_config.insert("channel".into(), Value::String(channel.to_string()));
    if let Some(acct) = account_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
    {
        match_config.insert("accountId".into(), Value::String(acct));
    }
    binding_value.insert("match".into(), Value::Object(match_config));
    let next_binding = Value::Object(binding_value);

    let mut found = false;
    for binding in bindings_arr.iter_mut() {
        let same_agent = binding.get("agentId").and_then(|v| v.as_str()) == Some(agent_id);
        let same_channel = binding
            .get("match")
            .and_then(|m| m.get("channel"))
            .and_then(|v| v.as_str())
            == Some(channel);
        let same_account = binding
            .get("match")
            .and_then(|m| m.get("accountId"))
            .and_then(|v| v.as_str())
            == account_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty());
        if same_agent && same_channel && same_account {
            *binding = next_binding.clone();
            found = true;
            break;
        }
    }
    if !found {
        bindings_arr.push(next_binding);
    }
    Ok(())
}

#[tauri::command]
pub async fn list_all_bindings() -> Result<Value, String> {
    let cfg = super::config::load_openclaw_json()?;
    let bindings = cfg
        .get("bindings")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(json!({ "bindings": bindings }))
}

#[tauri::command]
pub async fn save_agent_binding(
    agent_id: String,
    channel: String,
    account_id: Option<String>,
    binding_config: Value,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    let mut cfg = super::config::load_openclaw_json()?;
    let mut warnings: Vec<String> = vec![];
    let trimmed_account = account_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    if let Some(acct) = trimmed_account.as_deref() {
        if let Some(ch) = cfg.get("channels").and_then(|c| c.get(channel.as_str())) {
            let has_account = ch
                .get("accounts")
                .and_then(|a| a.get(acct))
                .map(|acct_val| {
                    acct_val
                        .get("appId")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .is_some()
                        || acct_val
                            .get("token")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty())
                            .is_some()
                })
                .unwrap_or(false);
            if !has_account {
                warnings.push(format!(
                    "账号「{}」在 channels.{}.accounts 下未找到对应配置，绑定可能无法正常路由消息。",
                    acct, channel
                ));
            }
        } else {
            warnings.push(format!(
                "渠道「{}」尚未接入（channels.{} 不存在），该绑定可能无法正常工作。",
                channel, channel
            ));
        }
    }

    let bindings = cfg
        .as_object_mut()
        .ok_or("配置格式错误")?
        .entry("bindings")
        .or_insert_with(|| json!([]));
    let bindings_arr = bindings.as_array_mut().ok_or("bindings 节点格式错误")?;

    let mut new_binding = Map::new();
    new_binding.insert("type".into(), Value::String("route".into()));
    new_binding.insert("agentId".into(), Value::String(agent_id.clone()));

    let mut match_config = Map::new();
    match_config.insert("channel".into(), Value::String(channel.clone()));
    if let Some(acct) = trimmed_account.as_deref() {
        match_config.insert("accountId".into(), Value::String(acct.to_string()));
    }
    if let Some(config_obj) = binding_config.as_object() {
        for (key, value) in config_obj {
            if key == "accountId" || key == "channel" {
                continue;
            }
            if key == "peer" {
                if let Some(peer_str) = value.as_str().filter(|s| !s.is_empty()) {
                    match_config.insert("peer".into(), json!({ "kind": "direct", "id": peer_str }));
                } else if let Some(peer_obj) = value.as_object() {
                    let kind = peer_obj
                        .get("kind")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .unwrap_or("direct");
                    if let Some(id) = peer_obj
                        .get("id")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                    {
                        match_config.insert("peer".into(), json!({ "kind": kind, "id": id }));
                    }
                }
            } else {
                match_config.insert(key.clone(), value.clone());
            }
        }
    }
    new_binding.insert("match".into(), Value::Object(match_config));
    let binding_value = Value::Object(new_binding);

    let mut found = false;
    for binding in bindings_arr.iter_mut() {
        let same_agent = binding.get("agentId").and_then(|v| v.as_str()) == Some(agent_id.as_str());
        let same_channel = binding
            .get("match")
            .and_then(|m| m.get("channel"))
            .and_then(|v| v.as_str())
            == Some(channel.as_str());
        let same_account = binding
            .get("match")
            .and_then(|m| m.get("accountId"))
            .and_then(|v| v.as_str())
            == trimmed_account.as_deref();
        if same_agent && same_channel && same_account {
            *binding = binding_value.clone();
            found = true;
            break;
        }
    }
    if !found {
        bindings_arr.push(binding_value);
    }

    super::config::save_openclaw_json(&cfg)?;
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = super::config::do_reload_gateway(&app2).await;
    });

    Ok(json!({ "ok": true, "warnings": warnings }))
}

#[tauri::command]
pub async fn delete_agent_binding(
    agent_id: String,
    channel: String,
    account_id: Option<String>,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    let mut cfg = super::config::load_openclaw_json()?;
    let Some(bindings) = cfg.get_mut("bindings").and_then(|b| b.as_array_mut()) else {
        return Ok(json!({ "ok": true }));
    };

    let trimmed_account = account_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    bindings.retain(|binding| {
        if binding.get("agentId").and_then(|v| v.as_str()) != Some(agent_id.as_str()) {
            return true;
        }
        let Some(match_obj) = binding.get("match").and_then(|m| m.as_object()) else {
            return true;
        };
        if match_obj.get("channel").and_then(|v| v.as_str()) != Some(channel.as_str()) {
            return true;
        }
        match match_obj.get("accountId").and_then(|v| v.as_str()) {
            Some(existing) => Some(existing) != trimmed_account,
            None => trimmed_account.is_some(),
        }
    });

    super::config::save_openclaw_json(&cfg)?;
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = super::config::do_reload_gateway(&app2).await;
    });

    Ok(json!({ "ok": true }))
}

// ── Telegram 凭证校验 ─────────────────────────────────────

async fn verify_telegram(
    client: &reqwest::Client,
    form: &Map<String, Value>,
) -> Result<Value, String> {
    let bot_token = form
        .get("botToken")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if bot_token.is_empty() {
        return Ok(json!({ "valid": false, "errors": ["Bot Token 不能为空"] }));
    }

    let allowed = form
        .get("allowedUsers")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if allowed.is_empty() {
        return Ok(json!({ "valid": false, "errors": ["至少需要填写一个允许的用户 ID"] }));
    }

    let url = format!("https://api.telegram.org/bot{}/getMe", bot_token);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Telegram API 连接失败: {}", e))?;

    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    if body.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        let username = body
            .get("result")
            .and_then(|r| r.get("username"))
            .and_then(|v| v.as_str())
            .unwrap_or("未知");
        Ok(json!({
            "valid": true,
            "errors": [],
            "details": [format!("Bot: @{}", username)]
        }))
    } else {
        let desc = body
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("Token 无效");
        Ok(json!({
            "valid": false,
            "errors": [desc]
        }))
    }
}

// ── 飞书凭证校验 ──────────────────────────────────────

async fn verify_feishu(
    client: &reqwest::Client,
    form: &Map<String, Value>,
) -> Result<Value, String> {
    let app_id = form
        .get("appId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let app_secret = form
        .get("appSecret")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    if app_id.is_empty() {
        return Ok(json!({ "valid": false, "errors": ["App ID 不能为空"] }));
    }
    if app_secret.is_empty() {
        return Ok(json!({ "valid": false, "errors": ["App Secret 不能为空"] }));
    }

    // 通过飞书 API 获取 tenant_access_token 验证凭证
    let domain = form
        .get("domain")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let base_url = if domain == "lark" {
        "https://open.larksuite.com"
    } else {
        "https://open.feishu.cn"
    };

    let resp = client
        .post(format!(
            "{}/open-apis/auth/v3/tenant_access_token/internal",
            base_url
        ))
        .json(&json!({
            "app_id": app_id,
            "app_secret": app_secret
        }))
        .send()
        .await
        .map_err(|e| format!("飞书 API 连接失败: {}", e))?;

    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let code = body.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
    if code == 0 {
        Ok(json!({
            "valid": true,
            "errors": [],
            "details": [format!("App ID: {}", app_id)]
        }))
    } else {
        let msg = body
            .get("msg")
            .and_then(|v| v.as_str())
            .unwrap_or("凭证无效，请检查 App ID 和 App Secret");
        Ok(json!({
            "valid": false,
            "errors": [msg]
        }))
    }
}

// ── 钉钉凭证校验 ──────────────────────────────────────

async fn verify_dingtalk(
    client: &reqwest::Client,
    form: &Map<String, Value>,
) -> Result<Value, String> {
    let client_id = form
        .get("clientId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let client_secret = form
        .get("clientSecret")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    if client_id.is_empty() {
        return Ok(json!({ "valid": false, "errors": ["Client ID 不能为空"] }));
    }
    if client_secret.is_empty() {
        return Ok(json!({ "valid": false, "errors": ["Client Secret 不能为空"] }));
    }

    let resp = client
        .post("https://api.dingtalk.com/v1.0/oauth2/accessToken")
        .json(&json!({
            "appKey": client_id,
            "appSecret": client_secret
        }))
        .send()
        .await
        .map_err(|e| format!("钉钉 API 连接失败: {}", e))?;

    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    if body
        .get("accessToken")
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
        .is_some()
        || body
            .get("access_token")
            .and_then(|v| v.as_str())
            .filter(|v| !v.is_empty())
            .is_some()
    {
        Ok(json!({
            "valid": true,
            "errors": [],
            "details": [
                format!("AppKey: {}", client_id),
                "已通过 accessToken 接口校验".to_string()
            ]
        }))
    } else {
        let msg = body
            .get("message")
            .or_else(|| body.get("msg"))
            .or_else(|| body.get("errmsg"))
            .and_then(|v| v.as_str())
            .unwrap_or("凭证无效，请检查 Client ID 和 Client Secret");
        Ok(json!({
            "valid": false,
            "errors": [msg]
        }))
    }
}
