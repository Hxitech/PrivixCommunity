---
description: Rust Tauri 后端命令模块的开发规范
paths: ["src-tauri/**"]
---

# Rust 后端开发规范

## 命令模块 (`src-tauri/src/commands/`)

- 每个功能域一个文件（config.rs, service.rs, agent.rs 等）
- 新命令加 `#[tauri::command]`，并在 `lib.rs` 的 `invoke_handler` 注册
- 配套更新前端 `src/lib/tauri-api.js` 的 `api` 对象和 `mockInvoke` 的 `mocks`

## PATH 环境变量

Tauri 桌面应用启动时 PATH 可能不完整。所有调用外部命令的地方必须使用：

```rust
super::enhanced_path()
```

来设置环境变量，确保 `node`、`npm`、`openclaw` 等命令可被找到。

## 跨平台代码

使用条件编译处理平台差异：

```rust
#[cfg(target_os = "macos")]    // launchctl / plist
#[cfg(target_os = "linux")]    // systemd / 进程管理
#[cfg(target_os = "windows")]  // openclaw CLI / tasklist
```

## 配置目录

- OpenClaw 配置: `~/.openclaw/openclaw.json`（由 `default_openclaw_dir()` 解析，支持旧环境变量兼容）
- 面板配置: `~/.openclaw/privix-community/<profileId>/clawpanel.json`
- 产品 Profile: 社区版固定为 `privix-community`，由 `active_product_profile_id()` 返回

## Rust 版本

- Edition 2021
- CI 检查: `cargo fmt --check` + `cargo clippy -- -D warnings`
