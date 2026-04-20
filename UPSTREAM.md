# 上游同步追踪

本文档记录 Privix 与上游 [qingchencloud/clawpanel](https://github.com/qingchencloud/clawpanel) 的同步状态。

## 仓库信息

| 项目 | 地址 |
|------|------|
| 本项目 | https://github.com/Hxitech/ProspectClaw |
| 上游 ClawPanel | https://github.com/qingchencloud/clawpanel |
| OpenClaw 核心 | https://github.com/openclaw/openclaw |
| OpenClaw 汉化版 | https://github.com/1186258278/OpenClawChineseTranslation |

## 分叉差异概要

**我们独有（不在上游中）：**
- AI Agent 工作台定位：钳子医生（Claw Doctor）、ProspectResearch、Agentic Swarm、OpenClaw、Hermes 五大核心能力
- Hermes 引擎集成（v1.4.0 起的双引擎架构，8 个页面 + 25 个 Rust 命令）
- 场景化模块：Invest Profile 20+ 页面（pool, deal-detail, companies, contacts, pipeline, scoring, audit 等）
- 历史 product profile 兼容层（`invest_workbench` / `local_qa_kb` / `doc_sop` 仍保留脚本与标识，但 v1.4.2+ 正式发版已统一为单一 Privix 身份）
- SOP 引擎（DAG 依赖、执行监督、模式归纳）
- 增强的模型预设（15 个供应商、80+ 模型）
- 版本特性门控系统（openclaw-feature-gates.js）

**上游独有的近期改进（需评估同步）：**
- i18n 全页面国际化 + 多语言（v0.9.9-v0.10.0）— 我们不需要（已回退，使用中文内联文本）
- SkillHub SHA-256 + VirusTotal 安全校验（v0.9.7）

**已同步至 v0.13.3 的改进：**
- 消息复制按钮、Gateway 外部实例认领、模型 fallback 不覆盖、Git 路径自定义+扫描;v0.13.3 critical fix(#212/#215/#219、引擎切换 timeout)

## 同步历史

| 日期 | 上游版本 | 同步内容 | 我们的版本 |
|------|---------|---------|-----------|
| 2026-03-26 | v0.9.8 | 飞书插件已对齐官方版、微信新增升级操作按钮、版本警告优化 | v1.0.30 |
| 2026-03-29 | v0.10.0 + OpenClaw 2026.3.28 | 版本号解析修复、子Agent模型不覆盖、Gateway一键修复、开机自启、Ollama原生API、Gemini 3.1模型、Cron投递修复、更新banner持久化、macOS多路径检测、汉化版检测兜底、推荐版本→2026.3.28；并在本地补修 autostart lockfile、仪表盘缓存陈旧、EvoScientist quick-config、Node 语义版本排序 | v1.1.4 |
| 2026-03-31 | v0.10.0 后续 (57b8b25) | MiniMax API 迁移 api.minimax.io + M2.5 模型预设；Gateway 死循环修复 #160；Linux Gateway 进程检测 #151；Docker 双容器 DISABLE_GATEWAY_SPAWN #159；systemd PATH 补全 #156；版本源检测重构（活跃 CLI 优先、cmd shim 读取、Linux 完整检测链、standalone 集中化、fallback→unknown）；前端 unknown 来源显示 | v1.1.8-fix4+ |
| 2026-04-02 | v0.11.2 + OpenClaw 2026.4.1 | Gateway 归属签名检测（PID→port/CLI/dir 签名匹配，防止误判外部 Gateway）#176；Gateway PID 查找失败不再误报 down；配置校准修复流（inherit/reset 两种模式）；配置读取自动清理 UI 污染字段（Issue #89）；confirm 对话框内容溢出修复；推荐版本→2026.4.1；品牌重命名 ClawPanel→Privix | v1.2.1 |
| 2026-04-03 | v0.11.3 + OpenClaw 2026.4.2 | 版本映射修正（-zh 自动识别、unknown 跳过 npm 查询）；多安装检测去重 + VersionInfo 扩展（cli_path/cli_source/all_installations）；detect_installed_source 改进（Intel Mac /usr/local/bin、Linux symlink、canonicalize 补救）；CherryStudio 路径排除；推荐版本→2026.4.2 | v1.2.2 |
| 2026-04-06 | v0.11.4 + OpenClaw 2026.4.5 | 消息复制按钮（chat + assistant）；IME 输入法防误发（chat 已有 input-helpers.js）；Gateway 外部实例认领（前端 foreign 状态 + claim 按钮 + Rust claim_gateway 命令 + 自动认领逻辑）；模型 fallback 不再自动覆盖（#190）；Git 路径自定义+扫描（settings 页 + config.rs scan_git_paths + dev-api）；skills bundled 目录推导；推荐版本→2026.4.5；另外新增 ClawSwarm/EvoScientist "从 OpenClaw 获取模型"按钮 | v1.2.6 |
| 2026-04-08 | v0.11.5 + v0.11.6 + OpenClaw 2026.4.8 | **SkillHub SDK 迁移**：新增 SkillHub 技能商店（SDK 内置 HTTP + zip 解压，不依赖 CLI），Skills 页双 Tab（已安装 + 商店），多 Agent Skills 目录支持（agent_id 路由），新增 Rust skillhub.rs + Node skillhub-sdk.js，移除 6 个旧 CLI 命令改用 3 个 SDK 命令；**Chat OpenClaw 4.5 兼容**：Agent 事件流处理（lifecycle/item/plan/approval/thinking/command_output），3 分钟终极超时 + 实时计时器，修复静默无回复；**Assistant 工具流式**：tool_calls 打字机效果，空灰色气泡修复；**Gateway 稳定性**：仪表盘刷新节流 5s，TCP 重试，停止检测 2→3 次，重启前 3s 延迟；**热更新移除**：About 页和全局更新横幅改为下载链接；推荐版本→2026.4.8 | v1.2.8 |
| 2026-04-11 | v0.12.0 + OpenClaw 2026.4.9 | **新增 4 个功能页面**：Dreaming（自主 Agent UI）、Plugin Hub（插件管理）、Route Map（渠道→Agent SVG 可视化）、Diagnose（Gateway 连接诊断）；**面板版本门控**：新增 feature-gates.js，sidebar 按 OpenClaw 版本动态显隐功能；**WebSocket 增强**：密码认证、凭据自动刷新、心跳检测、消息缓存去重、close code 精确分流（4001/1008 细分）、detailCode 路由；**Rust 后端**：新增 diagnose.rs 诊断模块 + probe_gateway_port TCP 探测 + 插件管理三件套（list_all_plugins/toggle_plugin/install_plugin）；**Dashboard**：WebSocket 状态指示器 + 已连接渠道概览 + 日志彩色级别标签；**Skills**：Gateway RPC 优先（wsClient.skillsSearch/Detail 优先于 Tauri API）；**About**：卸载进度标签定制 | v1.3.0 |
| 2026-04-13 | v0.13.0 + v0.13.1 + OpenClaw 2026.4.11 | **多引擎架构**：新增 engine-manager.js 引擎注册/切换/持久化，OpenClaw 引擎封装（42 路由 + 产品 Profile 感知），Hermes Agent 引擎（8 页面 + 15s 状态轮询 + SSE 流式）；main.js boot() 重构为引擎驱动路由注册；sidebar 引擎切换器 + 引擎感知导航；**Hermes Rust 后端**：新增 hermes.rs（25 个 Tauri 命令，Gateway Guardian 模式，指数退避重启）；tauri-api.js 新增 30 个 Hermes API 函数；**Bug 修复/UX**：加载骨架屏、假更新检测修复、可点击向导；**OpenClaw 4.11 兼容**：dreaming-import + memory-palace 特性门控；推荐版本→2026.4.11；**品牌重命名**：ClawPanelInvest → Privix 全局重命名；硬编码路径改为相对路径 | v1.4.0 |
| 2026-04-14 | v0.13.2 + OpenClaw 2026.4.12 | **Hermes 新页面**：日志查看器（logs.js，文件列表 + 级别过滤 + 关键词搜索）、记忆编辑器（memory.js，MEMORY.md / USER.md Markdown 编辑，复用 `src/lib/markdown.js:renderMarkdown`）；**引擎导航重构**：Monitor（dashboard/chat/logs）+ Manage（skills/memory/cron）两区段，把 cron/skills 从"隐藏"改为显式入口；**dev-api.js Web 模式真实实现**：sessions / logs / skills / memory 从占位桩升级为真实实现（`spawnSync` + fs），统一 `hermesPath()` / `exportHermesSessions()` / `parseSkillMeta()` / `tailFile()` 辅助；**安全加固**：shell 注入面消除（`execSync` 手工转义 → `spawnSync` 数组参数）、路径穿越检查加固（`startsWith(dir + path.sep)`）、大日志 OOM 防护（`tail -n` 有限窗口读取）；**i18n 扩展**：+22 键（11 logs* + 11 memory* + sectionManage），zh-CN 源扩充后经 i18n-fill.js 自动传播至 9 个 locale；**推荐版本→2026.4.12**（Active Memory 插件、LM Studio 提供者、Bundled Codex、`commands.list` RPC、`openclaw exec-policy` 命令）；**跳过项**：service.rs cleanup_zombie 重构（上游已演化为 LAST_KNOWN_GATEWAY_PID + /health 探测架构，我们维持 Linux fuser 简版） | v1.4.2 |
| 2026-04-17 | v0.13.3（无新版本） | **仅审计对齐，无实质同步** — 上游 HEAD `a798f4e` 相对我们上次同步点仅 `08b767b` 一个实质提交（Rust `rand 0.9.2→0.9.4` transitive deps 安全升级）。经评估 vulnerable code path（`rand::rng()` in custom logger）不会触发，与上次同步决策一致**继续跳过**。本版本聚焦内部工程：Knowledge Karpathy Wiki 模块、激活码全模块解锁、SOP i18n 对齐 ClawSwarm、DAG 共享配色收口、`docs/workflow-architecture.md` 工作流文档。 | v1.6.0 |
| 2026-04-16 | v0.13.3 | **Critical fix 同步**:#212 AI 气泡空白(`src/style/chat.css` 顶部 5 行 `.msg-ai .msg-bubble .msg-text` 修复)、#215 HTTPS WebSocket Mixed Content(`src/pages/chat-debug.js` 两处 `ws://` 抽成 `buildGatewayWsUrl` helper,自动切 ws/wss)、#219 多实例版本检测(`src-tauri/src/commands/config.rs` `get_local_version` 顶部加 `openclaw status --json` 优先读 runtimeVersion + `read_version_from_installation` 加 own_pkg 检查)、引擎切换无限加载(`src/lib/engine-manager.js` activateEngine 加 invalidate API 缓存 + 复用 `withTimeout` 10s 超时;`src/router.js` navigate 同 hash 时手动 `reloadCurrentRoute` 兜底,`withTimeout` export 化;`src/components/sidebar.js` `_switchEngineAndNavigate` 加 catch 错误处理 + toast 提示;`src/pages/dashboard.js` 每个 API 请求独立 `withTimeout` 包裹);**Silent bug 修复**:`src/lib/tauri-api.js` `invalidate()` 无参之前是 no-op,改为 `_cache.clear()`(否则 engine-manager 的"切换时清缓存"实际无效);**i18n 扩展**:+1 键 `pages.engine.switchFailed`,zh-CN/en 手动加,9 个其他 locale 经 i18n-fill 自动传播。**跳过项**:(1) `src/main.js` 新增热更新按钮 + `about.js` 配套 6 i18n 键 — **维持 v1.2.8"热更新移除"决策**;(2) `src/engines/hermes/pages/dashboard.js` 新增"打开面板"卡片 + `engine.dashOpenPanel/Desc` 2 i18n 键 — **被 v1.5.0 Agent Studio 重构覆盖**;(3) `src-tauri/src/utils.rs` CLI 路径优先级调整 — **我们已彻底移除 candidates 兜底,仅走 enhanced_path,效果等价或更激进**;(4) `src/lib/tauri-api.js` invalidate 清 _inflight + `downloadFrontendUpdate` 加 version 参数 — **我们没有 _inflight 字段;`expectedVersion` 参数已存在**;(5) `src-tauri/src/commands/update.rs` `.version` 文件机制 — **我们已实现等价机制(`UPDATE_VERSION_FILE` + `UPDATE_READY_FILE` 双文件,比上游更严密)**;(6) `hermes.rs` 4 处 clippy 风格、`messaging.rs/mod.rs` rustfmt 多行链式 — 无功能影响;(7) Rust `rand 0.9.4` 安全升级 — `rand 0.9.x` 仅为 transitive dep,vulnerable code path 不会触发,留待下次 | v1.5.1 |

## 待同步项（需 fetch 上游代码对比）

- **SkillHub 安全校验**：上游 v0.9.7 增加 SHA-256 + VirusTotal 校验，需评估我们是否从 SkillHub 直接安装技能
- **渠道插件版本智能适配**：上游 v0.10.0 安装渠道插件时自动 pin 版本匹配 OpenClaw 版本
- **微信 QR 渲染**：上游 v0.10.0 安装/登录流程自动渲染二维码图片
- **工作区文件面板**：上游 v0.11.0 在 Chat 页新增实时文件浏览器
- **service.rs 自动修复**：上游 v0.12.0 的 auto-fix config mismatch + 进程超时保护（已评估，风险较高，留待下次同步）
- **config.rs 预安装清理**：上游 v0.12.0 安装前杀残留进程 + standalone 双格式 manifest（已评估，留待下次同步）
- **Hermes 页面补全**：services.js/config.js/channels.js 为占位页面，上游后续版本可能补充实际内容

## 同步策略

1. **不做 git merge**：分叉太大，直接 merge 会产生大量冲突
2. **Cherry-pick 式同步**：对比上游变更，手动将有价值的改进移植到我们的代码中
3. **关注核心页面**：channels.js、gateway.js、services.js、skills.js 是主要同步点
4. **投资域页面不受影响**：上游没有这些页面，无需同步
5. **定期检查**：每个上游 release 发布后评估是否需要同步
