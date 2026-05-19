# Changelog

遵循 [Keep a Changelog](https://keepachangelog.com/) 风格 + [SemVer](https://semver.org/) 版本号。

`-ce.N` 后缀表示 Community Edition 的迭代号。

## [Unreleased]

聚合 sync/invest-2026-05 与 sync/invest-2026-06 两批次同步,发版时合并到下一个 -ce 版本号。

---

### sync/invest-2026-06 — 引擎选择 + 升级硬化 + Hermes 卡死探针 + Windows 弹窗

聚焦"已有功能 fix + 性能 + 安全",从 invest v1.10.7 → v1.10.14 之间 24 个新 commit 中摘取 4 个,符合"已有功能"原则。

#### 修复

- **启动引擎选择智能回退**(同步自 invest `df5dd02`):用户误点过 Hermes 主线后,即使 Hermes 未装也每次启动卡在 setup。现在 `engineMode` 持久化为 hermes 但 `checkHermes` 显示未就绪时,本次启动回退 openclaw。不回写 clawpanel.json — 双向自愈。
- **Hermes 引擎初始化空头支票**(同 `df5dd02`):`activateEngine(persist=false)` 不调 `engine.boot()`,Hermes 模式下 `_ready` 永远 false、15s 轮询从不启动、boot 逻辑误判未就绪重定向到 `/h/setup`。`initEngineManager` 在 mode 最终为 hermes 时补 `hermes.boot()`(10s 超时保护)。
- **OpenClaw 升级前自动备份**(同步自 invest `47bd66d`,v1.10.8):`upgrade_openclaw_inner` 入口前自动 `create_backup()` `~/.openclaw/openclaw.json`,升级失败 / 新内核写坏配置时可在「备份与恢复」一键回退。
- **Gateway 卡死探针**(同 `47bd66d` service.rs):`guardian_tick` 在进程在但 `/health` 端点连续 3 次无响应时,视为宕机自动 `reload_gateway`(2s 超时探针,失败累计,成功重置)。消灭"进程没崩但请求全挂"的 silent downtime。
- **Guardian 根因识别扩展**(同 `47bd66d`):`CONFIG_ERROR_PATTERNS` 加 9 个 ECONNREFUSED / ENOTFOUND / ETIMEDOUT / EMFILE / TLS 证书等模式;guardian-banner 增加 `network` / `fdlimit` / `tls` 三类根因 tip。
- **Hermes 安装日志脱敏**(同 `47bd66d`):新增 `sanitize_hermes_install_output()`,所有 `hermes-install-log` emit 与错误返回过此层,把 GitHub URL `git+https://...@v2026.5.7` 替换为简洁的 `hermes-agent`,不向用户暴露上游底层细节。
- **chat.js loadHistory 并发竞态**(同 `47bd66d`):`_loadHistoryGen` 代际计数,连续触发时只保留最后一次的结果,避免抖动 / 重复渲染。
- **memory.js / skills.js XSS 隐患**(同步自 invest `ca62b5d` 摘取,v1.10.10):本地 `escHtml` 仅转义 `&<>` 缺 `"`/`'` 转义 → 改用 `escape.js#escapeHtml`(覆盖 5 字符),与 `sync-05` 的 channels.js / services.js 修复同源。
- **Windows 关机阶段 0xc0000142 弹窗**(同步自 invest `8bfc138`,v1.10.9 / 上游 v0.15.3):删除 `RunEvent::Exit` 的 Windows shutdown handler。旧实现在退出阶段启动 `cmd /c taskkill` 关闭 Gateway 终端窗口,Windows 关机阶段 cmd.exe DLL 初始化失败触发弹窗。接受 Gateway 终端窗口残留换取零 popup。

#### 性能 / 内存

- **boot Promise.all 并发拉平**(同 `47bd66d` main.js):`ensureWebSession` / `loadActiveInstance` / `detectOpenclawStatus` 三路改为并发,而非 then 串接。
- **boot 兜底**(同 `47bd66d` main.js):主链路任何环节抛错都兜底显示错误 UI + 重试按钮,而不是 splash 永久挂死。
- **`readOpenclawConfig` / `readMcpConfig` TTL 15→60s**(同 `47bd66d`):减少冷启动 4× RPC 重复调用。
- **`assistant.js` streaming visibility 联动**(同 `47bd66d`):用户切到其他 Tab/窗口时跳过 markdown 重渲,省主线程。
- **`cron.js render` 去 `await`**(同 `47bd66d`):违反 render 立即返回 DOM 准则,改 fire-and-forget 让 `fetchJobs` 后台跑。

#### Guardian Banner UX

- **"回到推荐版本"自救按钮**(同 `47bd66d`):give_up 状态下新增按钮直跳 `/about` 页,用户可见推荐 OpenClaw 版本 + 切换按钮。

#### 同步追踪

- 已 port:`df5dd02`(完整)/ `47bd66d`(摘取 22 文件)/ `8bfc138`(lib.rs 唯一实质改动)/ `ca62b5d`(memory/skills.js XSS 摘取)
- 跳过:`star-office.js`(CE 无)、`automation.js`(CE 无)、`tests/openclaw-version-policy.test.js`(CE 无)、`run_openclaw_compat_repair_after_upgrade`(CE 无该函数)、`openclaw-version-policy.json`(CE baseline 2026.4.12)
- 跳过批次(不符合"已有功能 fix"原则):`77b7ca3`(上游 v0.16.0 17 cherry-pick,需独立批次评估)/ `ebcc8cd`(Hermes 流式 fallback,CE 无 backend 前置)/ `bbf1318`(依赖 CE 没有的 Hermes responses API)/ `ff7f8da` / `7815d9f` / `6bcc8e6` / `9918fca`(多安装管理 — CE 无此 feature)/ 视觉新功能 `a8d299d` / `8a74149` / `1f6aab8`(persona / hero / F6 channel modal)

---

### sync/invest-2026-05 — 关键安全升级 + 基础设施修复

从商业版 ClawPanelInvest(v1.10.7)同步通用 fix。本批仅包含**关键安全升级 + 基础设施修复**,功能性同步(Hermes 三大运维页、渠道治理 UX、provider OAuth 等)将分批次进行。

### ⚠ 破坏性变更

- **Hermes Agent 升级到 0.13.0**(Tenacity Release,release tag `v2026.5.7`):8 个 P0 安全漏洞修复 + 默认开启 redaction + multi-agent Kanban + `/goal` 命令。**升级后用户需手动更新 `~/.hermes/config.yaml` 中部分 platform 的 env var 名称**(panel 这一侧不维护 platform env 映射表,完全透明转发用户配置)。env var 重命名映射:
  - `bluebubbles.HOST` → `SERVER_URL`
  - `email.USER` → `ADDRESS`
  - `homeassistant.URL` / `TOKEN` → `HASS_URL` / `HASS_TOKEN`
  - `dingtalk.APP_KEY` / `SECRET` → `CLIENT_ID` / `SECRET`
  - `signal.PHONE_NUMBER` → `ACCOUNT`
  - `whatsapp` 删除 `API_TOKEN`(改用外部 bridge)
  - `matrix` 删除 `USER`(从 access token 推断)
  - yuanbao 默认 emoji 💬 → 🤖
- 同时引入 GitHub URL 版本 pin(`@v2026.5.7`),取代之前裸 main 分支安装。CE 用户现在能精确锁定 Hermes 版本,避免随上游 main 漂移。

### 修复

- **`enhanced_path` 三平台补齐 cargo/go/deno/.local/bin**(同步 invest `d191810`):Tauri 子进程现在能在 PATH 中找到 `~/.cargo/bin`、`~/go/bin`、`~/.deno/bin`(三平台)以及 macOS 的 `~/.local/bin`(uv/pipx 装的 Python AI CLI)。修复"用户 shell 跑 OK、Privix 内 command not found"的诊断盲区,影响所有用 Rust/Go/Deno/uv 装的外部 MCP server 与 CLI 工具。

### 新增 — Hermes 三大运维页落地(对应 UPSTREAM.md 第 5 项 ✅ 完成)

- **`/h/channels`**:19 个 messaging platform 启停管理。卡片显示 required/missing env、enable toggle(api_server/cli 锁定)、跳转 YAML 配置。新增 RPC `hermes_list_channels` / `hermes_set_channel_enabled` + 通用化 `check_platform_enabled` / `patch_yaml_set_platform_enabled`。
- **`/h/services`**:4 服务卡(Gateway / API Server / Cron / Channels)+ 状态徽标 + 跳转 CTA。Gateway 运行 + api_server 启用时展开 API Server 卡片:一键复制 endpoint URL + 折叠 curl 示例。
- **`/h/config`**:`~/.hermes/config.yaml` 编辑器。textarea + 加载/保存/重启 Gateway,支持 `?focus=key` 查询参数自动滚动到目标顶层节。
- 配套新 lib:`gateway-restart-queue.js`(防抖串行重启队列,同步上游 v0.14.0)、`async-button.js`(防双击 + loading 态)、`error-report.js`(统一错误上报)。
- i18n 11 locale 新增 ~34 个 channels*/services* key + 3 个 comp_toast key(复制错误按钮)。

### 安全修复

- **escHtml 属性转义 XSS 修复**(同步自 invest `71df25e`):channels.js / services.js 原本地 `escHtml` 仅转义 `&<>` 三字符,在 `data-key="${...}"` / `title="${...}"` 等属性场景下不转义引号会造成 XSS 风险。统一改为 `src/lib/escape.js` 的 `escapeHtml`(覆盖 5 字符,与 mcp.js / agents.js / knowledge.js 等已有调用方一致)。

### 新增 — Module A 插件冲突主动检测(同步自 invest `cdda719` 摘取)

- **`src/lib/openclaw-plugin-doctor.js`** — audit/repair pattern,识别 6 个 legacy → official 映射(`openclaw-lark` → `@openclaw/feishu` 等)。导出 `runPluginDoctor()` / `auditPluginConflicts()` / `repairPluginConflicts()`。
- **Plugin Hub 顶部黄色 banner** — render() 后台异步扫,有冲突列出 legacy/official/action,一键修复(串行 install official + toggle legacy false),修复后自动 restartGateway。

### 新增 — Module D Gateway Guardian 状态暴露(同步自 invest `cdda719` 摘取)

- **`src-tauri/src/commands/service.rs`** — `GuardianRuntimeState` + `GuardianStatus` 加 `last_config_error: Option<String>` 字段;guardian_tick 触发 `give_up` 时把 `check_gateway_err_log_for_config_error` 的结果写入 state;Gateway 恢复 running 时清空;`reset_guardian` 清空。
- **`src/components/guardian-banner.js`** — 根据 `lastConfigError` 关键字分发 5 种根因 tip(EADDRINUSE / EACCES / SyntaxError / Cannot find module / generic),提供"手动重启"(走 `reset_guardian` + `restart_gateway`)/ 跳诊断页 / 暂时隐藏 按钮。监听后端 `guardian-event` 事件自动刷新。
- **Dashboard 顶部挂载** — page-header 后插 banner host,cleanup 时正确卸载 Tauri event listener。

### 新增 — OAuth Provider Doctor(同步自 invest `18cf7cd` Bug 1 摘取)

- **`src/lib/openclaw-provider-doctor.js`** — 修复 OpenClaw 5.4+ 自动注入的 `*-portal` OAuth provider 与 API Key sibling 共存时,fallback chain 全在挂掉的 OAuth 上导致 Telegram bot 失效的问题。audit/repair 模式:`auditModelDefaults()` 检测 primary/fallbacks 是否指向未认证 OAuth provider → `repairModelDefaults()` 切到 API Key sibling + 清 OAuth fallbacks + disable 残缺 OAuth provider node → write + reload Gateway。
- **`src/main.js` boot hook** — 24h localStorage 节流执行(`privix_oauth_doctor_last_run`),avoid 每次冷启动都 reload Gateway。修复后 toast 提示。
- 已知 OAuth provider 映射:`minimax-portal` → `minimax`、`kimi-coding-portal` → `kimi-coding`、`moonshot-portal` → `moonshot`。

### 同步追踪

- 阶段 1(关键安全 + 基础设施):`66c0db4`(部分,版本 pin)、`d191810`(完整)
- 阶段 2(Hermes 三大运维页):`74a7f08` 摘 channels/services/config 部分、`71df25e` 摘 escapeHtml 安全修复
- 阶段 3.1(Plugin doctor + Guardian banner):`cdda719` 摘 Module A + Module D
- 阶段 3.2(OAuth provider doctor):`18cf7cd` 摘 Bug 1(provider-doctor + main.js boot hook)
- 下一批:`cdda719` Module B/C/E、`18cf7cd` Bug 2/3/4(重命名 / 多模态聊天 / version-migration)、`7b3a1d9` feature gates 等

## [2.1.0-ce.1] - 2026-04-20

社区版差异化里程碑:引入 ProspectResearch 研究工作台与三项隐私功能,明确"**隐私优先的 AI 研究工作台**"定位。

### 新增

- **零遥测守卫 (`npm run check:telemetry`)**:扫描 `src/` / `src-tauri/src/` / `scripts/` 全部硬编码 URL,与 `scripts/telemetry-allowlist.txt`(98 条允许域名)比对,未登记即 fail。接入 pre-commit hook,CI 强制。README 新增"零遥测承诺"章节明确不做任何使用分析、错误上报、心跳、自动更新。
- **敏感信息检测脱敏 (`src/lib/sensitive-detect.js`)**:发送消息前自动扫描 Anthropic/OpenAI/Google API Key、JWT、PEM 私钥、中国身份证(GB 11643 checksum)、中国手机号、银行卡(Luhn 校验)。命中弹窗提供 [掩码发送 / 移除包含行 / 原文发送(需二次确认) / 取消] 四种动作。设置页"敏感信息检测"区块可按类型勾选。12 个单测覆盖检测 + 校验 + 索引处理。
- **ProspectResearch 研究工作台(`/research`)**:从商业版 EvoScientist 移植通用多轮研究 / 综述 / 引用追溯 flow,**剥离 PE/VC 行业 KB 依赖**(`task-case-templates.js`、行业 case 画廊、`pevc-kb` 相关代码)。ported 5 个 evoscientist-* lib + 页面 + CSS + doc-export + 401 个 i18n key(11 locales)。侧边栏新增主线图标。
- **Workspace 工作区隔离**:每个 workspace 拥有独立 localStorage 命名空间 `pcws.<id>.*`,默认工作区用裸键兼容现有用户数据。Sidebar 顶部新增 switcher 下拉菜单,支持切换 / 新建 / 重命名 / 删除(含数据清理)。13 个单测覆盖 CRUD + 跨 ws 隔离 + 全局键共享。

### 变更

- 版本号跃升到 `2.1.0-ce.1`(minor bump,表示功能新增)
- `package.json` 新增 `check:telemetry` script,并接入 `install-git-hooks.js` 生成的 pre-commit hook
- `src/main.js` 顶部最早 import `workspace-storage.js` 并 `installWorkspaceStorage()`,确保后续模块所有 localStorage 访问经过命名空间
- `src/components/sidebar.js` `getNavPillars()` 插入 ProspectResearch 主线;`ICONS` 新增 `research` compass 图标
- `UPSTREAM.md` 新增 "CE ↔ 商业版 ProspectResearch 同步表",指导以后商业版改动如何选择性 port
- ESLint 全局添加 `btoa` / `atob`(DOM Base64 API)

## [2.0.0-ce.2] - 2026-04-20

### Cleanup (audit D)
- Remove residual invest_workbench / evoscientist / doc_sop / local_qa_kb dead code across 30+ files
- Simplify quick-setup wizard from 4 steps to 2 steps (OpenClaw status + completion)
- Remove /api license backend (commercial authorization server)
- Fix deploy.sh URLs pointing to legacy repo

## [2.0.0-ce.1] — 2026-04-19

Privix Community 首个独立开源发行版。从 Privix 内部版本 v1.6.0-fix1 拉出,以 Apache-2.0 开源,与商业版彻底切断。

### 加入(相对于上游 ClawPanel v0.13.3 基线)

- **Hermes Agent 引擎集成**:双引擎架构,8 页面 + 25 个 Rust 命令,SSE 流式对话 + Python 集成
- **Claw Doctor(钳子医生)**:独立 AI 助手,支持 15+ 模型服务商、80+ 模型预设、多模态图文对话、工具调用、Agent 灵魂移植
- **多实例管理**:一个客户端管理多个 OpenClaw 实例
- **Apple Design 设计系统**:SF Pro 字体 + 980px 胶囊 CTA + navigation glass
- **消息渠道丰富**:Telegram / Discord / 飞书 / 钉钉 / QQ / 企业微信 / 微信 / Slack
- **版本特性门控**:按 OpenClaw 版本动态显隐功能

### 移除(相对于 Privix 商业版 v1.6.0-fix1)

- 激活码 / 授权系统(license-gate、Rust `license.rs`、product profile `licensePolicy`)
- Invest 工作台(20+ 页面:pool、pipeline、companies、contacts、deal、scoring、audit、automation、invest-dashboard、invest-docs 等)
- Knowledge Wiki 模块(Karpathy 式知识库:kb-wiki-ingest/prompts/query、`kb_wiki.rs`)
- SOP 引擎(DAG 依赖、执行监督、模式归纳)
- ProspectResearch / EvoScientist 科研智能体(`evoscientist.rs` + Python bridge)
- ClawSwarm 多 Agent 蜂群编排(7 libs + `swarm_chat_complete` 命令)
- Star Office / 像素宠物工作台游戏化
- 自动更新检查(`check_frontend_update` 等 4 个命令、检查器循环)
- 官网 portal、`release-to-portal.sh`、Vercel CDN 分发、`privix.cn` phone-home
- Extension 命令(cftunnel / ClawApp)

### 许可证

- **本项目整体**:Apache License 2.0
- **上游 ClawPanel 衍生代码**:保留 MIT 原许可
- 详见 [LICENSE](./LICENSE) 与 [NOTICE](./NOTICE)
