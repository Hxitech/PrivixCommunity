mod commands;
mod models;
mod tray;
mod utils;

use commands::{
    agent, agent_detect, assistant, config, device, diagnose, hermes, knowledge, logs, memory,
    messaging, pairing, service, skills, theme, update,
};

pub fn run() {
    let hot_update_dir = commands::panel_runtime_dir().join("web-update");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .register_uri_scheme_protocol("tauri", move |ctx, request| {
            let uri_path = request.uri().path();
            let path = if uri_path == "/" || uri_path.is_empty() {
                "index.html"
            } else {
                uri_path.strip_prefix('/').unwrap_or(uri_path)
            };

            // 1. 优先检查热更新目录
            if let Some(update_file) = update::resolve_active_update_file(&hot_update_dir, path) {
                if let Ok(data) = std::fs::read(&update_file) {
                    return tauri::http::Response::builder()
                        .header(
                            tauri::http::header::CONTENT_TYPE,
                            update::mime_from_path(path),
                        )
                        .body(data)
                        .unwrap();
                }
            }

            // 2. 回退到内嵌资源
            if let Some(asset) = ctx.app_handle().asset_resolver().get(path.to_string()) {
                let builder = tauri::http::Response::builder()
                    .header(tauri::http::header::CONTENT_TYPE, &asset.mime_type);
                // Tauri 内嵌资源可能带 CSP header
                let builder = if let Some(csp) = asset.csp_header {
                    builder.header("Content-Security-Policy", csp)
                } else {
                    builder
                };
                builder.body(asset.bytes).unwrap()
            } else {
                tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .body(b"Not Found".to_vec())
                    .unwrap()
            }
        })
        .setup(|app| {
            let _ = commands::migrate_legacy_profile_dir();
            service::start_backend_guardian(app.handle().clone());
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 配置
            config::read_openclaw_config,
            config::write_openclaw_config,
            config::read_mcp_config,
            config::write_mcp_config,
            config::get_version_info,
            config::check_installation,
            config::init_openclaw_config,
            config::check_node,
            config::check_node_at_path,
            config::scan_node_paths,
            config::save_custom_node_path,
            config::write_env_file,
            config::list_backups,
            config::create_backup,
            config::restore_backup,
            config::delete_backup,
            config::reload_gateway,
            config::restart_gateway,
            config::test_model,
            config::list_remote_models,
            config::list_openclaw_versions,
            config::upgrade_openclaw,
            config::uninstall_openclaw,
            config::install_gateway,
            config::uninstall_gateway,
            config::patch_model_vision,
            config::check_panel_update,
            config::read_panel_config,
            config::write_panel_config,
            config::read_swarm_sessions,
            config::write_swarm_sessions,
            config::get_openclaw_dir,
            config::doctor_fix,
            config::doctor_check,
            config::test_proxy,
            config::get_npm_registry,
            config::set_npm_registry,
            config::check_git,
            config::scan_git_paths,
            config::auto_install_git,
            config::configure_git_https,
            config::invalidate_path_cache,
            config::get_status_summary,
            // 设备密钥 + Gateway 握手
            device::create_connect_frame,
            // License 激活
            // 设备配对
            pairing::auto_pair_device,
            pairing::check_pairing_status,
            pairing::pairing_list_channel,
            pairing::pairing_approve_channel,
            // 服务
            service::get_services_status,
            service::start_service,
            service::stop_service,
            service::restart_service,
            service::claim_gateway,
            service::probe_gateway_port,
            service::guardian_status,
            service::reset_guardian,
            // 诊断
            diagnose::diagnose_gateway_connection,
            // 日志
            logs::read_log_tail,
            logs::search_log,
            // 记忆文件
            memory::list_memory_files,
            memory::read_memory_file,
            memory::write_memory_file,
            memory::delete_memory_file,
            memory::export_memory_zip,
            // 扩展工具
            // Agent 管理
            agent::list_agents,
            agent::add_agent,
            agent::delete_agent,
            agent::update_agent_identity,
            agent::update_agent_model,
            agent::backup_agent,
            agent::preview_agent_workspace_generation,
            agent::apply_agent_workspace_generation,
            // CLI Agent 自动检测(Agent Studio)
            agent_detect::detect_agents,
            // 用户自定义 CSS 主题(Agent Studio)
            theme::read_user_css,
            theme::write_user_css,
            theme::get_user_css_path,
            // AI 助手工具
            assistant::assistant_exec,
            assistant::assistant_read_file,
            assistant::assistant_write_file,
            assistant::assistant_list_dir,
            assistant::assistant_system_info,
            assistant::assistant_list_processes,
            assistant::assistant_check_port,
            assistant::assistant_web_search,
            assistant::assistant_fetch_url,
            // 数据目录 & 图片存储
            assistant::assistant_ensure_data_dir,
            assistant::assistant_save_image,
            assistant::assistant_load_image,
            assistant::assistant_delete_image,
            // 消息渠道管理
            messaging::read_platform_config,
            messaging::save_messaging_platform,
            messaging::remove_messaging_platform,
            messaging::toggle_messaging_platform,
            messaging::verify_bot_token,
            messaging::diagnose_channel,
            messaging::repair_qqbot_channel_setup,
            messaging::list_configured_platforms,
            messaging::get_channel_plugin_status,
            messaging::list_all_plugins,
            messaging::toggle_plugin,
            messaging::install_plugin,
            messaging::install_channel_plugin,
            messaging::install_qqbot_plugin,
            messaging::check_weixin_plugin_status,
            messaging::check_plugin_version_status,
            messaging::run_channel_action,
            messaging::list_all_bindings,
            messaging::save_agent_binding,
            messaging::delete_agent_binding,
            // 知识库管理
            knowledge::kb_list_libraries,
            knowledge::kb_create_library,
            knowledge::kb_delete_library,
            knowledge::kb_update_library,
            knowledge::kb_list_files,
            knowledge::kb_add_text,
            knowledge::kb_add_file,
            knowledge::kb_read_file,
            knowledge::kb_delete_file,
            knowledge::kb_sync_to_agent,
            knowledge::kb_check_extract_tools,
            // KB Wiki (Karpathy 式 LLM 维护知识库)
            // Skills 管理（纯本地扫描 + SkillHub SDK）
            skills::skills_list,
            skills::skills_info,
            skills::skills_check,
            skills::skills_install_dep,
            skills::skills_uninstall,
            skills::skills_validate,
            skills::skillhub_search,
            skills::skillhub_index,
            skills::skillhub_install,
            // 前端热更新
            // Hermes Agent 管理
            hermes::check_python,
            hermes::check_hermes,
            hermes::install_hermes,
            hermes::configure_hermes,
            hermes::hermes_gateway_action,
            hermes::hermes_health_check,
            hermes::hermes_api_proxy,
            hermes::hermes_agent_run,
            hermes::hermes_read_config,
            hermes::hermes_fetch_models,
            hermes::hermes_update_model,
            hermes::hermes_detect_environments,
            hermes::hermes_set_gateway_url,
            hermes::update_hermes,
            hermes::uninstall_hermes,
            hermes::hermes_sessions_list,
            hermes::hermes_session_detail,
            hermes::hermes_session_delete,
            hermes::hermes_session_rename,
            hermes::hermes_logs_list,
            hermes::hermes_logs_read,
            hermes::hermes_skills_list,
            hermes::hermes_skill_detail,
            hermes::hermes_memory_read,
            hermes::hermes_memory_write,
        ])
        .build(tauri::generate_context!())
        .expect("启动 Privix 失败")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                #[cfg(target_os = "windows")]
                {
                    // 退出时关闭 Gateway 终端窗口
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x08000000;
                    let _ = std::process::Command::new("cmd")
                        .args(["/c", "taskkill", "/fi", "WINDOWTITLE eq OpenClaw Gateway"])
                        .creation_flags(CREATE_NO_WINDOW)
                        .output();
                }
            }
        });
}
