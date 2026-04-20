---
name: sync-version
description: 同步或设置项目版本号到所有配置文件
when-to-use: 当用户要求更新版本号、发版、或同步版本时
user-invocable: true
allowed-tools:
  - Bash
  - Read
argument-hint: "[version]"
---

# 版本同步

如果提供了版本号参数，设置新版本并同步；否则仅同步当前版本。

## 步骤

1. 如果有版本号参数：运行 `npm run version:set <version>`
2. 如果没有参数：运行 `npm run version:sync`
3. 读取 `package.json` 确认版本号
4. 检查同步结果：`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`docs/index.html` 是否已更新
5. 提醒用户手动编写 `CHANGELOG.md` 对应版本的变更记录
