# 更新日志

本项目的所有重要变更都将记录在此文件中。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [1.6.0-fix1] - 2026-04-19

### 修复 · Code Review 强化

- **路径穿越防御深度** — [kb_wiki.rs](src-tauri/src/commands/kb_wiki.rs) 新增 `canonicalize_ancestor()` helper：向上找第一个存在的祖先并 canonicalize，再拼回剩余 suffix。即使 wiki 内预埋指向外部的符号链接（攻击者预置），解析后的路径也会被 `starts_with(wiki_canon)` 拦下。原 `unwrap_or_else(|_| parent.to_path_buf())` 软化降级已移除。配套 2 个 Rust 测试：`canonicalize_ancestor_resolves_existing_root` + `canonicalize_ancestor_follows_symlink_out_of_wiki`
- **null 安全** — [kb-wiki-ingest.js](src/lib/kb-wiki-ingest.js) `applyWikiIngestFiles` refs 计算 `.filter(f => f.path.startsWith('pages/'))` → `.filter(f => f?.path?.startsWith('pages/'))`，修复空/畸形 files 条目导致 refs 计算崩溃（由新测试 `跳过无效条目` 暴露）
- **Rust 0 warning** — [hermes.rs](src-tauri/src/commands/hermes.rs) 删 2 个未用 `use`（`ExitStatusExt` @70、`io::Read` @1134），`cargo check` 产出归零。对齐 CLAUDE.md 规范 `cargo clippy -- -D warnings`
- **DOM 清理一致性** — [knowledge.js](src/pages/knowledge.js) `cleanup()` 新增 `document.getElementById('knowledge-page-styles')?.remove()`，卸载后不再遗留 `<style>` 块。与其他 page 的清理模式对齐
- **CSS token 合规** — [wiki-ingest-modal.js](src/components/wiki-ingest-modal.js) badge 硬编码色（`#10b981 / #f59e0b / #9ca3af`）改用 `var(--success)` / `var(--warning)` / `var(--text-tertiary)` token，浅/深主题自动适配
- **测试对齐实际** — [model-presets.test.js](tests/model-presets.test.js) `kimi-code` preset 断言修正：`baseUrl` 加 `/v1` 后缀、`api` 字段改 `openai-completions`（测试从 ee26a56 引入时就和代码有 drift，现在对齐）

### 新增 · 测试覆盖

- 新 [tests/kb-wiki-ingest.test.js](tests/kb-wiki-ingest.test.js)（5 case）— `runWikiIngest` 参数校验 + `applyWikiIngestFiles` 空数组 / refs 截断到 8 条 / 跳过无效条目 / 只保留 pages/ 前缀的 refs
- 新 [tests/kb-wiki-query.test.js](tests/kb-wiki-query.test.js)（4 case）— `runWikiQuery` 参数校验 + `adoptSynthesisProposal` 写入路径 + manual log refs 规范化

### 官网用户指南

- [beginner-guide](https://www.privix.cn/beginner-guide) Step 7「随便逛逛」加「知识库 Wiki（v1.6.0 新增）」子节：Karpathy 式 Wiki 一句话介绍 + Ingest/Query/Lint 一条龙 + 入口位置
- [usage-guide](https://www.privix.cn/usage-guide) 新增 Step 07 完整 Knowledge Wiki 段：5 步流程 + 「什么时候值得用」callout + `wiki/` 目录结构 CSS 示意图（Apple docs 风代码树，三语同步）
- [agent-guide](https://www.privix.cn/agent-guide) 结构化 KB 第 6 节追加 Knowledge Karpathy Wiki 全量条目（骨架 / 三类页面 / 命令名 / 前端库路径 / Hermes fallback）
- 三份指南 hero 徽章 v1.4.5 / v1.5.0 → v1.6.0（zh-CN / en / ja 同步）

### 测试结果

- `npm test`：**283 / 283** 通过（新增 9 case，全绿）
- `cargo check`：0 warning
- `cargo test kb_wiki`：2 / 2 通过（新增 Rust 测试）
- `npm run i18n:check:strict`：11 locale 全绿

## [1.6.0] - 2026-04-17

### 新增 · Knowledge Wiki 模块（Karpathy 式 LLM 维护知识库）

参考 Andrej Karpathy 的 [LLM Wiki 设计](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)，为 KB 新增「Wiki 模式」— 三层架构 `raw/ + wiki/ + SCHEMA.md`，LLM 按 Karpathy 结构增量维护交叉引用的 markdown 知识库。

- **Wiki 骨架 + 文件树 UI** — KB 详情页加 `[文件] [Wiki]` Tab。Wiki Tab 一键初始化 `wiki/{SCHEMA.md, index.md, log.md, pages/{entities,concepts,synthesis}/}`，左侧树 + 右侧 [markdown.js](src/lib/markdown.js) 渲染，支持「在 Obsidian 中打开」（Tauri shell）。新 [src-tauri/src/commands/kb_wiki.rs](src-tauri/src/commands/kb_wiki.rs) 8 个命令：`kb_wiki_init / tree / read / write / append_log / propose_ingest / lint / export_obsidian`（路径穿越防护 + .md 白名单）
- **Karpathy 式 Ingest** — 文件列表每行加「Ingest 到 Wiki」按钮。流程：propose_ingest 读 SCHEMA + index + log 尾 20 条 + 源内容 → [kb-wiki-prompts.js](src/lib/kb-wiki-prompts.js) 组装 system/user prompt → [assistant-runtime](src/lib/assistant-runtime.js) 通过 Hermes Agent 异步合成（不可用时降级到手动粘贴）→ 解析 ` ```file:path ` 代码块 → [wiki-ingest-modal.js](src/components/wiki-ingest-modal.js) 左右栏 diff 预览（new/update 徽章 + 全选 indeterminate + markdown 双栏对比）→ 选中采纳批量写入 + 自动追加 log
- **Query 合成** — Wiki Tab「询问 Wiki」按钮，LLM 基于 SCHEMA + index 合成带 `[[page-name]]` citation 的答案；答案里的 `synthesis-proposal` 代码块可一键「采纳为新页」落盘到 `pages/synthesis/`，并自动追加 manual log
- **Lint 扫描** — 一键 `kb_wiki_lint`：识别 orphans（pages/ 未被引用）、stale（mtime > 90 天 + 未出现在 log.md）、broken_links（`[[xxx]]` 指向不存在的页），按三分组展示 + 自动追加 lint log
- **Obsidian 导出** — 一键复制 wiki/ 到任意目录 + 创建 `.obsidian/{community-plugins.json,app.json}` 预装 Dataview + livePreview；dry_run 先统计 count/bytes，用户确认后再写

### 变更 · 激活码统一全模块解锁

- **激活码不再按模块细分** — [license-gate.js `syncEnabledModules`](src/lib/license-gate.js) 后端下发的 `state.enabledModules` 仅作"是否激活"判断，**任一有效激活码自动解锁 invest + knowledge + sop 全部业务模块**；[MODULE_META](src/lib/product-profile.js) description 统一为"激活后默认解锁"
- **`MODULE_IDS` / `MODULE_ROUTES` / `isRouteModuleEnabled` 骨架保留**，仍按模块组织路由，只是 gate 策略全部放开

### 工作流清理 · 对齐 ClawSwarm 规范

- **SOP 状态标签 i18n 迁移** — [sop-engine.js](src/lib/sop-engine.js) `PLAN_STATUS_LABELS` / `STEP_STATUS_LABELS` 从硬编码中文改为 Proxy + `getPlanStatusLabels()` / `getStepStatusLabels()` getter，对齐 [clawswarm-state.js](src/lib/clawswarm-state.js:29) 模式；locale-invalidated cache 消除密集渲染时每行 6-7 次 `t()` 调用热点；调用点（sop-flow / sop-invest）零修改，13 个新 i18n key × 11 locale
- **DAG 共享配色收口** — 新 [dag-styling.js](src/lib/dag-styling.js) 单一来源，三套配色并存但集中管理：`VIVID_STATUS_COLORS`（饱和色 / badge）、`PASTEL_STATUS_FILLS`（浅彩 / SOP flow 节点）、`DARK_NODE_FILLS + DARK_NODE_STROKES`（深色 / ClawSwarm viz），附 `withAlpha()` / `getVivid|Pastel|DarkNode*` 安全包装。`sop-flow.js` 和 `clawswarm-viz.js` 改为 import 共享色板
- **TaskDescriptor 类型骨架** — 新 [task-descriptor.js](src/lib/task-descriptor.js) JSDoc typedef，为 ClawSwarm SwarmAgent / SOP TaskStep / EvoScientist session 建立跨系统词汇；`normalizeTaskStatus()` 把扩展状态归一到 4 值通用集。纯类型，零运行时副作用
- **架构文档** — 新 [docs/workflow-architecture.md](docs/workflow-architecture.md) 梳理 4 套工作流系统（ClawSwarm / SOP / EvoScientist / Workflows 审批）的职责边界 + 决策树 + 共享词汇 + 持久化现状 + License 模块关系 + open-claude-code 架构对照（未采纳留作参考）+ sop.js vs sop-invest.js 去重审计结论（不抽取）

### 工程清理 · 去重与效率

- **`escapeHtml` 项目级去重** — 删 [knowledge.js](src/pages/knowledge.js) 和 [wiki-ingest-modal.js](src/components/wiki-ingest-modal.js) 的 4 字符本地版（漏单引号、XSS 风险），改用 [src/lib/escape.js](src/lib/escape.js) 的 5 字符共享实现
- **`runLlmWithFallback()` 共享 helper** — [kb-wiki-prompts.js](src/lib/kb-wiki-prompts.js) 新增，把 Hermes agent run + `askLlmManually` fallback 的 try/catch 模式抽离，ingest / query 共用（消除 ~30 行重复）
- **`kb_wiki_dir_path` Rust 命令** — 移除 [knowledge.js](src/pages/knowledge.js) 里硬编码的 `~/.openclaw/prospectclaw/local_qa_kb/knowledge/{kbId}/wiki` 路径镜像
- **`handleWikiSelect` 减一次全量 render**（去掉 "loading…" 中间态）；**Query 并发 `Promise.all`** 读 SCHEMA + index（原串行两次 IPC）；**Diff modal `readExisting` 并发**批量检查 new vs update（原 N 次串行）
- **全选 checkbox indeterminate 态**（部分选中 UX）；Rust `regex_lite_link()` → `build_link_regex()`（原名误导）；删未用的 `onProgress` 参数

### 上游同步

- **与 [qingchencloud/clawpanel](https://github.com/qingchencloud/clawpanel/) main 保持对齐** — 经核查，上游自 v0.13.3 无新 tag 或实质功能提交；仅 Rust `rand 0.9.4` transitive deps 安全升级（漏洞路径不触发，与上次同步决策一致，跳过）。详见 [UPSTREAM.md](UPSTREAM.md)

### i18n 扩充

- zh-CN 源扩充 +76 键（13 sop_status / 31 wiki_* / 15 wiki_log & obsidian / 17 components.wiki_ingest），en 手动对齐，9 个其他 locale 经 `i18n-fill.js` 自动传播；pre-commit `i18n:check:strict` 11 locale 全绿

### 测试与质量

- 新 [tests/kb-wiki-prompts.test.js](tests/kb-wiki-prompts.test.js) 13 个 test case 覆盖 prompt 构造、log 截断、` ```file:path ` 代码块解析、路径安全、synthesis proposal
- Rust `cargo check` 通过；270/271 test pass（仅 Kimi preset pre-existing 失败，与本版本无关）

## [1.5.1] - 2026-04-16

### 上游同步 · v0.13.3 critical fix (Upstream Sync)

按 cherry-pick 同步策略合入 [qingchencloud/clawpanel v0.13.3](https://github.com/qingchencloud/clawpanel/releases/tag/v0.13.3) 4 个 critical bug fix,跳过与 v1.2.8「热更新移除」决策反向的热更新按钮、以及被 v1.5.0 Agent Studio 重构覆盖的 Hermes "打开面板"卡片。详见 [UPSTREAM.md](UPSTREAM.md) 同步历史 2026-04-16 行。

- **修复 #212 AI 消息气泡空白渲染** — [chat.css](src/style/chat.css) 顶部新增 `.msg-ai .msg-bubble .msg-text { display:block; color:var(--text-primary) }`,防止气泡内 markdown 节点因父级 flex/inline 布局塌陷
- **修复 #215 HTTPS Web 模式 WebSocket Mixed Content** — [chat-debug.js](src/pages/chat-debug.js) 抽 `buildGatewayWsUrl()` helper,Tauri 桌面端走 `ws://`,HTTPS Web 模式自动切 `wss://`
- **修复 #219 多实例版本检测错误** — [config.rs `get_local_version`](src-tauri/src/commands/config.rs:871) 顶部增加 `openclaw status --json` 优先读 `runtimeVersion`,避免多 OpenClaw 实例共存时通过路径推断选错版本(如用户激活 nvm 但被 Homebrew 残留覆盖);`read_version_from_installation` 增加同目录 `package.json` own_pkg 检查
- **修复引擎切换偶发无限加载** — [engine-manager.js `activateEngine`](src/lib/engine-manager.js:74) 切换时清 API 缓存(`invalidate()`)+ `withTimeout(boot, 10s)` 兜底,避免引擎 boot 慢请求把 sidebar 卡 loading;[router.js `navigate`](src/router.js:56) 同 hash 时手动 `reloadCurrentRoute()` 兜底;[sidebar.js `_switchEngineAndNavigate`](src/components/sidebar.js:282) 加 `.catch` 错误处理 + toast 提示,失败不再卡 placeholder;[dashboard.js `_loadDashboardDataInner`](src/pages/dashboard.js:80) 8 个 API 各自独立 `withTimeout` 包裹,任意慢请求不再拖垮整体仪表盘渲染

### 工程清理 (Engineering Cleanup)

- **修复 `invalidate()` 无参 = no-op 的 silent bug** — [tauri-api.js](src/lib/tauri-api.js:128) 之前 `invalidate()` 无参时 `cmds.some(...)` 返回 false 什么也没清,导致 engine-manager 的「切换时清缓存」实际无效;现在无参直接 `_cache.clear()`
- **`withTimeout` 工具函数收敛** — [router.js](src/router.js:192) 的 `withTimeout` export 化,[dashboard.js](src/pages/dashboard.js)、[engine-manager.js](src/lib/engine-manager.js) 复用同一份,删本地副本 + Promise.race 内联
- **i18n 扩展** — 新增 `pages.engine.switchFailed` 一键,zh-CN / en 手动加,9 个其他 locale 经 `i18n-fill.js` 自动传播,11 locale 严格审计通过

## [1.5.0] - 2026-04-15

### 新增 · Agent Studio 五件套 (Added · Agent Studio Bundle)

对标 [iOfficeAI/AionUi](https://github.com/iOfficeAI/AionUi),v1.5 将五条"跨 Agent"能力打包为 Agent Studio,首次让 Privix 拥有「一屏看到本机所有 AI 能力 + AI 产出实时预览」两个直观体验。

- **① CLI Agent 自动检测** — 新增 [agent_detect.rs](src-tauri/src/commands/agent_detect.rs) 扫描 `PATH` + Node/Homebrew/Volta/fnm/nvm 等已知目录,识别 12 款常见 CLI Agent(Claude Code、OpenAI Codex、Gemini CLI、Qwen Code、Goose、OpenClaw、iFlow、Kimi CLI、OpenCode、Factory Droid、Qoder、CodeBuddy),展示版本与安装指引链接;入口在 [agents.js](src/pages/agents.js) 顶部扫描条,3 秒超时保护,跨 macOS / Linux / Windows
- **② LLM Provider 扩充到 23 家** — [model-presets.js](src/lib/model-presets.js) 新增 OpenRouter、ModelScope 魔搭、阶跃星辰 StepFun、零一万物 01.AI、腾讯混元 Hunyuan、百度千帆 Qianfan、Poe by Quora、AWS Bedrock、LM Studio 共 9 个 provider,配套默认模型预设,对齐 AionUi 的 20+ 平台覆盖
- **③ MCP 统一配置 UI** — 新页面 [src/pages/mcp.js](src/pages/mcp.js) 挂在侧栏 OpenClaw 组下(`/mcp`),读写 `~/.openclaw/mcp.json`,提供 filesystem / github / fetch / memory / sqlite / puppeteer 六个模板一键添加、启停 toggle、JSON 编辑器、删除前二次确认;一次配置,所有接入 Agent 共享
- **④ 智能预览面板** — 新增 [preview-panel.js](src/components/preview-panel.js) 右侧滑出抽屉,支持 Markdown / 代码(高亮)/ HTML(sandboxed iframe 严格隔离)/ 图片 四种格式预览,带"渲染 / 原文"切换与复制原文;MutationObserver 自动给 Assistant / Chat / ClawSwarm 消息气泡中的 `<pre>` 代码块挂 👁 预览按钮;全局 API `window.privixPreview({ type, content, title })` 可从任意上下文触发
- **⑤ CSS 自定义主题** — 新增 [theme.rs](src-tauri/src/commands/theme.rs) 读写 `~/.privix/user.css`,启动时由 [theme.js](src/lib/theme.js) `initUserCss()` 注入到 `<head>`,可覆盖 Apple Design 默认 token(主色、字体、间距等);[settings.js](src/pages/settings.js) 新增「CSS 自定义主题 ✨」开关 + 在编辑器打开 + 重新加载三件套,首次点开时会自动创建带示例的模板文件

### 文档与国际化 (Docs & i18n)

- **11 locale 同步补齐** — `sidebar.mcp` / `pages.mcp.*` / `pages.agents.cli_detect_*` / `pages.settings.user_css_*` / `comp_preview.*` 共 40+ 新 key 在 zh-CN / zh-TW / en / ja / ko / ar / de / es / fr / pt-BR / ru 全量补齐,pre-commit 严格审计通过

### 工程细节 (Engineering)

- 17 个 Rust 单元测试全绿(新增 `agent_detect::tests::known_agents_have_unique_ids` / `known_agents_have_binaries`)
- Vite 生产构建干净通过
- 侧栏新增 MCP 图标 + `/mcp` 路由注册;预览面板通过 MutationObserver 实现零侵入式增强,不改动现有 Chat / Assistant / ClawSwarm 页面源码
- AWS Bedrock 标注为"需 LiteLLM 或类似 OpenAI 兼容代理",SigV4 原生签名留给后续版本

## [1.4.5-fix2] - 2026-04-15

### 修复 · Hermes Chat 面板循环与推理泄漏 (Fixed · Hermes Chat Loop & Reasoning Leak)

- **修复 Hermes 面板无限重试** — 当 `~/.hermes/config.yaml` 中的 `delegation:` 被写成 YAML `null` 时，Hermes 在 `delegate_task` 路径会触发 `'NoneType' object has no attribute 'get'` 并陷入 API 重试循环；Privix 现在会在保存配置、读取配置和启动 Agent Run 前自动把该区块规范化为 `delegation: {}`
- **修复 Privix 面板显示原始 `<think>`** — Hermes 聊天面板现在会过滤流式 delta 与最终回复中的隐藏推理标签，不再把模型内部 reasoning 直接渲染进对话气泡
- **保留 MiniMax / 本地 Gateway 链路修复** — 继续沿用 `1.4.5-fix1` 的 MiniMax provider 对齐和配置读写修复，并在本次补丁包中一并发布，避免“terminal 可用、面板卡死”的割裂状态

## [1.4.5-fix1] - 2026-04-15

### 修复 · Hermes Provider 配置 (Fixed · Hermes Provider Config)

- **Hermes 原生 provider 读写对齐** — Privix 保存/读取 Hermes 配置时，MiniMax、Moonshot/Kimi、智谱 GLM、阿里云百炼、DeepSeek、xAI、Gemini 等 provider 现在都会按 Hermes 原生 `.env` 变量族写入与回读，不再把国产厂商误落到 `ANTHROPIC_*` / `OPENAI_*`
- **MiniMax 兼容多种官方端点** — 同时识别 `api.minimax.chat`、`api.minimax.io`、`api.minimaxi.com`，确保中国区 / 国际区与历史端点都能被页面正确识别、展示与保存
- **OpenRouter / Gemini 配置链路补齐** — Hermes 管理页现在会读取 `OPENROUTER_BASE_URL`，安装向导中的 Gemini 模型抓取也改为识别当前使用的 `google-gemini` API 类型，避免误按 OpenAI 兼容接口请求
- **config.yaml 顶层 `model:` 修复延续** — 继续限制 Privix 只更新 Hermes 顶层 `model:` 区块，并把原生 provider alias 统一成管理页可识别的预设 key，避免已有 terminal 配置在页面中“读不回来”

## [1.4.5] - 2026-04-15

### 品牌收口 (Branding)

- **公共对外表面统一为 Privix** — README、产品介绍、桌面发版说明、官网/下载口径、DMG 命名与窗口标题说明统一切到 `Privix`；GitHub Release 保留为归档备份，不再作为官网下载安装源
- **钳子助手 → 钳子医生 / Claw Doctor** — 对外文案与产品介绍同步切换到“医生式”定位，突出诊断、修复、运维与尽调场景；内部路由 `/assistant`、id、localStorage 键与兼容逻辑保持不变

### 修复 · UI 与导航收尾 (Fixed · UI & Navigation)

- **全站 DOM emoji 清理收尾** — dashboard / plugin-hub / clawswarm / audit / diagnose / skills / route-map / evoscientist / automation / setup / scoring / knowledge / welcome-modal / help-fab 等页面完成 SVG icon 化；数据层仅保留 runtime fallback，不再直接把 emoji 渲染进主要 UI
- **ClawSwarm 图标体系升级** — 5 套模板、24 个 Agent 角色和导出/校验/配置动作统一补齐 `iconId` → SVG 渲染链路，模板画廊、运行卡片、报告按钮与空态图标全部 Apple 化
- **Hermes 跨主线自动切换** — Hermes 模式下访问 OpenClaw 专属路由时，侧边栏会先执行 `switchEngine('openclaw')` 再导航，避免功能被“藏起来”；`/assistant` 仍作为共享入口不触发切换
- **Overview / Header / Sidebar 精修** — 深色 overview 卡片改与 sidebar 共享同源 dark surface token；顶部栏和侧边栏布局同步调整，引擎路由策略拆到 `engine-route-policy.js` 并补充测试

### 变更 · 发布流程 (Changed · Release)

- **单一 Privix 发版流程固化** — v1.4.2+ 正式发版不再默认构建 `invest_workbench` / `local_qa_kb` / `doc_sop` 三套包，改为统一 `./scripts/build.sh release` 输出单一 Privix 安装包；历史 `profile:*` / `release:desktop:all` 仅保留兼容
- **OpenClaw 推荐版本映射补齐** — `openclaw-version-policy.json` 补齐 `1.4.3`、`1.4.4`、`1.4.5` 面板版本到 OpenClaw `2026.4.12`

## [1.4.3] - 2026-04-14

### 修复 · UI 精修批次 (Fixed · UI)

- **Overview 深色卡片与侧边栏同源** — `.overview-v2-card[data-variant="dark"]` 原用 `--surface-near-black`(深色主题下被镜像为 `#f5f5f7`,与 sidebar 始终深底完全不一致);新增 `--card-dark-surface` token 与 `--sidebar-surface` 双主题同源(浅主题 0.82α / 深主题 0.88α),卡片与导航视觉联动
- **插件市场 CSS 从零补齐** — `plugin-hub.js` 引用的 14 个 `plugin-*` 选择器在 pages.css / components.css 中全部缺样式,页面无排版;新增 ~140 行 Apple 风格 CSS:auto-fill 300px 网格、8px radius 卡片、hover 抬升 + `--shadow-card`、状态点三色(绿/灰/红)、内置徽章 pill 形、深色主题镜像、640px 响应式单列
- **蜂群协作(`/clawswarm`)深度 Apple 化** — 整页视觉重设计,模板画廊网格 `minmax(260px,1fr)` + 8px radius + hover 抬升,DAG 表格去边框偶数行微灰,Agent 详情卡片化(`--surface-light` 底),运行状态卡按 `data-status` 分色边框,完成页 stats pill 化;按钮批量迁移 `.btn-primary/secondary` → `.btn-pill-filled/outline`,模板卡改 `<button>` 语义,DOM 改动最小(13 处,全部保留 29 个 data-action);CSS 1167 → 1389 行覆盖更完整的变体 + 暗色镜像 + 响应式
- **引擎跨主线自动切换** — 原 `getHermesNavPillars()` 仅保留 3 主线(hermes + quick-setup + system),跨业务能力(ProspectResearch / 蜂群 / 钳子助手 / 投资 / AI 办公室)在 Hermes 模式下隐藏;现镜像 OpenClaw 模式返回 8 主线,OpenClaw 专属路由附 `data-requires-engine-switch="openclaw"`,点击时先 `switchEngine('openclaw')` 自动切回 + toast 提示 + 重绘侧边栏,再 `navigate(target)`;`/assistant` 共享路由不触发切换
- **Portal 暗色主题标题不可读** — 外部 `Hxitech/prospectclaw-portal` 仓库 `.section-light` 子元素(.section-title / .showcase-title / .tutorial-card-title / .tutorial-step-title / .doc-card-title / .tech-card-title / .download-card-title)硬编码 `color: #1d1d1f`,暗色模式下 `.section-light` 背景也镜像为 `#1d1d1f`,深底深字不可读;补齐 `[data-theme="dark"]` 子选择器覆盖为白色 + 副标题/描述 72% 白

### 关键文件
- `src/style/variables.css`(新增 `--card-dark-surface` 双主题 token)
- `src/style/pages.css`(G-1 改 1 行 + G-2 新增插件市场 ~140 行)
- `src/style/clawswarm.css`(G-3 大幅重写)
- `src/pages/clawswarm.js`(G-3 13 处 DOM/class 迁移)
- `src/components/sidebar.js`(G-4 getHermesNavPillars 镜像 + 点击拦截)
- `/Users/sang/Documents/ProspectClawPortal/portal.css`(G-5 12 行暗色覆盖)

## [1.4.2] - 2026-04-14

### 上游同步 (Upstream Sync)

同步上游 [qingchencloud/clawpanel](https://github.com/qingchencloud/clawpanel) **v0.13.2**(2026-04-13 发布)+ OpenClaw **2026.4.12**:

- **Hermes 日志查看器** — 新增 `/h/logs` 页面,文件列表 + 级别过滤(ALL/DEBUG/INFO/WARNING/ERROR/CRITICAL)+ 关键词搜索 + 行数选择(100/200/500/1000)+ 加载完自动滚动到底部
- **Hermes 记忆编辑器** — 新增 `/h/memory` 页面,读写 `~/.hermes/memories/MEMORY.md` 与 `USER.md`,复用 `src/lib/markdown.js` 的 `renderMarkdown` 统一渲染,编辑/预览切换 + 未保存提醒
- **Hermes 引擎导航重构** — `getNavItems()` 重新分组为 Monitor(dashboard/chat/logs)+ Manage(skills/memory/cron)两个区段;此前 cron/skills 路由已存在但未在 sidebar 暴露,现全部可达
- **dev-api.js Web 模式真实实现** — `hermes_sessions_list/detail/delete/rename`、`hermes_logs_list/read`、`hermes_skills_list/skill_detail`、`hermes_memory_read/write` 10 个命令从占位桩升级为真实实现(fs + Hermes CLI);统一 `hermesPath()` / `memoryFileName()` / `exportHermesSessions()` / `parseSkillMeta()` / `runHermesSubcommand()` / `tailFile()` 辅助
- **i18n 扩展 +22 键** — `pages.engine.*` 新增 11 个 `logs*` + 11 个 `memory*` 键,`sidebar.sectionManage` 新增;`scripts/i18n-fill.js` 自动传播到 9 个 locale
- **OpenClaw 推荐版本 → 2026.4.12** — `openclaw-version-policy.json` 默认推荐与 panel `1.4.2` 条目均指向 4.12;4.12 特性:Active Memory 插件(记忆子 Agent)、LM Studio 本地模型提供者、Bundled Codex、`commands.list` RPC 命令发现、`openclaw exec-policy`、插件激活收窄到 manifest 声明

### 安全 / 质量加固 (Security & Quality)

- **Shell 注入面消除** — Hermes CLI 调用从 `execSync` + 手动单引号转义改为 `spawnSync('hermes', [...args])` 数组参数(无 shell),`sessionId` / `title` 等用户输入不再参与 shell 解析
- **大日志 OOM 防护** — `hermes_logs_read` 从 `readFileSync(...).slice(-N)`(整文件入内存)改为优先 `tail -n`,Windows / tail 缺失时回退;多 GB 日志不再触发内存激增
- **路径穿越检查加固** — `hermes_logs_read` / `hermes_skill_detail` 的路径前缀匹配改为 `startsWith(dir + path.sep)` + 精确相等,消除 `/foo/.hermes/skills-evil/` 绕过
- **logs.js 时间戳解析 bug** — `replace(regex, '$1') || fallback` 的 `||` 分支永远不会触发(replace 无匹配仍返回原字符串),改为 `match()` 显式判空
- **logs.js autoScroll 修复** — 此前每次 `draw()` 都强制滚到底,键入搜索时把用户滚动位置顶回底部;改为仅在 `loadEntries()` 完成后那一帧滚动
- **memory.js markdown** — 移除 14 行内联 `mdToHtml`(产出 `<li>` 无 `<ul>` 包裹、heading 前插入多余 `<br>`、无 href 校验),复用 `src/lib/markdown.js:renderMarkdown`

### 跳过项(留待后续评估)

- `service.rs cleanup_zombie_gateway_processes` 上游已演化为 `LAST_KNOWN_GATEWAY_PID` + `/health` 探测架构;我们维持 Linux `fuser`-only 简版,不受上游修复的 bug 影响
- OpenClaw `2026.4.14-beta.1` 预发布版本

### 修复 · UX (Fixed · UX)

- **Bug 1 · 侧边栏 Hermes 主线冗余** — 顶部引擎切换器已有 segmented 滑块,侧边栏 pillar 2 的 Hermes 单入口重复,已删除;主线数量从 9 降为 8(行业模块 / OpenClaw / ProspectResearch / Claw Swarm / Claw Assistant / AI 办公室 / 一键配置 / 系统设置)
- **Bug 2 · 一级菜单默认全展开** — 行业模块 / OpenClaw / 系统设置 等折叠组默认展开,信息过载;改为默认全部折叠,仅当前路由所在的主线自动展开,用户按需点击头部 toggle
- **Bug 3 · 引擎切换绕过引导** — 活跃引擎未就绪时只检查 OpenClaw 状态,切到 Hermes 后可访问全部侧边栏项目绕过 Hermes setup;现在 `showSetupShell`、路由守卫、boot 重定向三处都引擎感知,Hermes 未就绪时强制走 `/h/setup`
- **引擎切换器 dropdown → segmented 滑块** — 原 dropdown 半透明背景与下方「全局概览」nav 项视觉重叠,改为 Apple 风格二态滑块(`data-engine-active` 驱动 220ms 缓动),无层级/透明度问题,点击直接切换

### 变更 · 架构 (Changed · Architecture)

- **Setup Shell 引擎感知** — `getUnifiedSetupNavItems` 首项路由动态解析为 `activeEngine.getSetupRoute()`(OpenClaw → `/setup`,Hermes → `/h/setup`)
- **路由守卫跨引擎修复** — `main.js` `isRouteAllowed` 失败分支 / setup-safe 检查 / boot 重定向均引擎感知,`/h/*` 子路由在 Hermes 模式下自动视为 safe
- **废弃 Profile 系统** — `CLAUDE.md` 标注 `PROSPECTCLAW_PRODUCT_PROFILE` 与 `profile:invest/qa/sop` 脚本为历史兼容,新发布不再切换 profile,行业模块通过 license 运行时激活

## [1.4.1] - 2026-04-14

### 新增 (Added)

- **Apple 设计系统** — 全面采用 `DESIGN.md` 的 Apple HIG 规范:SF Pro Display/Text 字体、Apple Blue `#0071e3` 单一强调色、二元黑/`#f5f5f7` 色调、56px hero / 40px section / 28px tile / 17px body 字号阶、980px 胶囊 CTA、navigation glass、`rgba(0,0,0,0.22) 3px 5px 30px` 软阴影
- **9 主线侧边栏** — 内联折叠组架构取代旧的 flyout 弹出模式:行业模块(动态)/ Hermes / OpenClaw / ProspectResearch / Claw Swarm / Claw Assistant / AI 办公室 / 一键配置 / 系统设置;Hermes 引擎模式下收敛为 4 主线子集
- **Overview Apple 化** — 9 卡片网格对应 9 主线,OpenClaw 与 Hermes 各自独立卡片,奇浅偶深交替节奏,56px SF Pro Display hero
- **一键配置向导** (`/quick-setup`) — 4 步 Apple 风格向导统一 OpenClaw 状态 / AI Provider / 行业模块 / 完成确认,替代原散落的 `open-ai-config-wizard` modal
- **i18n 审计工具链** — `scripts/check-i18n-keys.js` 扩展支持 per-locale 报告 / 孤立 key 检测 / 动态 key 提示 / strict 全量模式 / JSON 输出;新增 `npm run i18n:check` / `i18n:check:strict` / `i18n:orphans` / `i18n:install-hook`
- **pre-commit hook 安装器** — `scripts/install-git-hooks.js` 一键安装 commit 前 `i18n:check:strict` 阻断机制
- **i18n 批量回填** — `scripts/i18n-fill.js` 深度合并 zh-CN 到 9 个非主 locale,zh-TW 额外做简→繁字符映射(人工翻译自动保留不覆盖)

### 修复 (Fixed)

- **4 个 i18n 破损页** — `plugin-hub.js`(namespace `extensions.*` → `pages.plugin_hub.*`)、`dreaming.js`(新建 `pages.dreaming.*` 60+ keys)、`diagnose.js`(新建 `pages.diagnose.*` 22 keys)、`route-map.js`(新建 `pages.route_map.*` 22 keys)
- **Hermes 引擎 i18n** — 8 个 Hermes pages 的 `engine.*` 命名空间统一迁移到 `pages.engine.*`,补齐 138 个 keys
- **diagnose.js 崩溃** — 移除未用的 `isTauriRuntime` import(非导出符号,曾导致页面加载失败)
- **quick-setup re-mount 失效** — 原 `_bound` 模块 flag 导致第二次进入页面 click 监听静默丢失,改为 `_clickHandler` 引用绑到 page 元素
- **假成功 step 4** — 移除 `_state.ai.configured = true` 乐观标记(用户未完成 wizard 就虚假报 OK)
- **引擎切换侧边栏失同步** — `onEngineChange` / `onInstanceChange` 加 dirty-check 守卫,未变更不触发重渲染

### 变更 (Changed)

- **CI 加入 i18n 严格模式** — `.github/workflows/ci.yml.disabled` 增加 `npm run i18n:check:strict` 和 `npm run test` 步骤
- **36 页面 Apple 令牌化** — about / settings / security / logs / usage / services / channels / models / agents / memory / cron / 13 个 Invest 页 / 9 个系统工具页 / 3 个工作区页,统一 `.apple-section` / `.apple-hero` / `.apple-body-secondary` / `.btn-pill-filled` 等工具类
- **11 locale 全覆盖** — zh-CN/en/zh-TW/ja/ko/es/fr/de/pt-BR/ar/ru 均 0 缺失,strict 模式通过
- **sidebar.js 架构精简** — 删除 `getUnifiedNavZones` / `ZONE_ICONS` / flyout 事件监听 / navMode 切换按钮 / `_positionFlyoutPanel` 等 ~200 行旧代码,新增 `getNavPillars` / `getActiveIndustryModule` / `getHermesNavPillars` / `switchEngineToHermes`

### 删除 (Removed)

- **死代码 `src/pages/extensions.js`** — 无路由注册,不可达,连同 `pages.extensions` i18n 子树一并清理
- **Flyout 导航模式** — `localStorage['prospectclaw-nav-mode']` 旧存储一次性迁移清除;相关 CSS(137 行)、事件监听、footer 切换按钮全部删除
- **rtl.css 死选择器** — `.flyout-zone-arrow` 类已不存在
- **sidebar 死代码** — 4 个未使用的 `getXxxZoneItems` helper、2 个未使用的 import(`PRODUCT_PROFILE_IDS` / `getRouteModule`)

## [1.4.0] - 2026-04-13

### 新增 (Added)

- **多引擎架构** — 新增 engine-manager.js 引擎注册/切换/持久化系统，支持 OpenClaw 和 Hermes Agent 双引擎
- **Hermes Agent 引擎** — 完整移植上游 v0.13.0 Hermes 引擎：8 个页面（setup/dashboard/chat/services/config/channels/cron/skills）、Rust 后端 25 个 Tauri 命令、30 个前端 API 函数
- **引擎切换器** — Sidebar 顶部新增引擎切换下拉菜单，支持在 OpenClaw 和 Hermes 模式间切换
- **仪表盘骨架屏** — 概览区域加载时显示骨架占位动画
- **Dreaming 导入消化** — OpenClaw 4.11+ 新增「导入消化」子标签页，支持 ChatGPT 对话历史导入（特性门控）
- **Memory Palace** — OpenClaw 4.11+ 新增「Memory Palace」子标签页，展示长期记忆知识图谱（特性门控）
- **助手媒体气泡** — 工具结果中的视频/音频/图片 URL 自动渲染为结构化媒体气泡
- **授权服务器** — 新增独立 license-server（Vercel 部署），支持授权码创建、设备激活、状态查询；About 页面集成授权状态展示与激活交互

### 修复 (Fixed)

- **假更新检测** — About 页面现在验证远程版本确实比当前版本新，防止 false-positive 更新提示
- **向导可点击** — Setup 页面各阶段标题可点击折叠/展开，已完成的阶段可以回看
- **仪表盘引擎感知** — Hermes 模式下隐藏 OpenClaw Gateway 状态卡片
- **SSL 证书验证** — 授权服务器数据库连接启用 SSL 证书校验（`rejectUnauthorized: true`），防止 MITM 攻击
- **Admin Token 时序安全** — 管理员接口 Bearer Token 改用 `crypto.timingSafeEqual` 比较，防止时序攻击
- **XSS 防护** — About 页面 `escapeHtml` 补充单引号转义（`'` → `&#39;`）
- **i18n 缺失** — 补充 8 语言卸载进度翻译（`uninstall_stopping/removing/cleaning/done`）

### 变更 (Changed)

- **品牌重命名** — 全局 ClawPanelInvest → Privix，包括 GitHub URL、脚本、文档、Rust 后端 User-Agent
- **路由注册重构** — main.js boot() 从 43 条硬编码 registerRoute 改为引擎驱动的动态路由注册
- **推荐版本** — OpenClaw 推荐版本更新至 2026.4.11
- **硬编码路径** — docs/generate-manual.cjs 和 3 个 gen-*.cjs 脚本改为相对路径
- **版本号** — 1.3.0-fix1 → 1.4.0

### 同步 (Upstream Sync)

- 同步上游 v0.13.0 + v0.13.1（多引擎架构、Hermes Agent、加载骨架屏、假更新修复、可点击向导）
- 新增 dreaming-import 和 memory-palace 特性门控（OpenClaw 0.13.0+）

## [1.3.0-fix1] - 2026-04-12

### 性能优化 (Performance)

- **Rust 配置缓存** — `openclaw_dir()` 添加 RwLock 缓存，`gateway_listen_port()` 添加 5s TTL 缓存，消除 Guardian 每 15s tick 的 10+ 次磁盘读取
- **启动并行化** — `loadActiveInstance()` 和 `detectOpenclawStatus()` 改为 `Promise.all()` 并行，节省 50-200ms
- **Sidebar 增量渲染** — EvoScientist badge 和主题菜单改为 DOM 局部更新，不再全量重建 700+ 行 HTML
- **Router 去重** — 移除路由切换时 2 次多余的 `innerHTML = ''` 重算
- **Guardian 异步化** — macOS `check_service_status` 用 `spawn_blocking` 包装，避免阻塞 Tokio
- **CSS 优化** — 移除 5 处 `backdrop-filter: saturate(180%) blur(20px)`，减少 GPU 每帧开销
- **精准缓存失效** — `instanceSetActive` 从 `_cache.clear()` 改为只失效实例相关的 13 个 key

### 修复 (Fixes)

- **Sidebar 主题选择器** — 修复 `data-theme` → `data-theme-preset` 属性名不匹配导致主题菜单增量更新无效
- **install_plugin 环境** — 添加 `enhanced_path()` + `apply_proxy_env()`，符合项目规范
- **toggle_plugin 配置写入** — 改用 `save_openclaw_json()` 统一写入流程
- **list_all_plugins** — 合并 `package.json` 双次读取为单次

## [1.3.0] - 2026-04-11

### 上游同步 (Upstream v0.12.0)

#### 新增功能页面
- **Dreaming 页面** — 自主 Agent 框架 UI（session 管理、动画控制、状态追踪）
- **Plugin Hub 页面** — 插件发现、安装与管理（GitHub 源安装）
- **Route Map 页面** — 渠道→Agent 绑定 SVG 可视化
- **Diagnose 页面** — Gateway 连接诊断（配置检查、TCP 探测、设备密钥、Origin 校验、错误日志）

#### 面板版本门控
- **新增 feature-gates.js** — 按 OpenClaw 版本动态显隐功能（dreaming ≥ 0.11.0, cron ≥ 0.10.0 等）
- **Sidebar 门控** — 导航项支持 `gate` 属性，自动隐藏不可用功能

#### WebSocket 增强
- **密码认证** — 支持 token + password 双重认证模式
- **凭据自动刷新** — token/password 失效时从 openclaw.json 重读并重连
- **心跳检测** — 90s 无消息自动触发重连，防止静默断连
- **消息缓存 + 去重** — 缓存最近 100 条消息，Set 跟踪防重复
- **Close Code 精确分流** — 4001（配置重载→自动重连）、1008（按 reason 分流：origin/unauthorized/pairing/rate-limit）
- **DetailCode 路由** — 握手失败按 detailCode 自动修复或给出精准提示
- **新增 RPC** — sessions.compaction.*, skills.search/detail, exec.approval.*, plugin.approval.*

#### Rust 后端
- **diagnose.rs** — 新增 Gateway 连接诊断模块（6 步检查 + 结构化结果）
- **probe_gateway_port** — TCP 端口探测命令（前端 WS 连接前确认端口可达）
- **插件管理** — list_all_plugins / toggle_plugin / install_plugin 三件套

#### 页面改进
- **Dashboard** — WebSocket 状态指示器 + 已连接渠道概览 + 日志彩色级别标签
- **Skills** — Gateway RPC 优先（wsClient.skillsSearch/Detail → Tauri API fallback）
- **About** — 卸载进度标签定制（stopping → removing → cleaning → done）

## [1.2.8-fix5] - 2026-04-10

### Session 持久化 (Session Persistence)

#### Gateway 断连恢复
- **新建 session-store.js** — 统一会话缓存层，协调 IndexedDB ↔ Gateway 同步；断连后仍可查看聊天历史
- **确定性 Session Key** — 客户端生成稳定 key（`WsClient.generateSessionKey`），重连时尝试 `sessions.resume` 恢复旧 session
- **重连自动同步** — Gateway 恢复后自动增量同步历史（仅写入本地缺失的消息，避免盲写）

#### ClawSwarm Agent 会话落盘
- **磁盘持久化** — agent 对话历史落盘到 `swarm-sessions.json`，3 秒 debounce 写入，10MB 自动裁剪
- **Rust 后端** — 新增 `read_swarm_sessions` / `write_swarm_sessions` Tauri 命令（含 .bak 备份）
- **崩溃恢复** — `initSwarmSessions()` 启动时从磁盘恢复 agent 会话

#### IndexedDB 升级 (v2)
- **启用 sessions store** — 新增会话元信息管理（`saveSessionMeta` / `listSessionMetas` 等）
- **清理函数** — `pruneSessionMessages` 超限裁剪、`purgeOldMessages` 定期清理（每小时最多一次）
- **消息计数** — `getMessageCount` 高效计数

## [1.2.8-fix4] - 2026-04-10

### 导出引擎 (Export Engine)

#### EvoScientist 导出全部改为本地
- **新增 HTML 本地导出** — `doc-export.js` 新增 `markdownToHtml()`，生成带内嵌 CSS 的完整 HTML 文档（响应式布局、打印友好、深蓝配色）
- **去除 Gateway 依赖** — 移除 `exportViaOpenClaw()`、`getOpenclawFormatPrompts()` 及 Gateway 连接状态检查
- **统一导出面板** — 三个本地导出按钮（DOCX / PPTX / HTML），不再需要 OpenClaw Gateway 连接
- **离线可用** — 所有导出格式均为纯前端转换，无需网络

## [1.2.8-fix3] - 2026-04-09

### 代码质量 & 清理 (Code Quality & Cleanup)

#### 移除晴辰科技 (QTCOOL) 赞助集成
- **完整移除** — 删除 QTCOOL 配置对象、API Key、`fetchQtcoolModels` 函数、PROVIDER_PRESETS 中的 qtcool 条目
- **UI 清理** — 移除 AI 助手页和模型配置页的 QTCOOL 推广面板及一键接入逻辑
- **知识库清理** — 移除 openclaw-kb.js 中的公益 AI 接口文档段落
- **i18n 清理** — 删除 zh-CN / en / zh-TW / ja 中 40+ 个 qtcool 相关翻译 key
- **文档清理** — 移除 CONTRIBUTING.md 和 release workflow 中的 claw.qt.cool 引用

#### i18n 国际化补全
- **77 处 TODO 全部消除** — 补全 `welcome-modal`(20 处)、`invest-copilot`(24 处)、`services`(8 处)、`about`(4 处)、`chat`(3 处)、`evoscientist`(3 处)、`ai-drawer`(1 处) 中的硬编码中文
- **新增 ~70 个 i18n key** — zh-CN 和 en 双语覆盖

#### ESLint 静态分析
- **新增 `eslint.config.js`** — ESLint 9+ flat config，分 Browser / Node.js / Test 三环境
- **新增 `npm run lint`** — 可执行 `npm run lint` 和 `npm run lint:fix`
- **修复 2 个 ESLint 发现的真实 bug** — `icons.js` 重复 key、`clawswarm-state.js` 重复属性覆盖

#### 其他
- **截图脚本参数化** — `capture-screenshots.mjs` 硬编码路径和密码改为环境变量
- **助手默认视图** — 默认显示 chat 视图（而非 governance）
- **chat.js 防御性修复** — guide close 按钮添加空检查

## [1.2.8-fix2] - 2026-04-09

### UI 美化 (UI Beautification)

#### 钳子助手 (Assistant)
- **居中聊天布局** — 消息区域居中对齐，最大宽度 720px，浮动输入框圆角卡片化
- **玻璃态头部** — 毛玻璃 backdrop-filter + 阴影替代边框
- **消息气泡升级** — 用户消息渐变背景 + 阴影，AI 消息左侧强调色边框
- **侧边栏增强** — 活跃会话强调色左边框，头部背景色区分
- **欢迎页 & 快捷按钮** — 渐变背景 + hover 强调色
- **运维卡片** — 边框 + hover 浮起动效
- **默认视图切换** — 打开助手默认显示运维页面（而非聊天）

#### Prospect-Research (evoscientist)
- **状态条玻璃态** — 毛玻璃效果 + 渐变状态背景 + 启动微光动画
- **Surface 卡片层级** — 边框 + hover 浮起，Hero 卡片顶部强调色条 + 渐变背景
- **时间线优化** — 滚动边缘遮罩，按类型彩色左/右边框，新条目光晕脉冲
- **Composer 玻璃态** — 毛玻璃背景，运行进度条发光效果
- **会话卡片** — hover 浮起 + 活跃态渐变背景
- **案例卡片** — 交错入场动画 + hover 强调色边框

#### ClawSwarm (多智能体编排)
- **模板画廊** — 卡片交错入场动画 + hover 浮起强调色边框 + 表情圆形背景
- **Agent 表格现代化** — 分离行间距 + hover 阴影 + 大写字母间距表头 + 放大表情
- **执行卡片** — 运行态强调色边框 + 微光进度条，完成态成功色背景
- **进度条升级** — 6px 渐变填充 + 预算条 10px 药丸标签
- **阶段过渡** — fadeIn + translateY 入场动画
- **双环旋转器** — 40px 双环逆向旋转加载指示器

## [1.2.8-fix1] - 2026-04-09

### 易用性改进 (Usability)

#### Setup 页：无 Node.js 也能安装
- **Standalone 一键安装** — 系统未安装 Node.js 时，Setup 页不再完全禁用安装区域，改为提供 standalone 独立安装包入口（自带 Node.js 运行时）
- 安装后自动完成 Gateway 部署 + `openclaw.json` 关键默认值补丁

#### About 页安装逻辑对齐 Setup 页
- **修复 method 参数缺失** — About 页升级/切换版本时现在正确传递 `method` 参数（official → npm，chinese → auto）
- **安装后自动化** — 升级完成后自动确保 Gateway 已安装 + 补丁配置文件（与 Setup 页一致）

#### 错误信息国际化 + AI 诊断
- **error-diagnosis.js 全面 i18n** — 17 类安装错误全部迁移到 i18n，支持中/英双语
- **新增 standalone 错误诊断** — 清单获取失败、下载中断等 standalone 特有场景
- **升级弹窗 "让 AI 帮我解决" 按钮** — 安装失败时一键跳转 AI 助手，自动携带完整错误日志和诊断上下文

## [1.2.8] - 2026-04-08

### 上游同步 (Upstream Sync)

- **同步 ClawPanel v0.11.5 + v0.11.6 + OpenClaw 2026.4.8**

#### SkillHub SDK 迁移
- **SkillHub 技能商店** — Skills 页新增"搜索安装"Tab，支持全量索引浏览、关键词搜索、一键安装
- **SDK 替代 CLI** — 移除 6 个旧 CLI 依赖命令，新增 3 个 SkillHub SDK 命令（内置 HTTP + zip 解压）
- **多 Agent Skills 目录** — agent_id 路由，每个 Agent 独立 Skills 目录
- **新增后端模块** — `skillhub.rs`（Rust COS CDN + API fallback + 10 分钟缓存）、`skillhub-sdk.js`（Node.js 纯内置 zip 解析）

#### Chat OpenClaw 4.5+ 兼容
- **Agent 事件流** — 支持 lifecycle/item/plan/approval/thinking/command_output 结构化事件
- **3 分钟终极超时** — 实时计时器显示等待时间，防止静默无回复
- **智能状态提示** — 打字指示器显示 AI 当前阶段（处理/搜索/规划/执行/等待审批）

#### Gateway 稳定性
- **仪表盘刷新节流** — Gateway 状态变更监听 5s 节流，防止频繁刷新
- **停止检测加固** — 连续检测阈值 2→3 次，减少误判
- **重启前延迟** — 自动重启前等待 3s + 清缓存，避免竞态

#### 热更新移除
- **About 页简化** — 移除下载/应用/回滚按钮，改为网站 + GitHub 下载链接
- **全局更新横幅** — 热更新按钮替换为 Privix 官网 + Hxitech/ProspectClaw releases 链接

#### 其他
- **Assistant SkillHub 迁移** — AI 助手工具从 ClawHub 重命名为 SkillHub，空灰色气泡修复
- **推荐版本** — OpenClaw 推荐版本升至 2026.4.8

## [1.2.6] - 2026-04-06

### 上游同步 (Upstream Sync)

- **同步 ClawPanel v0.11.4 + OpenClaw 2026.4.5**
- **消息复制按钮** — chat 和 assistant 页面消息 hover 显示复制按钮，点击复制文本
- **Gateway 外部实例认领** — 检测到外部 Gateway 时显示认领按钮，自动认领逻辑（端口 + 数据目录匹配）
- **模型 fallback 不再自动覆盖** — 用户精心配置的 fallback 链不再被每次保存重写 (#190)
- **Git 路径自定义+扫描** — 设置页新增 Git 路径配置区，支持手动指定、一键扫描安装位置
- **Skills bundled 目录推导** — 从 CLI 路径推导 npm 包内的内置 skills 目录

### 新增 (Features)

- **ClawSwarm "从 OpenClaw 获取"按钮** — 配置面板一键从 OpenClaw 主模型回填 provider/model
- **ProspectResearch "从 OpenClaw 获取"按钮** — 快速配置区一键从 OpenClaw 主模型回填
- **共享模型读取工具** (`readOpenclawModels`, `fetchOpenclawPrimaryModel`) — model-presets.js 新增通用 OpenClaw 模型读取函数
- **共享复制按钮处理** (`bindCopyButtons`) — input-helpers.js 新增事件委托工具

## [1.2.5-fix2] - 2026-04-04

### 性能 (Performance)

- **对话体验优化** — 增量 DOM 更新替代全量 innerHTML 替换，消除对话界面闪烁跳动
- **事件批处理** — `scheduleRender()` 用 rAF 合并同帧多事件为单次渲染
- **智能滚动** — 用户上滚浏览历史时不被强制拉回底部
- **CSS 动画优化** — 入场动画只对新条目生效，旧条目不再重播

## [1.2.5-fix1] - 2026-04-04

### 修复 (Fixes)

- **i18n 页面回退** — 回退 26 个页面的 t() 迁移，修复中文文本显示为翻译 key 的问题
- **实时聊天加载修复** — 修复 chat.js 在模���顶层调用 t() 导致页面无法加载的崩溃

## [1.2.5] - 2026-04-04

### 新增 (Features)

- **多语言支持 (i18n)** — 支持 11 种语言：简体中文、English、繁體中文、日本語、한국어、Español、Français、Deutsch、Português (Brasil)、العربية、Русский
- **i18n 核心模块** (`src/lib/i18n.js`) — 零依赖，支持嵌套 key、`{变量}` 插值、`Intl.PluralRules` 复数、RTL 自动切换
- **语言切换器** — 设置页新增界面语言选择器，11 种语言即时切换
- **RTL 支持** — CSS 物理属性转逻辑属性，阿拉伯语自动切换 `dir="rtl"`
- **1328 个翻译 key** — zh-CN.json 基准 + en.json 完整英文翻译

### 变更 (Changes)

- **sidebar.js** — 6 个 const 导航数组改为 getter 函数，所有标签迁移至 `t()`
- **top-header.js** — BREADCRUMBS 对象改为 `getBreadcrumbs()` 函数
- **help-fab.js** — HELP_CONTENT 对象改为 `getHelpContent()` 函数
- **21+ 页面迁移** — 硬编码中文字符串替换为 `t()` 调用
- **CSS RTL** — layout.css、components.css、pages.css、assistant.css、chat.css、invest.css 物理属性转逻辑属性

## [1.2.4] - 2026-04-04

### 变更 (Changes)

- **EvoScientist 更名为 Prospect-Research** — 全部用户可见文本（14 个文件约 80 处）统一更名，内部标识符和路由保持不变
- **工具输出折叠** — 连续的 tool_call/tool_result 条目自动折叠为可展开的分组，显示调用/结果数量和时间范围，避免密集工具调用刷屏

## [1.2.3-fix2] - 2026-04-04

### 新增 (Features)

- **授权码模块控制** — 授权码支持 `enabledModules` 参数，可激活指定模块组合（全模块/投资/知识库/SOP 等任意组合）
- **关于页功能模块列表** — "关于"页面新增"功能模块"区块，展示所有模块及激活状态
- **弹出菜单修复** — Flyout 导航模式支持 Escape 键和点击外部关闭弹出面板

### 变更 (Changes)

- **未激活模块完全隐藏** — 侧边栏不再显示锁定模块（灰色+锁图标），改为完全不渲染
- **作者信息统一** — 全仓库作者统一为 Yuntao Sang，LICENSE 版权主体统一
- **上游 License 标注** — LICENSE 明确标注上游项目 qingchencloud/clawpanel 及 MIT 许可来源

### 修复 (Fixes)

- **弹出菜单分隔线** — 修复锁定 zone 被跳过时仍生成多余分隔线的问题

## [1.2.3-fix1] - 2026-04-04

### 修复 (Fixes)

- **Star Office 默认地址预填** — 连接输入框自动填入 `http://127.0.0.1:19000`，无需手动输入
- **侧边栏导航重构** — 将钳子助手、EvoScientist、ClawSwarm、AI 办公室合并为单一"AI 智能体"区域，从 9 个 zone 精简为 6 个
- **授权码统一激活** — 移除 Rust 端 profile 严格匹配校验，不同产品版本(Invest/Knowledge/SOP)的授权码可在同一设备互通激活

## [1.2.3] - 2026-04-04

### 新增 (Features)

- **EvoScientist 案例画廊** — 空状态重构为可交互的案例模板画廊，12 个预置案例覆盖调研分析、代码工程、内容创作、投资决策、流程运营五大分类。支持分类过滤标签，点击案例一键预填 Composer
- **ClawSwarm 模板画廊** — 输入区顶部新增卡片式模板选择器（替代原纯文本按钮），展示工作流描述、难度等级、预估时间和智能体数量。选择模板自动预填任务目标
- **共享案例模板数据** (`task-case-templates.js`) — 统一的案例模板数据层，EvoScientist 和 ClawSwarm 共享，包含 12 个成功任务案例（竞品分析、尽调报告、代码审查、测试策略、市场测算等）
- **ClawSwarm 模板元数据扩展** — 5 个 Swarm 模板新增详细工作流描述、示例目标、预期产出、难度和预估时间字段

### 安全 (Security)

- **API 频率限制** — Vercel Edge Middleware IP 级滑动窗口限流（activate 5次/分钟，status 20次/分钟，admin 10次/分钟）
- **Token v2** — 授权令牌新增 30 天有效期 + 离线宽限期字段，`verifyLicenseToken` 检查过期
- **自动 Token 续签** — status 端点检测 v1/即将过期的 v2 token 自动下发新 token
- **Ed25519 设备签名** — 客户端使用设备密钥签名授权请求，服务端验证（向后兼容旧客户端）
- **配置篡改检测** — SHA-256 哈希缓存授权配置区域，篡改后拒绝离线宽限
- **本地 Token 过期检查** — v1 token 强制联网升级，过期 v2 强制联网续签

## [1.2.2-fix2] - 2026-04-03

### 新增 (Features)

- **官网 DMG 下载** — 桌面安装包直接从 www.privix.cn/downloads/ 下载
- **前端热更新上线** — 应用内"关于"页自动检测新版本，一键热更新前端（SHA-256 校验），无需重装 DMG
- **publish-update.sh 发版脚本** — 一键构建前端 → 打包 zip → 生成 manifest → 复制到官网仓库

### 变更 (Changes)

- **统一发包** — 三个 profile（Invest/Knowledge/SOP）合并为单一 Privix 桌面包
- **官网下载页改版** — 三个版本卡片合并为一个统一 Privix 下载入口

## [1.2.2-fix1] - 2026-04-03

### 修复 (Fixes)

- **macOS Gateway 状态误报** — `check_service_status` 增加 TCP 端口兜底检测（200ms 超时），解决通过 CLI `openclaw gateway` 直启时面板误报"未启动"的问题；`scan_service_labels` 无 plist 时也返回默认 gateway label
- **授权码 profile 兼容** — 统一 profile ID 后旧授权不会失效：DB 查询匹配所有历史 profile ID（invest_workbench/local_qa_kb/doc_sop/prospectclaw）；token 校验对 `p` 字段做归一化；激活时渐进式更新 DB 行的 profile ID

### 变更 (Changes)

- **上游同步 v0.11.3** — 版本映射修正（-zh 自动识别、unknown 跳过 npm 查询）；多安装检测去重 + VersionInfo 扩展（cli_path/cli_source/all_installations）；detect_installed_source 改进（Intel Mac /usr/local/bin、Linux symlink、canonicalize 补救）；CherryStudio 路径排除
- **OpenClaw 推荐版本** — 官方版升至 2026.4.2，汉化版 2026.4.1-zh.1
- **品牌统一** — Cargo 包名 clawpanel → prospectclaw，三个 profile 合并为统一产品 Privix

## [1.2.0] - 2026-04-01

### 新增 (Features)

- **ClawSwarm 多智能体任务编排系统** — 全新的 AI 多 Agent 任务编排模块，独立于 EvoScientist。用户输入任务目标后，LLM 自动拆解为多步骤计划，以 DAG（有向无环图）管理步骤依赖关系
- **任务拆解引擎** (`clawswarm-engine.js`) — Kahn 拓扑排序 + DAG 验证 + 5 个预设任务模板（市场调研、竞品分析、技术方案、内容创作、项目启动），支持自定义步骤编辑和依赖调整
- **DAG 可视化** (`clawswarm-viz.js`) — SVG 拓扑可视化面板，分层布局算法、步骤状态着色（待执行/进行中/已完成/失败）、交互式步骤选择和详情查看
- **直连 LLM 对话** — 新增 Rust 后端 `swarm_chat_complete` 命令，支持直连 Anthropic / OpenAI / Gemini API（无需经过 OpenClaw Gateway），前端 `clawswarm-llm.js` 实现直连优先 + Gateway 实验性备选的双通道策略
- **工作区系统** (`clawswarm-workspace.js`) — 软沙盒工作区，支持文件夹选择、任务目录自动创建、工作区状态持久化到 localStorage
- **ClawSwarm 页面** (`clawswarm.js`) — 完整页面 UI：任务输入 → LLM 拆解 → 审核表格 → DAG 可视化 → 历史管理，含任务模板选择器、步骤编辑器和执行状态面板
- **侧边栏 ClawSwarm 区域** — 新增 Swarm zone 导航项，全局概览新增 ClawSwarm 卡片
- **一键 AI 配置扩展** — 一键 AI 配置向导新增第 4 个目标系统 ClawSwarm，配置模型时同步写入 Swarm 直连配置

### 修复 (Fixes)

- **Kimi Code Anthropic 兼容认证** — Kimi Code 使用 Bearer token 而非 x-api-key，修复三处 Anthropic 兼容 API 认证
- **思考模型 think 标签剥离** — `<think>...</think>` 标签在 LLM 响应提取时自动剥离（Rust + 前端）
- **MiniMax API 地址修正** — baseUrl 迁移到 `api.minimax.chat`

### 测试 (Tests)

- 新增 `tests/clawswarm-engine.test.js`（引擎单测，538 行）
- 新增 `tests/clawswarm-phase2.test.js`（Phase 2 集成测试，210 行）

## [1.1.9] - 2026-03-31

### 新增 (Features)

- **一键 AI 配置** — 投资工作台新增「一键 AI 配置」功能，4 步向导（选服务商 → 填 API Key → 选模型 → 确认）一键将模型和密钥配置到钳子助手、OpenClaw、EvoScientist 三个系统；内置教程解释 Token、模型、API Key 等概念
- **Dashboard 快速访问卡片放大** — 6 张快速访问卡片从页面底部移至统计数字下方，改为 3 列竖排大卡片（48px 图标、彩色顶边线），每张带独立主题色
- **Star Office 使用教程** — 新增 4 步教程（部署 → 连接 → Agent 联动 → 日常维护），注册到 invest-guide 教程系统；帮助浮窗全部 3 个 profile 均可见
- **渠道插件版本检测** — 飞书、钉钉等带插件的消息渠道在配置弹窗中自动检测当前版本和 npm 最新版本，有更新时显示「升级到最新版」按钮
- **OpenClaw 版本变更后自动重装渠道插件** — 升级/回退 OpenClaw 后自动重装已安装的渠道插件（飞书、钉钉），确保插件与 CLI 版本兼容

### 改进 (Improvements)

- **通用插件版本检测 API** — 新增 Rust 后端 `check_plugin_version_status` 通用命令，可对任意 OpenClaw 插件检测本地版本和 npm 最新版本

## [1.1.9-fix1] - 2026-04-01

### 修复 (Fixes)

- **unknown 版本源回退修复** — `unknown` 安装源不再误判为汉化包来源，版本推荐、安装包名映射、升级与卸载路径统一回退到官方 `openclaw`
- **全局概览运行统计修复** — `/overview` 页面改用正确的 `getServicesStatus()` 和 `listAgents()` 接口，并按 `running` 布尔值统计运行中的服务数量，恢复首页实时统计展示
- **一键 AI 配置模型生效修复** — 投资工作台的一键 AI 配置向导会把用户选择的 OpenClaw 模型真正写入默认主模型，并自动重建回退模型列表，避免“显示配置成功但实际仍用旧模型”

### 测试 (Tests)

- **配置与模型测试补强** — 新增 Rust 单测覆盖 `unknown` 安装源映射逻辑，新增前端单测覆盖默认主模型和回退模型重建逻辑

## [1.1.8-fix6] - 2026-03-31

### 同步上游 (Upstream Sync)

- **MiniMax API 迁移** — baseUrl 迁移至 `api.minimax.io`，新增 M2.5 / M2.7 Highspeed 模型预设
- **Gateway 死循环修复 (#160)** — 自动配对后直接重连，不再调用 `reconnect()` 导致 `_autoPairAttempts` 重置无限循环
- **Linux Gateway 进程检测 (#151)** — 通过 `/proc/{pid}/cmdline` 验证占用端口的进程是否为 OpenClaw，避免误杀其他进程；lsof/proc 回退路径同样补全 `manageable` 字段
- **Docker 双容器模式 (#159)** — `DISABLE_GATEWAY_SPAWN=1` 环境变量禁止本地启动 Gateway
- **systemd PATH 补全 (#156)** — `findOpenclawBin` 新增 `~/.npm-global/bin`、`~/.npm/bin` 搜索路径
- **版本源检测重构** — 活跃 CLI 优先、Windows cmd shim 读取判断包来源、Linux 完整检测链（活跃 CLI → standalone → symlink → npm list → CLI fallback）、standalone 目录集中管理（`all_standalone_dirs` 提升为 `pub(crate)`）、fallback 返回 `unknown` 而非 `official`
- **前端 unknown 来源显示** — 仪表盘、关于页、服务页均适配 `unknown` 源标签

## [1.1.8] - 2026-03-30

### 新增 (Features)

- **EvoScientist 导出路径选择器** — 桌面端导出面板新增「选择文件夹」按钮，可指定 DOCX/HTML/PPTX 生成文件的保存位置，路径回显在导出按钮下方
- **Dashboard EvoScientist 入口卡片** — 仪表盘新增 EvoScientist 概览卡片和 OpenClaw vs EvoScientist 双层架构说明面板（基础设施层 vs 协作层）
- **Star Office 健康状态系统** — 顶栏新增连接状态指示点（绿/黄/红）、错误横幅（含重试/重新部署按钮）、重连按钮；健康探测改用 curl 优先 + python3 后备方案
- **EvoScientist 投资指南** — invest-guide 新增 EvoScientist 引导步骤 (`showEvoscientistGuide()`)，帮助 FAB 新增 EvoScientist 页面上下文帮助

### 修复 (Fixes)

- **30 秒超时未清理** — sendMessage 安全超时在任务完成/异常时正确清除，避免多余 renderAll
- **导出路径初始化重复执行** — 通过标志位保证 `_pathReady` 初始化只执行一次
- **健康检查并发守卫** — Star Office checkHealth 新增 `_healthCheckInFlight` 防重入
- **冗余 HTTP 探针** — 端口未监听时不再发无效探测
- **EvoScientist Spotlight 死代码清理** — 移除 welcome-modal 中未使用的 EVOSCIENTIST_SPOTLIGHT_STEPS

### 改进 (Improvements)

- **EvoScientist 交互阻断守卫** — 任务执行中禁用发送/导出按钮，防止误操作
- **任务输出线程作用域** — taskRunStartIndex + taskOutputThreadId 精确追踪当前任务的输出范围

## [1.1.7] - 2026-03-29

### 新增 (Features)

- **Agentic Swarm 可视化面板** — EvoScientist 协作架构 Tab 新增 Swarm 动画面板：Coordinator 中心脉冲、轨道式 Agent 节点、dash 动画连接线、呼吸光效和浮动粒子，实时展示多科学家协作拓扑
- **Agent 身份系统** — 5 种科学家原型（审慎·校验 / 探索·检索 / 收束·成文 / 落地·操作 / 焦点·协作），每种配有像素风 CSS 头像、专属配色和角色徽章
- **OpenClaw Gateway 导出面板** — EvoScientist 任务完成后，可将 Markdown 输出一键发送到 OpenClaw Agent，由 Gateway 接力转换为 DOCX / HTML / PPTX 格式

### 修复 (Fixes)

- **中断/提问审批卡死修复** — interrupt 和 ask_user 事件到达时正确重置 `_state.sending = false`，解决按钮永久禁用的问题

### 改进 (Improvements)

- **子 Agent 时间线增强** — 子科学家时间线条目显示像素头像和角色徽章，提升协作可读性

## [1.1.6] - 2026-03-29

### 新增 (Features)

- **全局概览页面** (`overview.js`) — 新增 `/overview` 路由作为所有版本的默认首页，展示当前 profile 可用的全部功能板块快速入口卡片，含异步加载的服务和 Agent 统计数据；三个产品版本（Invest / Knowledge / SOP）均以全局概览为默认 homeRoute
- **投资管理板块可折叠** — primary zone 新增 `collapsible: true`，与其他 zone 行为一致；深蓝渐变配色 toggle 按钮，折叠状态持久化到 localStorage
- **Flyout 横向弹出导航模式** — 新增可选导航模式：sidebar 各 zone 显示为紧凑行，hover/click 时子菜单从右侧弹出浮层（`position: fixed` 避免 overflow 裁切）；通过 sidebar footer 的"导航模式"按钮在折叠/弹出模式间切换，偏好持久化到 localStorage；移动端自动 fallback 到折叠模式
- **Star Office 一键部署** — Tauri 桌面端新增一键部署按钮，自动执行 git clone → pip install → 初始化配置 → 启动后端服务，带步骤进度 UI；新增第三方项目声明/License 提示框；手动连接收纳到折叠区域；Web 端保持原有部署说明

### 改进 (Improvements)

- **全局概览 profile 适配** — overview 页面根据当前产品 profile 动态过滤卡片（Invest 版显示投资管理、QA 版显示知识库、SOP 版显示 SOP 配置台），页面标题自动适配产品名称
- **三版本统一导航入口** — 三个产品版本的侧边栏顶部均显示「全局概览」导航项，提供统一的板块入口体验

## [1.1.5] - 2026-03-29

### 新增 (Features)

- **Star Office 区域** (`star-office.js`) — 新增独立导航区域，通过 iframe 嵌入 Star-Office-UI 像素风格 AI 办公室看板，可视化 Agent 工作状态为像素角色动画；支持自定义部署地址配置
- **侧边栏全区可折叠** — 将可折叠行为从仅系统区推广到所有导航区（OPS / Secondary / EvoScientist / Star Office / System），各区折叠状态独立持久化到 localStorage
- **投资仪表盘快速入口** — Invest 版仪表盘新增所有主要功能区的快速跳转卡片，减少导航层级
- **EvoScientist 工作目录持久化** — 默认工作目录选择持久化到 localStorage，页面刷新后不再重置；保存配置时自动同步

### 修复 (Fixes)

- **EvoScientist 工作目录重置** — 修复页面重载后默认 workspace 恢复初始值的问题
- **localStorage 键迁移** — 旧键 `prospectclaw-sys-collapsed` 自动迁移至新格式 `prospectclaw-zone-system-collapsed`

### 改进 (Improvements)

- **Star Office 独立导航区** — 位于 EvoScientist 和系统设置之间，使用紫色配色方案区分

## [1.1.4] - 2026-03-29

### 新增 (Features)

- **Gateway 一键修复** — Gateway 启动失败时显示「一键修复」按钮，弹窗执行 `openclaw doctor --fix` 并显示实时日志
- **开机自启功能** — 面板设置新增开机自启开关（仅 Tauri 桌面版），基于 tauri-plugin-autostart
- **Ollama 原生 API 类型** — API 类型选项新增 `ollama`，自动跳过 /v1 追加
- **Gemini 3.1 模型预设** — 新增 Gemini 3.1 Pro、Flash、Flash Lite 三款模型

### 修复 (Fixes)

- **版本号解析修复** — `openclaw --version` 输出解析从 `split().pop()` 改为 `find(/^\d/)`，正确取版本号而非 commit hash
- **子 Agent 模型配置** — 切换默认模型不再强制覆盖所有子 Agent 的 model.primary（对齐上游 #142）
- **桌面构建修复** — 补齐 `@tauri-apps/plugin-autostart` 的 npm lockfile 与 Tauri lockfile，恢复可构建状态
- **仪表盘缓存修复** — 回退到 API TTL 缓存，避免同一实例内版本信息和运行时摘要长期陈旧
- **汉化版检测兜底** — 版本号含 `-zh` 后缀时强制判定为汉化版，修复 Windows .cmd shim 路径误判
- **Cron 投递参数** — delivery mode 从错误的 `push` 修正为 `announce`，移除无效 `to` 字段
- **Cron 单渠道用户** — 允许单渠道用户选择投递渠道（之前 ≤1 个渠道会隐藏选择器）
- **EvoScientist 快速配置修复** — quick-config 改为真正绑定草稿状态，并支持需要 `base_url` 的 Provider
- **nvm/fnm 版本排序** — 改为按语义版本优先排序，避免 `v9` 被排到 `v24` 前面
- **更新提示持久化** — 关闭更新 banner 从 sessionStorage 改为 localStorage，不再每次重启都弹
- **Ollama URL 修复** — Ollama 原生 API 不再强制追加 /v1 路径
- **macOS 多路径检测** — 同时检查 ARM (/opt/homebrew) 和 Intel (/usr/local) Homebrew 路径及 standalone 安装

### 改进 (Improvements)

- **推荐 OpenClaw 版本** — 从 2026.3.24 更新为 2026.3.28
- **xAI 描述更新** — 提示新的 Responses API 和 x_search 内置搜索能力
- **上游同步** — 对齐 ClawPanel v0.10.0 + OpenClaw 2026.3.28 核心变更

## [1.1.3] - 2026-03-28

### 新增 (Features)

- **EvoScientist 多科学家协作系统** — 全新的 AI 多 Agent 协调编排模块，以 Coordinator（总控协调者）为核心，支持多科学家并行协作、任务拆解与执行监控
- **EvoScientist 工作台** (`evoscientist.js`) — 四 Tab 布局：工作台（状态总览）、聊天（任务执行）、设置（Provider/人格配置）、协作架构（科学家关系可视化）
- **AI 人格系统** (`evoscientist-persona.js`) — 四维人格控制（严谨度/主动性/审慎度/架构思维），支持手动配置、从钳子助手同步、从 OpenClaw 继承、JSON 导入导出
- **8 大 LLM Provider 支持** (`evoscientist-readiness.js`) — Anthropic、OpenAI、Google GenAI、MiniMax、NVIDIA、Custom OpenAI、Custom Anthropic、Ollama，含字段校验与就绪状态检测
- **会话线程管理** — 可恢复的多线程会话，支持上下文快照、线程锁定、工作目录绑定
- **协作架构可视化** — 自动检测子科学家（Reviewer/Researcher/Executor 等角色分类），统计工具调用、中断、子 Agent 事件
- **聊天时间线** — 支持流式消息、思考块、工具调用、中断确认、用户提问表单等丰富消息类型
- **Bridge 运行时管理** — 一键安装/启动/停止 EvoScientist 服务，实时日志流、进度追踪与错误恢复
- **侧边栏 EVO 专区** — 五层导航架构新增 EVO ZONE，含工作台/聊天/设置/协作架构四个快捷入口
- **EvoScientist 状态管理** (`evoscientist-state.js`) — 7 种就绪状态（unsupported → ready/error）自动轮询与状态流转
- **EvoScientist UI 工具** (`evoscientist-ui.js`) — Tab 定义、图标系统、Provider 列表、交互策略配置

### 改进 (Improvements)

- **侧边栏重构** — 从四层升级为五层导航（PRIMARY → OPS → SECONDARY → EVO → SYSTEM），支持 EvoScientist 独立区域
- **主题系统增强** (`theme.js`) — 新增 EvoScientist 专属 CSS 变量（`--evo-accent`、`--evo-bg` 等），数十个新增变量支持深色/浅色模式
- **钳子助手升级** (`assistant.js`) — 新增与 EvoScientist Coordinator 的人格同步能力
- **路由系统扩展** (`router.js`) — 新增 `/evoscientist` 路由，支持 `?tab=` 查询参数切换 Tab
- **帮助 FAB 更新** — 新增 EvoScientist 页面的上下文帮助内容

### 后端 (Backend)

- **Rust EvoScientist 命令** (`evoscientist.rs`) — 状态查询、安装、Bridge 启停、配置读写等 Tauri 命令
- **Python Bridge** (`evoscientist_bridge.py`) — EvoScientist 运行时桥接脚本

### 测试 (Tests)

- 新增 `tests/evoscientist-state.test.js`（状态管理单元测试）
- 新增 `tests/evoscientist-ui.test.js`（UI 工具单元测试）
- 新增 `tests/theme.test.js`（主题系统单元测试）

## [1.0.30] - 2026-03-26

### 新增 (Features)

- **版本特性门控系统** (`openclaw-feature-gates.js`) — 根据检测到的 OpenClaw 版本自动启用/隐藏 UI 功能，支持 `isFeatureAvailable()` 异步检查和版本常量
- **Qwen DashScope 双端点** — 阿里云百炼模型预设改为 choices 模式，支持中国区 (`dashscope.aliyuncs.com`) 和国际区 (`dashscope-intl.aliyuncs.com`) 端点切换，新增 Qwen 2.5 Max 模型
- **Node 版本预检增强** — Rust `check_node` 返回 `meets_minimum` 和 `recommended_upgrade` 字段；setup 页在 Node < 22.14 时显示黄色警告，低于 24 时显示升级建议
- **Container 模式 UI** — 服务管理页新增 Container 模式开关（版本门控 ≥ 3.24），读写 `openclaw.json` 的 `container` 字段，适用于 Docker/K8s 部署
- **Discord 自动讨论串** — 渠道配置中 Discord 新增 `autoThread` toggle（版本门控 ≥ 3.24），启用后每条消息自动创建 Thread，标题由 LLM 生成
- **微信插件升级按钮** — 微信渠道新增「升级插件」操作，复用 install 逻辑重新安装 `@latest` 版本
- **上游追踪文档** (`UPSTREAM.md`) — 记录与 qingchencloud/clawpanel 的分叉差异、同步历史和策略

### 改进 (Improvements)

- **版本策略升级** — 推荐 OpenClaw 版本从 `2026.3.13` 更新至 `2026.3.24`，新增 panels["1.0.30"] 条目
- **版本警告分级** — 版本仅略高于推荐版（≤2 天）时显示温和提示，显著超前时才显示兼容风险警告（about.js + services.js）
- **AI 知识库更新** — 新增 Container 模式、DashScope 国际端点、Discord 自动讨论串、Node 22.14+ 前置条件等文档
- **渠道表单 toggle** — channels.js 表单渲染支持 `type: 'toggle'` 字段类型和 `minVersion` 版本门控

## [1.0.29] - 2026-03-25

### 新增 (Features)

- **SOP 任务规划器** (`sop-engine.js`) — 描述一个大目标，AI 自动拆解为可执行的分步任务；支持依赖管理（DAG 拓扑排序），步骤状态机（pending → ready → running → completed），关联 Deal / 项目池
- **AI 目标拆解** — 调用 `assistant-core.js` 将自然语言目标拆解为结构化步骤，内置关键词匹配降级方案（尽调/评估/投决场景），无需 AI 也能使用
- **执行监督** — 超时告警（基于预估耗时自动检测）、质量门槛（评分 < 阈值时阻止通过）、步骤回退（级联重置下游依赖）、暂停/恢复计划
- **SOP 归纳器** — 从已完成的任务计划中提炼共性步骤模式，支持多模式合并归纳为标准 SOP 模板，可一键应用为新计划
- **流程图可视化** (`sop-flow.js`) — 自绘 SVG 流程图（Kahn 算法分层布局），支持导出 SVG/PNG、复制 Mermaid 语法；步骤状态着色 + 执行中虚线高亮
- **SOP 页三 Tab 布局** — "模板库"（原有）、"任务规划"（新）、"SOP 归纳"（新），统一入口
- **执行报告** — 计划完成后可查看完成率、平均评分、实际耗时 vs 预估耗时、效率指数

### 修复 (Fixes)

- 修复 SOP 页面 tab 切换失效（`.sop-tab` 无 `data-action` 属性导致事件被拦截）
- 修复"应用为新计划"时依赖关系丢失（`depends_on_order` 未还原为步骤 ID）
- 修复同一计划可重复提炼 SOP 模式的问题
- 修复 PNG 导出时 SVG 加载失败无错误提示

### 测试 (Tests)

- 新增 `tests/sop-engine.test.js`（27 个测试用例）：CRUD、依赖解析、步骤生命周期、超时检测、质量门槛、回退、模式提炼与归纳
- 新增 `tests/sop-flow.test.js`（9 个测试用例）：Mermaid 生成、SVG 渲染、图例控制、运行高亮、并行步骤

## [1.0.26] - 2026-03-25

### 改进 (Improvements)

- **仓库治理** — 清理误提交文件（C:/ Windows 路径）、整理 portal 文件至 `src/portal/`、补全 `.gitignore`（二进制文档、IDE 文件、构建产物、敏感文件）

## [1.0.22] - 2026-03-24

### 新增 (Features)

- **Spotlight 聚光灯引导系统** — 新增 `spotlight-guide.js`，用 Canvas 遮罩镂空目标元素，搭配 box-shadow 脉冲呼吸动画，支持多步骤序列、步骤间平滑过渡、气泡箭头自动定位，并通过 `localStorage` 持久化完成状态
- **首次进入欢迎弹窗** — 新增 `welcome-modal.js`，首次启动自动弹出场景选择卡（管理投资项目 / 配置 AI 助手 / 两者），确认后直接启动对应 Spotlight 引导，带 scale+fade 入场动画
- **常驻悬浮帮助按钮（FAB）** — 新增 `help-fab.js`，左下角玻璃质感圆形按钮，点击展开帮助面板；面板包含快速引导入口、当前页面专属提示（按路由动态切换）及键盘快捷键说明，`?` 键全局触发
- **空状态引导卡片** — 新增 `empty-state-guide.js`，通用空状态组件，提供 `emptyStateHTML()` / `renderEmptyState()` 两种 API，内置 agents、models、channels、pool、pipeline、documents 等场景预设，带 fade-up 入场动画
- **操作成功 Toast + 下一步提示** — 新增 `success-toast.js`，操作成功后从顶部滑入通知，包含绿色图标、底部进度条和可点击的"下一步：xxx"跳转链接，4 秒后自动收起

### 改进 (Improvements)

- **投资工作台空状态优化** — 移除旧版四步"开始使用"卡片区，空库时改用新 `renderNewUserBanner` 展示漂亮的空状态引导，提供"初始化投资工作台"和"进入项目池"两个 CTA
- **Agent 页空状态升级** — 无 Agent 时由普通文本提示改为完整空状态卡片，直接提供"聊天新建 Agent"和"高级向导"操作按钮
- **各模块底部引导面板清理** — 移除 pipeline、workflows、automation、companies、deal-detail、invest-docs、sop-invest、pool 等页面底部静态的 `renderInvestNextSteps` 下一步面板，改由常驻帮助 FAB 按需提供引导
- **AI 配置模块底部面板清理** — 移除 models、agents、channels、skills、security、gateway 页面底部静态的 `renderOpenClawNextSteps` 面板，导航引导集中到帮助 FAB
- **三版本教程差异化** — 欢迎弹窗和帮助 FAB 按产品 profile 动态调整：Invest 版显示投资管理/AI助手/两个都要三个场景，SOP 版显示 SOP 流程/AI助手，Knowledge 版显示知识库管理/AI助手
- **帮助 FAB 与钳子助手位置分离** — 帮助 FAB 从右下角移到左下角，避免与 AI 助手 FAB 重叠
- **Logo 统一** — 产品内所有 Logo 统一使用 App 发包图标，保持品牌一致性
- **侧边栏产品名排版优化** — 产品名字号从 21px 缩小到 17px，防止长名称被截断
- **SOP/Knowledge 版署名更新** — 左上角署名从 "Yuntao Sang" 改为 "YnY.中国"
- **全版本官网链接补齐** — SOP 和 Knowledge 版的 companyWebsite 和关于页副标题均补充 www.privix.cn 官网链接
- **关于页精简** — 移除相关项目中的 ClawApp 条目
- **OpenClaw-zh 文案修正** — "我们维护的" 改为 "QingchenCloud 维护的"
- **Knowledge 版知识库系统** — 新增 `/knowledge` 页面（列表/详情/空状态），Rust 后端 10 个 Tauri 命令（`knowledge.rs`），支持创建/管理知识库、粘贴文本、文件管理、一键同步到 Agent workspace USER.md
- **Knowledge 版首页切换** — `local_qa_kb` homeRoute 从 `/assistant` 改为 `/knowledge`，侧边栏新增"知识库"导航项
- **P1: License 服务地址持久化** — 三个 profile 的 `licensePolicy.baseUrl` 写入源码，`fallbackBaseUrl` 指向备用域名 `activation.pathcloud.cn`，Rust 端自动 fallback
- **帮助 FAB 位置再调整** — 从左下角移到右下角 AI FAB 上方（bottom:88px），避免遮挡侧边栏夜间模式按钮
- **SOP 版渲染容错** — `renderDocSopPage` 包裹 try/catch，首次加载报错时显示友好提示而非白屏

## [1.0.21] - 2026-03-23

### 新功能 (Features)

- **消息渠道管理全面重写** — 渠道页重构为注册表驱动架构，统一 QQ 机器人、Telegram、飞书、微信等平台的配置表单；新增渠道诊断修复命令（`diagnose_channel`、`repair_qqbot_channel_setup`）；Agent 绑定与渠道配置拆分为独立面板，支持多账号多 Agent 独立绑定
- **QQ 机器人链路加固** — Rust 后端新增 QQ 插件健康检查（`qqbot_plugin_diagnose`、`qqbot_extension_installed`）、配置迁移（`strip_legacy_qqbot_plugin_config_keys`、`ensure_openclaw_qqbot_plugin`）及配置诊断修复流程，自动清理旧结构键并写入标准 plugin 条目
- **产品 profile 生态对齐** — `product-profile.js` 补充路由可达性判定逻辑；`tauri.conf.json` 与 `product-profile.json` 同步更新标识与能力范围；新增 product profile 回归测试
- **setup 页环境体检强化** — 新增更多依赖项检测条目，并优化安装状态展示与一键修复交互

### 改进 (Improvements)

- **dev-api 脚本覆盖扩充** — `scripts/dev-api.js` 新增 `listAllBindings`、`diagnoseChannel`、`repairQqbotChannelSetup` 等 270+ 行 API 模拟，补齐渠道相关开发调试覆盖
- **聊天调试页增强** — `chat-debug.js` 新增渠道诊断快捷入口，方便在调试视图直接触发渠道状态检测
- **侧边栏与顶部 Header 精简** — 移除低频次级导航入口，减少视觉干扰
- **桌面发包脚本优化** — `release-desktop-all.js` 改为按 profile 重命名并输出安装包，支持三版本同时构建

### 文档 (Docs)

- **新增非投资用户指南** — 补充面向普通用户的管理指南文档（`OpenClaw-管理指南-非投资用户版.md`）
- **许可证部署文档更新** — `docs/license-deploy.md` 补充新部署场景示例
- **CONTRIBUTING / README / 开发日志同步** — 社区协作规范、产品介绍与开发日志同步到当前版本状态

## [1.0.20] - 2026-03-23

### 修复 (Fixes)

- **Agent SOP 预览不再串写到旧 Agent** — `doc_sop` 版的 `/sop` 预览链路新增当前请求校验，并在异步处理时锁住 Agent 切换，修复长耗时生成完成后把旧 Agent 预览结果回填到当前页面、甚至误写入旧 workspace 的风险
- **文档 SOP 首页不再误触投资守卫** — 投资路由判定改为按当前 product profile 生效，`doc_sop` 版继续使用 `/sop` 作为首页时，不会再被投资模块 readiness guard 错误重定向到 `invest-repair`

### 文档与测试 (Docs & Tests)

- **新增 doc_sop 回归测试** — 补上 `doc-sop` 请求守卫与忙碌态测试，并扩展 product profile 测试覆盖 `/sop` 路由在 `doc_sop` 版下不再触发投资守卫
- **README / 开发日志 / 授权文档同步到 1.0.20** — 顶部版本亮点、开发日志和许可证部署示例统一更新，方便桌面发包和回归核对
- **三版本桌面发包规则固化** — 新增 `npm run release:desktop:all` 与 `docs/desktop-release.md`，正式发版默认同时构建 `invest_workbench`、`local_qa_kb`、`doc_sop` 三个 profile，并按 profile 重命名后输出到桌面目录

## [1.0.19] - 2026-03-22

### 新功能 (Features)

- **桌面许可证激活与校验链路上线** — 桌面端新增许可证状态读取、激活、设备重置与本地授权门禁，未授权时会在设置、入口与能力边界上做一致化拦截
- **多产品发行档位支持** — 新增 `invest_workbench`、`doc_sop`、`local_qa_kb` 三套 product profile，可按发行版切换首页、能力范围、品牌信息、许可证策略与 bundle 标识
- **产品门户页与内置教程上线** — 新增独立 `portal` 展示页，集中承载下载入口、截图展示和两条上手教程路径，便于对外演示和分发

### 改进 (Improvements)

- **聊天流式渲染更顺滑** — 流式消息改为增量文本 diff，减少整段重绘带来的抖动；流式阶段补上基础 Markdown 呈现，并优化最终态切换动画和气泡宽度稳定性
- **思考过程展示更清晰** — `<think>` 内容现在会以可折叠思考块展示，未闭合时提供“正在思考…”提示，阅读流式推理过程更自然
- **分页面教程卡片模块化** — 模型、Agent、Gateway、渠道、安全、技能等页面补上上下文教程卡片，减少首次进入时的摸索成本
- **热更新与鉴权检查更稳** — 更新检查、热更新下载与桌面鉴权链路补充更多安全校验，降低错误状态下误提示、误覆盖或鉴权漂移的风险

### 修复 (Fixes)

- **Vite 打包门户页脚本失效** — `portal.js` 改为 `type=\"module\"` 挂载，修复独立门户页在生产构建后脚本不执行的问题
- **助手配置本地存储补齐** — 助手配置与许可证相关状态新增独立存储与测试覆盖，减少 profile 切换或升级后的状态丢失

### 文档与测试 (Docs & Tests)

- **README / 更新日志同步到 1.0.19** — 顶部版本亮点、更新日志与版本号统一更新，方便后续发包与测试对照
- **许可证、助手存储、聊天流式测试补齐** — 新增 license gate、license server utils、assistant storage、chat streaming 等回归测试，降低发版回归风险

## [1.0.17] - 2026-03-20

### 修复 (Fixes)

- **聊天调整不再清空未改字段** — 配置聊天模式现在只合并本轮明确提到的字段；模型返回的空字符串 / 空数组不会再把已有风格、边界或子 Agent 设定悄悄抹掉
- **写入摘要失效保护补齐** — 聊天生成过摘要后，只要继续发新要求、重跑分析，或手动修改创建参数，就会立即使旧摘要失效，避免用户误把过期草案直接写入 workspace
- **模板切换时展示名自动跟随** — 场景模板创建页现在会在“用户尚未手动改名”时自动同步新的模板默认名称，不再出现切了模板却沿用旧标题写入文件的情况

### 文档与测试 (Docs & Tests)

- **聊天配置回归测试补齐** — 扩展 `tests/agent-config.test.js`，覆盖“仅合并变更字段”的提示词约束与空补丁清洗逻辑
- **1.0.17 发版同步** — 同步更新 package / Tauri / Cargo / lockfile 版本、开发日志与更新日志，并重新打包桌面安装产物

## [1.0.16] - 2026-03-20

### 改进 (Improvements)

- **AI 新建 Agent 改为独立三步流** — `AI 新建 Agent` 现在直接进入“创建信息 → 问答 → 预览”，不再先读取空 workspace，也不会和“配置现有 Agent”的分析链路混用
- **文字 prompt 起草首版设定** — 新建页新增自然语言 prompt 输入框，可先让钳子助手预填 Agent ID、展示名、场景、职责与风格，再由用户继续校对和生成预览
- **工作区默认自动新建** — 新建模式主流程改为默认创建 `~/.openclaw/agents/<id>/workspace`，只在高级项中保留自定义路径，减少空工作区和路径输入带来的误操作
- **预览阶段支持显式失败态与重试** — 生成预览会先进入预览步骤，再分别展示“生成设定草案 / 计算差异预览”进度；失败时停留在当前步骤显示错误并可直接重试

### 修复 (Fixes)

- **新建模式误读空目标 workspace** — create 模式现在只在需要时读取父 Agent 参考文档，不再把待创建 Agent 的空工作区当成分析输入
- **结构化模型超时过短导致预览回退** — 向导侧结构化 AI 调用现在支持按场景单独配置超时，预览生成使用更长超时，减少大模型慢响应时的误判失败
- **Web / Tauri 预览行为漂移** — `preview_agent_workspace_generation` 在 dev-api 与 Tauri 命令层同步支持 `readTargetSources` / `readParentSources`，两端行为重新对齐
- **参考父 Agent 被误当成写入目标** — create 模式下选择父 Agent 现在严格只作为参考文档来源；即使同时创建子 Agent，也不会再把 `parentUpdates.AGENTS.md` 错写进现有父 Agent 的 workspace
- **起草按钮首屏不可点** — 新建页文字 prompt 输入后会立即启用 `AI 帮我起草`，不再需要依赖其他字段触发重渲染
- **模型幻觉父 Agent 导致预览失败** — AI 起草返回的 `parentAgentId` 现在只有命中已配置 Agent 时才会保留，未知 ID 会被自动丢弃，避免后续预览时报 “Agent 不存在”
- **最后一步卡在“正在计算差异”** — 最终 preview 现在只请求 diff 摘要，不再把 source 文档和完整 `currentFiles/generatedFiles` 通过 Tauri IPC 回传，避免大 payload 把 release 包里的预览步骤拖成假死

### 文档与测试 (Docs & Tests)

- **Agent 向导与 provider 测试补齐** — 新增 create 三步流、prompt 预填合并、自动工作区路径和结构化调用超时的测试覆盖
- **1.0.16 发版同步** — 同步更新 package / Tauri / Cargo / lockfile 版本、README、开发日志、产品介绍与许可证说明

## [1.0.15] - 2026-03-19

### 改进 (Improvements)

- **AI Agent 向导入口模式锁定** — `AI 新建 Agent` 与 `AI 配置` 入口现在会锁定各自合法模式，避免从“新建”入口切到无目标的 `configure` 状态后继续分析或生成预览
- **创建问卷改为分层结构** — 新建模式问卷重构为“核心设定 + 高级设定 + 条件化子 Agent 区块”，默认先展示关键问题，高级项折叠收起，只有明确选择“需要一个专职子 Agent”时才展开完整子 Agent 配置
- **Agent 类型语义拆分** — 创建主 Agent 的类型字段从复用的 `subAgentType` 拆成独立 `agentType`，旧偏好会自动迁移，避免主 Agent / 子 Agent 类型混淆和重复问题
- **问答界面升级为卡片式** — 问答步骤新增场景 / 职责 / 风格 / 子 Agent 状态摘要条，单选题改为卡片式选择，多选高级项改为紧凑标签卡，整体层级更清晰

### 修复 (Fixes)

- **无目标 configure 空状态报错** — 当配置模式缺少目标 Agent 时，现在会直接显示明确提示并拦截分析/生成，不再走到无效状态后抛错
- **可扩展子 Agent 误展开** — 选择“可能需要，先生成可扩展规则”时不再强制要求填写完整子 Agent 信息，减少不必要的问卷膨胀

### 文档与测试 (Docs & Tests)

- **AI 向导回归测试补齐** — 新增创建模式问卷结构、旧偏好迁移、入口模式锁定和“可扩展规则不强制展开子 Agent”的测试
- **1.0.15 文档同步** — README、开发日志与更新日志统一同步到当前 Agent 向导行为
## [1.0.14] - 2026-03-19

### 修复 (Fixes)

- **桌面端 `invest_cli` 正式接通** — Tauri 运行时补齐 `invest_cli` 命令桥接与注册，投资工作台、本地 Copilot 兜底链路和投资助手预设在桌面端不再因 `command not found` 直接失效
- **本地投资助手并发中止竞态** — `invest-copilot` 的本地 fallback 现在按请求实例持有 `AbortController`，旧请求结束时不再误清掉新请求的 controller，连续发送时取消行为恢复正确
- **助手页遗留附件误发** — 离开 `/assistant` 页面时会清空待发送图片，避免隐藏在内存里的旧附件被下一条纯文本消息带出去
- **Responses-only 模型兼容补齐** — `assistant-core` 在 `/chat/completions` 返回 `legacy protocol` / `/v1/responses` 提示时会自动切到 Responses API，并继续跑工具调用循环

### 文档与测试 (Docs & Tests)

- **Responses fallback 回归测试** — 新增 `assistant-core` 测试，覆盖“Chat Completions 失败后自动切到 Responses，并继续 function/tool loop”的场景
- **1.0.14 发版同步** — 同步更新 package / Tauri / Cargo / lockfile 版本、开发日志与产品介绍，保证仓库记录和桌面发行包一致

## [1.0.13] - 2026-03-19

### 新功能 (Features)

- **钳子助手后台运行** — 助手会话现已升级为持久 runtime，离开 `/assistant` 页面后任务仍可继续执行，返回页面时会恢复消息、状态与流式结果
- **投研通用 JSON CLI** — 新增 `invest:cli`，统一提供 `query`、`mutate`、`preview_import_excel`、`apply_plan`、`refresh_suggestions`、`stats` 等结构化命令，供 UI、钳子助手和本地兜底链路共用
- **投资助手本地兜底模式** — 投资工作台右上角 Copilot 新增“Gateway 优先，本地钳子助手兜底”双链路；网关不可用时会自动切到受控的本地 AI + `invest_cli`

### 修复 (Fixes)

- **投资助手卡死在连接 Gateway** — `invest-copilot` 挂载时会立即读取当前连接状态，不再因为错过 ready 事件而长期停留在“正在连接 Gateway...”
- **Gateway token 归一化** — Copilot 连接链路统一规范化 token 值，避免把对象态 SecretRef 直接传入 WebSocket 鉴权导致连接失败
- **项目池导入逻辑重复分叉** — Excel 解析与阶段/表头兼容逻辑改为共享实现，减少 UI 导入和 AI 批量录入之间的行为漂移

### 改进 (Improvements)

- **钳子助手核心可复用** — 助手模型配置、提示词预设、tool loop 和 runtime 从页面层拆出，便于投资助手直接复用同一套本地 AI 核心
- **本地投资库存储工具边界收敛** — 本地模式下新增受限版 `invest_cli`，支持查询、计划写入、执行 plan、刷新建议和统计，同时继续限制高风险自由工具
- **状态反馈更明确** — 投资 Copilot 现统一输出 `gateway-ready`、`gateway-reconnecting`、`assistant-local`、`error` 四种可见状态，便于区分主链路和兜底链路

### 文档与测试 (Docs & Tests)

- **后台 runtime 与导入解析测试补齐** — 新增 `assistant-runtime`、`invest-import` 测试，并扩展本地投资库测试覆盖 `invest_cli` 的 plan/apply 流程
- **1.0.13 发版同步** — 同步更新 package / Tauri / Cargo / lockfile 版本、开发日志与产品介绍，保证仓库记录和桌面发行包一致

## [1.0.12] - 2026-03-18

### 修复 (Fixes)

- **SOP 备份恢复篡改执行轨迹** — 恢复投资快照中的 SOP 执行记录时，不再自动补齐默认输出、完成时间和四个占位步骤，避免 `pending` / `running` / `failed` 记录被误恢复成“已完成”，也避免自定义步骤时间线被污染或重复
- **项目池隐藏模块入口绕回企业库** — 当用户在投资工作台里隐藏企业库但保留联系人时，项目池顶部引导卡现在会改为跳转联系人页，不再从辅助入口重新暴露已隐藏模块
- **SOP 显式状态创建一致性** — SQLite 与本地投资库两套创建实现都改为尊重显式传入的 `output_status` / `completed_at` / `output_content`，只有默认“手动执行完成”场景才会自动生成执行摘要和步骤

### 文档与测试 (Docs & Tests)

- **SOP 恢复回归测试补齐** — 新增备份恢复测试，覆盖“保留原始状态、不自动注入占位步骤”的场景
- **双存储实现一致性测试** — 本地投资库和 SQLite handler 都新增测试，确保显式非完成态 SOP 不会再自动写入完成时间和默认步骤
- **1.0.12 发版同步** — 同步更新 package / Tauri / Cargo 版本与开发日志，保证仓库记录和桌面发行包一致

## [1.0.11] - 2026-03-18

### 新功能 (Features)

- **AI Agent 配置向导** — Agent 管理页新增 `AI 新建 Agent` 与 `AI 配置` 入口，可读取 workspace 核心文件、生成问答式设定草案、预览差异后再统一写入目标 Agent / 子 Agent
- **Agent 调试预设** — 内置 AI 助手新增“调试现有 Agent”技能卡，可选择目标 Agent，自动带入 workspace、配置目录与 `models.json` 路径，优先进入只分析不修改的排障流程

### 修复 (Fixes)

- **新建 Agent 预览链路回归** — 修复 AI 向导在“创建新 Agent / 创建新子 Agent”时误把待创建对象当成现有 Agent 查 workspace，导致预览阶段直接失败的问题
- **Agent 设定写入边界** — 预览与写入逻辑现在只允许输出 `IDENTITY.md`、`SOUL.md`、`AGENTS.md`、`TOOLS.md`，避免模型返回异常文件名时越界读写
- **子 Agent 默认同 ID 覆盖主 Agent** — create 模式不再把子 Agent 默认预填成主 Agent 的 ID / 名称 / 模型，并在生成前显式拦截主子 Agent ID 冲突
- **聊天流式与历史渲染** — 聊天页重构消息视图层，统一历史 / 流式 / final 渲染与分组逻辑，补上 assistant 流式结束、重复消息去重、富文本与纯文本模式切换的稳定性
- **Markdown 链接与属性转义** — Markdown 渲染新增属性级转义与更安全的链接处理，减少代码块语言、图片 alt、链接 URL 等位置的注入风险

### 改进 (Improvements)

- **Agent 列表信息更完整** — Rust 命令层和 dev-api 现在都会返回更完整的 Agent `workspace` / `identity` / `model` 信息，便于管理页、助手页和记忆页共用
- **聊天 UI 质感升级** — 聊天气泡、消息分组、媒体网格、meta 信息与 hover 细节重新整理，移动端和桌面端的阅读节奏更统一

### 文档与测试 (Docs & Tests)

- **Agent 向导回归测试补齐** — 新增针对 create-mode 预览 target、子 Agent createSpec 路径和模型质量提示的测试
- **聊天与 Markdown 测试补齐** — 新增消息视图与 Markdown 相关测试，覆盖分组、去重、纯文本流式和安全转义
- **1.0.11 发版同步** — 同步更新 package / Tauri / Cargo / lockfile 版本与开发日志，保证仓库记录和桌面发行包一致

## [1.0.10] - 2026-03-18

### 新功能 (Features)

- **Moonshot / Kimi onboarding 风格预设** — 模型配置页新增 `Kimi API key (.ai)`、`Kimi API key (.cn)`、`Kimi Code API key (subscription)` 三种接入方式，对齐 OpenClaw onboarding，默认只需填写 API Key

### 改进 (Improvements)

- **钳子助手模型配置预填升级** — 内置 AI 助手现已复用同一套 Moonshot / Kimi 共享预设，自动预填 `baseUrl`、`apiType` 与默认模型，仍保留手动改 API 地址和模型的自由度
- **Kimi Code 兼容补齐** — 助手侧补上 `kimi-coding` 所需的 Anthropic 兼容请求头和默认端点，避免“配置看似完成但连通性测试失败”的割裂体验
- **模型 provider 合并逻辑增强** — 已存在 `moonshot` / `kimi-coding` provider 时，新增入口会改为合并更新配置并补默认模型，不再重复创建 provider 或写出重复模型

### 文档与测试 (Docs & Tests)

- **共享预设回归测试** — 新增针对 Moonshot `.ai` / `.cn` 与 Kimi Code `k2p5` 默认值的自动化测试，并覆盖“补默认模型但不改当前主模型”的合并逻辑
- **1.0.10 发版同步** — 同步更新开发日志与版本号，保证代码、桌面端配置和发版记录一致

## [1.0.9] - 2026-03-17

### 新功能 (Features)

- **本地投资库应急模式** — 当桌面端运行时未接入 `invest_*` 原生命令时，投资模块现在可以在前端强制创建一个可持久化的本地投资库，继续完成企业、联系人、项目池、Deal、文档、审批、SOP、评分和自动化等核心操作

### 修复 (Fixes)

- **空机用户无法真正建库** — 投资模块修复向导新增“强制创建本地库 / 新建并导入示例数据”，不再把空机用户永久卡在“运行时未接入投资模块”提示页
- **投资页兜底路径误导** — 企业库、项目池、Deal 管道等页面在 `unsupported_runtime` 场景下改为引导进入修复向导创建本地库，而不是只让用户检查版本信息
- **导航页无效缩放滑块** — 移除侧边栏底部无实际收益的缩放滑块和相关事件绑定，减少无效控件干扰

### 改进 (Improvements)

- **本地投资库回归测试补齐** — 新增针对本地投资库 CRUD、项目池转 Deal 和 readiness 状态判断的自动化测试，降低后续 fallback 模式回归风险

## [1.0.8] - 2026-03-17

### 修复 (Fixes)

- **投资模块误报“需升级稳定版”** — 当桌面端运行时未接入投资命令时，不再把问题误导成“OpenClaw 版本过低”；修复向导、初始化兜底与侧边栏状态统一改为提示“检查面板运行时 / 前端版本是否一致”
- **低延时模式只能开不能关** — 实时聊天页的低延时按钮补齐关闭路径，支持在当前会话里显式发送 `/fast off` 并正确回滚本地状态
- **sub-agent 回复历史不渲染** — 聊天历史兼容层补上对嵌套 `message` 包装的解析，并保留 `toolResult` 可见内容，委派执行后的结果不再被前端直接吞掉

### 改进 (Improvements)

- **聊天兼容回归测试补齐** — 新增针对历史消息包装格式的自动化测试，降低后续聊天事件兼容层回归风险
- **1.0.8 发版同步** — 同步更新前端、Tauri 与 Cargo 版本号，保证桌面端发包版本和代码库记录一致

## [1.0.6] - 2026-03-17

### 新功能 (Features)

- **投资模块统一初始化入口** — 投资工作台、项目池、Deal 管道、企业库、联系人、审批流在空态或关键失败态下统一提供「初始化投资工作台」入口，可导入轻量演示数据并自动打开教程

### 修复 (Fixes)

- **实时聊天不渲染消息流** — 聊天页增强对 Gateway `chat` 事件的兼容解析，支持累积型 delta、增量型 delta、仅 final 返回以及纯媒体消息，桌面版和 Web 版共用同一套修复逻辑
- **图标生成入口失效** — `icon:regen` 不再指向缺失的 `docs/logo.png`，改为使用新的正式图标源文件

### 改进 (Improvements)

- **投资工作台初始化文案统一** — 原有“导入演示数据”等入口统一收敛为“初始化投资工作台”，减少首次使用时的理解成本
- **1.0.6 图标更新** — 桌面端打包图标与前端页签图标同步切换为新资源，降低品牌资源不一致的问题

## [1.0.5] - 2026-03-17

### 新功能 (Features)

- **投资流程教程升级** — 投资工作台导览从轻量导航卡升级为任务式教程，每一步明确“做什么、在哪做、点哪里、做完算什么”，帮助新用户 10 分钟内跑通从线索到审批的完整链路
- **OpenClaw 养虾教程** — 新增独立的 Agent 养成路径，引导用户依次完成环境体检、模型配置、Agent 创建、Skills 检查与实时聊天验证，把 OpenClaw 从“已安装”推进到“第一只 Agent 可用”

### 改进 (Improvements)

- **投资页引导文案统一** — 首页、空状态和“下一步建议”的教程入口统一改成更强任务导向的表述，减少“知道有这个按钮，但不知道点完该做什么”的落差
- **Setup 页下一步建议重构** — 环境检测全部通过后，不再只停留在“进入面板”，而是继续给出 Agent 养成路径和关键快捷入口
- **聊天 / 助手分工更清晰** — 实时聊天与 Privix 内置 AI 助手的顶部提示同步强化，分别强调“验证 OpenClaw Agent 是否真能工作”和“使用内置 AI 做投研/排障/灵魂导入”的定位
- **用户手册新增重点章节** — 手册生成脚本补入“10 分钟跑通投资工作台”和“OpenClaw 养虾：第一只 Agent 养成”两段重点内容，保证产品内引导和书面说明一致

## [1.0.4] - 2026-03-16

### 新功能 (Features)

- **投资工作台 v1 预览版** — 打通项目池、项目管道、企业库、联系人、文档与 Deal 详情之间的上下文联动跳转，页面切换时可保留 `company_id`、`deal_id`、`pool_item_id` 等关键参数
- **投资 Copilot 审核流** — 新增右侧抽屉式投研 Copilot，可在对话中生成结构化 proposal，并以 review 卡片确认 `create_deal`、`update_deal_stage`、`update_pool_item`、`link_document` 等操作
- **投资数据预览与补数脚本** — 新增 `scripts/seed-invest-preview.js` 与项目池联系人回填脚本，方便本地快速构建可演示的投资数据库

### 改进 (Improvements)

- **前端动效与微交互升级** — 页面切换、卡片 hover、按钮 active、Modal 进出场、Toast 提示、看板卡片进场、侧边栏激活指示器全面升级，整体操作反馈更顺滑
- **数据概览数字动画** — 投资仪表盘统计卡片改为从 0 递增到目标值，强化关键指标的可读性和展示感
- **项目池视图切换体验** — 看板 / 表格 / 漏斗三种视图切换新增淡入淡出过渡，并补充更细腻的拖拽反馈
- **交互一致性增强** — 自动化、SOP、自定义删除/转 Deal 等危险操作统一切换为产品内确认弹窗，不再混用浏览器原生 `confirm()`

### 修复 (Fixes)

- **前端交互回归加固** — 修复动效升级后拖拽态残留、视图切换清理不完整、侧边栏指示器不同步等问题，降低页面切换和拖拽场景中的异常状态
- **看板拖拽稳定性** — 项目池与项目管道在 `dragend` / `drop` 失败分支下会主动清理高亮和拖拽状态，避免卡片卡在“正在拖动”样式
- **Modal 关闭时序** — 弹窗确认、取消、遮罩点击与 `Esc` 关闭现在统一走带动画的关闭流程，减少嵌套弹窗和快速操作时的时序问题

## [0.8.6] - 2026-03-13

### 修复 (Fixes)

- **切换汉化版 SSH 认证失败** — npm install 子进程现通过 `GIT_CONFIG_COUNT` 环境变量强制注入 HTTPS insteadOf 规则，确保即使全局 git config 未生效（Windows PATH 问题等），SSH→HTTPS 替换也能在 npm 子进程中工作
- **#58 定时任务触发错误** — 修复 `fetchJobs` 中 `id: j.name || j.id` 导致自定义名称的任务无法触发（感谢 @axdlee）
- **#63 systemd 部署找不到 OpenClaw** — 文档改用 `$(which node)` 动态路径 + `Environment=PATH` 确保 systemd 服务能找到 Node.js 和 OpenClaw CLI
- **#64 Skills 页面 JSON 解析错误** — `openclaw skills list --json` 输出混入 Node.js 警告时不再报错，新增 `extract_json` 提取有效 JSON 对象
- **CI rustfmt/clippy 跨平台警告** — 修复 `unused_imports`（BufRead/BufReader 移入 cfg block）、`needless_return`×3、`and_then→map`

### 改进 (Improvements)

- **错误诊断更精准** — SSH 错误诊断改用更严格的匹配（`permission denied`、`publickey`、`host key verification`），不再被 npm verbose 日志中的 `git@` 字样误触发
- **README 文档增强** — 新增「快速上手」4 步指南、Web 版部署指南（含 Nginx 配置示例）、消息渠道配置指南、FAQ 扩充 6 个常见问题

## [0.8.5] - 2026-03-13

### 修复 (Fixes)

- **Web 模式渠道配对报错** — 补全 `pairing_list_channel` / `pairing_approve_channel` 后端 handler，飞书/钉钉配对审批不再报"未实现的命令"
- **Web 模式插件状态报错** — 补全 `get_channel_plugin_status` / `install_channel_plugin` handler，QQ 机器人等插件保存不再 404
- **Web 模式初始设置缺失** — 补全 `check_git` / `auto_install_git` / `configure_git_https` / `guardian_status` / `invalidate_path_cache` handler，Web 部署全流程可用

### 改进 (Improvements)

- **Web 模式 handler 100% 覆盖** — dev-api.js 现已覆盖 tauri-api.js 中所有命令，Web 部署不再出现"未实现的命令"错误

## [0.8.4] - 2026-03-13

### 改进 (Improvements)

- **移除龙虾军团入口** — 精简产品功能，移除 Docker 集群管理页面及相关军事化主题 UI，聚焦"简单好用"的核心体验
- **前端瘦身** — 删除 3 个专用模块（docker.js / docker-tasking.js / pixel-roles.js），pages.css 减少约 700 行，tauri-api.js 清理 30 个未使用 API 方法

## [0.8.3] - 2026-03-12

### 修复 (Fixes)

- **默认安装改为原版** — 版本选择器默认选中「原版」（official），原版排在汉化版前面
- **CI Clippy 兼容** — Linux root 检测从 `unsafe libc::geteuid()` 改为 `std::env::var("USER")`，移除 libc 依赖

## [0.8.2] - 2026-03-12

### 修复 (Fixes)

- **接口地址不再强制拼接 /v1** — 火山引擎（/v3）等第三方 API 不再被错误追加 /v1，仅 Ollama（端口 11434）自动补全
- **OpenClaw 升级 SSH 失败** — 增加 `git://` 和 `git+ssh://` 协议重定向到 HTTPS，`--unset-all` + `--add` 确保 4 条规则全部生效
- **飞书插件安装失败** — 新增内置插件检测（`is_plugin_builtin`），已内置时自动跳过 npm install
- **飞书保存 ReferenceError** — 修复 `overlay is not defined`（应为 `modal`），修复表单收集不支持 `<select>` 字段
- **飞书插件版本持久化** — 切换官方/内置插件后重新打开弹窗不再丢失选择，自动检测已安装的插件版本
- **龙虾军团 Docker 检测报错** — 修复桌面版 Tauri 模式下返回 HTML 导致 JSON 解析失败，新增「需要 Web 部署模式」专属指引
- **聊天重复消息** — 新增 runId 去重机制，防止 Gateway 多次触发同一消息产生重复气泡
- **定时任务 RPC 参数** — `cron.remove` / `cron.run` / `cron.update` 参数从 `name` 修正为 `id`
- **消息渠道操作响应慢** — `save` / `toggle` / `remove` 的 Gateway 重载改为后台异步执行，API 立即返回
- **消息渠道 toggle 不刷新** — 扩展缓存失效范围至 `read_openclaw_config` + `read_platform_config`
- **Linux 非 root 用户 sudo** — `npm_command()` 自动检测 `euid != 0` 并加 `sudo`
- **Control UI 远程访问** — 动态使用浏览器域名/IP 替代硬编码 `127.0.0.1`，自动附带 Gateway auth token
- **npm 镜像源降级重试** — 淘宝源安装失败时自动切换到官方源重试
- **QQ 插件 native binding** — 检测到 OpenClaw CLI 原生依赖缺失时给出友好提示和修复命令
- **错误诊断增强** — exit 128 区分 SSH/Git 未安装；新增 native binding 检测

### 新功能 (Features)

- **关于页面公司信息** — 新增「关于我们」板块：远桥资产
- **模型预设共享模块** — 提取 `src/lib/model-presets.js`，消除 models.js 和 assistant.js 重复维护
- **飞书双插件支持** — 内置插件（聊天入口）或飞书官方插件（操作文档/日历/任务）可选
- **钳子助手快捷选择** — 设置弹窗新增 OpenAI / DeepSeek / Ollama 等服务商一键填充按钮

### 改进 (Improvements)

- **官网下载链接动态化** — 从 `latest.json` 自动获取最新版本号，走 `claw.qt.cool/proxy/dl/` 国内代理
- **Linux 部署文档完善** — 升级指南增加 Gitee 镜像、sudo 权限说明、淘宝源降级说明
- **linux-deploy.sh** — Gitee clone fallback + sudo npm + 淘宝源 registry + 官方源降级

## [0.8.0] - 2026-03-12

### 新功能 (Features)

- **Ollama 本地模型兼容** — 自动规范化 Ollama baseUrl（追加 `/v1`），打开模型配置页时自动修复存量配置，解决 HTTP 404 问题
- **Git 自动检测与安装** — 初始化引导新增 Git 检测步骤，支持一键安装（Windows winget / macOS xcode-select / Linux apt/yum/dnf/pacman），安装失败提供分平台手动安装指引
- **Git SSH→HTTPS 自动配置** — 检测到 Git 已安装后自动配置 HTTPS 替代 SSH（3 条 insteadOf 规则），彻底解决国内用户 SSH 不通导致依赖安装失败的问题
- **Gitee 国内镜像** — 部署脚本、项目链接、贡献页面全面接入 Gitee 镜像（gitee.com/QtCodeCreators/clawpanel），国内用户无需翻墙
- **实时聊天会话重命名** — 双击会话名称可内联编辑，本地缓存不影响 Gateway 数据，顶部标题同步更新
- **刷新模型按钮** — 聊天页面模型选择器旁新增刷新按钮，手动刷新模型列表
- **本地图片渲染** — AI 发送的本地文件路径图片（如截图）在 Tauri 环境下通过 asset protocol 正确加载

### 修复 (Fixes)

- **环境检测实时生效** — 保存自定义 Node.js 路径后无需重启应用，PATH 缓存从 OnceLock 改为 RwLock 支持运行时刷新
- **Windows 自定义路径优先级** — 修复用户指定的 Node.js 路径被系统 PATH 覆盖的问题（自定义路径现在排最前）
- **模型加载超时兜底** — 读取模型配置增加 8 秒超时，不再无限停在"加载模型中..."
- **版本更新检测降级** — GitHub API 失败时自动降级到 Gitee API，检测失败显示"前往官网下载"按钮
- **重置会话确认框** — 点击重置按钮弹出确认对话框，防止误操作清空聊天记录

### 改进 (Improvements)

- **卡片式会话列表** — 会话列表从简单文本改为卡片式布局，显示 Agent 标签、消息数量、相对时间（如"3 分钟前"）
- **当前会话高亮** — 活跃会话改为 accent 色边框 + 加粗文字，辨识度大幅提升
- **聊天顶部栏防溢出** — 长标题自动截断显示省略号，操作区不被挤压
- **术语统一** — "智能体" 统一为 "Agent"（聊天/Agent 管理页面）
- **侧边栏重命名** — "AI 助手" 改为 "钳子助手"
- **baseUrl 自动规范化** — 保存模型配置时自动清理尾部端点路径、追加 /v1，兼容用户粘贴完整 URL
- **官网下载引导** — 版本更新提示统一引导到 claw.qt.cool 官网
- **消息渠道 Agent 绑定** — 每个消息渠道配置弹窗新增 Agent 绑定选择器，通过 openclaw.json `bindings` 配置路由消息到指定 Agent
- **仪表盘概览重设计** — 从双列列表改为 3×2 卡片网格，含主模型/MCP/备份/Agent/配置，点击可跳转对应页面
- **仪表盘 Control UI 卡片** — 新增 OpenClaw 原生面板入口，点击在浏览器中打开 Gateway Web 界面
- **推荐弹窗优化** — 每天最多弹一次，不在聊天/助手页面弹出，弹窗加宽至 500px，4 个社群二维码 Grid 均匀排列
- **Gateway 横幅美化** — 渐变背景色 + 精简文案 + 启动失败显示错误详情和排查入口
- **公益站模型动态获取** — 移除硬编码模型 ID，始终从 API 实时拉取最新模型列表
- **定时任务 cron.jobs 自动修复** — 打开定时任务页面时自动检测并清除无效的 cron.jobs 配置字段

## [0.7.4] - 2026-03-11

### 新功能 (Features)

- **飞书/Lark 消息渠道** — 新增飞书企业消息集成，支持 App ID/Secret 配置、WebSocket 连接、凭证在线校验，附官方教程链接
- **openclaw.json 配置编辑器** — 服务管理页面新增配置文件直编功能，实时 JSON 语法校验，保存前自动备份，支持保存并重启 Gateway
- **定时任务页面** — 注册到侧边栏和路由，通过 Gateway WebSocket RPC 直接管理 cron 任务（创建/编辑/删除/启停/手动触发）
- **Docker 安装引导** — Docker 未连接时按操作系统（Windows/macOS/Linux）显示对应安装步骤和下载链接

### 修复 (Fixes)

- **#35 模型列表拉取崩溃** — 修复 Web 模式下 `_normalizeBaseUrl` 因 `this` 为 undefined 导致的 `Cannot read properties of undefined` 错误
- **消息渠道 Web 模式后端缺失** — 补全 `dev-api.js` 中全部消息渠道 API（list/read/save/remove/toggle/verify），修复 Web/Docker 模式下消息渠道页面 404
- **消息渠道弹窗溢出** — 接入步骤改为可折叠 `<details>`，modal 内容区域支持滚动
- **定时任务侧边栏图标缺失** — 补充 clock SVG 到侧边栏图标映射

### 改进 (Improvements)

- **定时任务按钮交互** — toggle/delete 按钮添加 loading 状态反馈
- **记忆模块切换动画** — Agent 切换和分类切换时显示骨架屏加载动画

## [0.7.3] - 2026-03-10

### 修复 (Fixes)

- **#32 Cookie 解析崩溃** — 修复 Authelia 等反代注入的非法 percent-encoding cookie 导致服务崩溃
- **#31 Gateway 重启丢失 CORS 配置** — `allowedOrigins` 改为合并模式，不再覆盖用户已有配置
- **#25 Windows 终端窗口闪烁** — 补全 Skills 安装/搜索、进程列表、端口检测的 `CREATE_NO_WINDOW` 标志
- **#33 模型测试误报失败** — 非认证 HTTP 错误（400/422）不再误报为失败，兼容阿里 Coding Plan 等提供商
- **#29 反代 WebSocket 协议不适配** — 自动检测 HTTPS 环境使用 `wss://`，龙虾军团面板链接协议自适应
- **#23 实时聊天会话列表自动收起** — 切换会话后侧边栏保持展开，提升多会话切换效率

### 改进 (Improvements)

- **模型测试响应格式兼容** — 新增 DashScope `output.text` 格式支持，reasoning 模型兼容增强

## [0.7.2] - 2026-03-10

### 新功能 (Features)

- **消息渠道管理** — 新增独立「消息渠道」页面，支持在面板内集中管理外部消息接入
- **内置 QQ 机器人接入** — 支持直接配置 QQ 机器人，并内置 QQBot 社区插件安装流程
- **Telegram / Discord 渠道配置** — 支持凭证填写、在线校验、保存后自动重载 Gateway 生效

### 改进 (Improvements)

- **版本号同步到 0.7.2** — 官网下载区、桌面端版本信息和构建配置统一升级到 0.7.2
- **渠道体验优化** — 本轮对外聚焦消息渠道能力，突出内置 QQ 机器人与统一接入体验

## [0.7.0] - 2026-03-08

### 新功能 (Features)

- **OpenClaw 版本管理** — 支持安装/升级/降级/切换版本，汉化版与原版自由选择，版本号从 npm registry 实时拉取
- **版本选择器弹窗** — 可视化选择目标版本，自动判断操作类型（安装/升级/降级/切换/重新安装）
- **Headless Web 服务器** — 新增 `npm run serve` 独立 Node.js 静态服务器，替代 `npx vite`，用于 Linux 无桌面部署
- **扩展工具管理** — Skills 页面全新设计，支持浏览、安装、卸载 MCP 工具
- **前端热更新基础设施** — Release 自动构建 web 包，支持 OTA 检查与回退

### 改进 (Improvements)

- **macOS Gatekeeper 提示优化** — 官网 + README 强调「先拖入应用程序」，新增 `~/Downloads` 路径备选命令
- **部署文档统一** — `linux-deploy.sh/md`、`docker-deploy.md`、`README.md` 全部改为 `npm run serve`
- **弹窗标题动态化** — 安装/升级/降级/卸载操作各自显示准确标题，关闭弹窗后自动刷新页面
- **跨平台兼容** — `serve.js` 路径分隔符使用 `path.sep`，确保 Windows/Linux/macOS 通用
- **AI 助手危险工具确认** — 执行系统命令等高风险操作前弹出二次确认

## [0.6.0] - 2026-03-07

### 新功能 (Features)

- **公益 AI 接口计划** — 内置免费 AI 接口（gpt.qt.cool），GPT-5 全系列模型一键接入，Token 费用由项目组承担
- **Agent 灵魂借尸还魂** — AI 助手可从 OpenClaw Agent 加载完整灵魂（SOUL / IDENTITY / USER / AGENTS / TOOLS），继承人格与记忆
- **知识库注入** — 自定义 Markdown 知识注入 AI 助手，对话时自动激活
- **AI 工具权限管控** — 工具调用权限三档可调（完整 / 受限 / 禁用），危险操作二次确认
- **全局 AI 浮动按钮** — 任意页面错误自动捕获，一键跳转 AI 助手分析诊断
- **一键部署脚本** — `deploy.sh` 支持 curl/wget 双模式，适配 Docker / WSL / Linux 环境

### 改进 (Improvements)

- **安装失败诊断增强** — Rust 后端收集 stderr 最后 15 行，JS 端延迟 150ms 确保完整日志捕获；新增 ENOENT(-4058)、权限、网络等详细诊断
- **UI 图标统一** — 全面替换 emoji 为 SVG 图标组件（assistant / chat-debug / about / services 等页面）
- **模型配置增强** — 公益接口 Banner + 一键添加全部模型，批量连通性测试
- **官网全面改版** — Hero 换为 AI 助手、Showcase 8 行 + Gallery 6 格重新编排、全部文案重写、新增活动板块和抖音社群
- **开发模式增强** — dev-api.js Mock API 大幅扩展，支持 AI 助手全流程调试

## [0.5.6] - 2026-03-06

### 安全修复 (Security)

- **dev-api.js 命令注入漏洞** — `search_log` 的 `query` 参数直接拼入 `grep` shell 命令，可注入任意系统命令。改为纯 JS 字符串匹配实现
- **dev-api.js 路径遍历漏洞** — `read_memory_file` / `write_memory_file` / `delete_memory_file` 未校验路径，可通过 `../` 读写任意文件。新增 `isUnsafePath()` 检查（与 Rust 端 `memory.rs` 对齐）
- **Gateway allowedOrigins 过于宽松** — `patch_gateway_origins()` 设置 `["*"]` 允许任何网页连接本地 Gateway WebSocket。收紧为仅允许 Tauri origin + `localhost:1420`

### 改进 (Improvements)

- **AI 助手审计日志** — `assistant_exec` / `assistant_read_file` / `assistant_write_file` 新增操作审计日志，记录到 `~/.openclaw/logs/assistant-audit.log`
- **connect frame 版本号** — `device.rs` 中 `userAgent` 和 `client.version` 从硬编码 `1.0.0` 改为编译时读取 `Cargo.toml` 版本
- **enhanced_path() 性能优化** — 使用 `OnceLock` 缓存结果，避免每次调用都扫描文件系统

## [0.5.5] - 2026-03-06

### 修复 (Bug Fixes)

- **Linux Gateway 服务管理不可用 (#7, #10)** — 新增 `linuxCheckGateway()`（ss → lsof → /proc/net/tcp 三级 fallback）、`linuxStartGateway()`（detached 子进程）、`linuxStopGateway()`（SIGTERM），所有 handler 分支加入 Linux 支持；修复 `reload_gateway` / `restart_gateway` 错误执行 `systemctl restart clawpanel`（重启面板而非 Gateway）的问题
- **systemd 环境下 OpenClaw CLI 检测失败 (#8)** — 新增 `findOpenclawBin()` 路径扫描，覆盖 nvm / volta / nodenv / fnm / `/usr/local/lib/nodejs` 等所有常见路径，替代仅依赖 `which` 的方式
- **非 root 用户无法部署 ClawPanel (#9)** — `linux-deploy.sh` 支持非 root 安装：普通用户安装到 `$HOME/.local/share/clawpanel`，使用 user-level systemd 服务 + `loginctl enable-linger`；系统包安装通过 `run_pkg_cmd()` 按需 sudo

## [0.4.8] - 2026-03-06

### 修复 (Bug Fixes)

- **macOS Gateway 启动失败 (Bootstrap failed: 5)** — plist 二进制路径过期（如 nvm/fnm 切版本后）导致 `launchctl bootstrap` 报 I/O error。新增回退机制：launchctl 失败时自动改用 CLI 直接启动 Gateway，启动和重启均适用

## [0.4.7] - 2026-03-06

### 修复 (Bug Fixes)

- **fnm 用户 Node.js 检测失败** — 移除错误的 `~/.fnm/current/bin`，改为扫描 `$FNM_DIR/node-versions/*/installation/bin`（macOS/Linux）和 `%FNM_DIR%\node-versions\*\installation`（Windows），兼容 fnm 默认 XDG 路径
- **Release Notes 生成失败** — 中文 commit message 不以 `feat:/fix:` 开头时 `grep` 返回 exit 1，GitHub Actions `pipefail` 导致脚本终止，已用 `|| true` 修复

## [0.4.6] - 2026-03-06

### 修复 (Bug Fixes)

- **严重：mode 字段位置错误导致 Gateway 无法启动** — `"mode": "local"` 被错误写入 `openclaw.json` 顶层，OpenClaw 报 `Unrecognized key: "mode"`。正确位置是 `gateway.mode`，已修复所有写入点（init_openclaw_config、dashboard 自愈、setup 安装流程）
- **旧版配置自动修复** — 仪表盘加载时自动删除错误的顶层 `mode` 字段并移入 `gateway.mode`，已安装用户无需手动编辑

## [0.4.5] - 2026-03-06

### 修复 (Bug Fixes)

- **nvm 用户 Node.js/CLI 检测失败** — `enhanced_path()` 新增扫描 `~/.nvm/versions/node/*/bin`（macOS/Linux）和 `%APPDATA%\nvm\*`（Windows），从 Finder/桌面启动也能找到 nvm 安装的 Node.js
- **Tauri v2 参数名不匹配** — `check_node_at_path`、`save_custom_node_path` 及所有 memory 函数的 snake_case 参数改为 camelCase，修复手动指定 Node.js 路径报 `missing required key` 的问题
- **Windows OpenClaw CLI 检测遗漏** — `is_cli_installed()` 仅检查 `%APPDATA%\npm\openclaw.cmd`，新增通过 PATH 运行 `openclaw --version` 兜底，兼容 nvm、自定义 prefix 等安装方式
- **Agent 管理/记忆文件页面晦涩错误** — `No such file or directory (os error 2)` 替换为中文提示「OpenClaw CLI 未找到，请确认已安装并重启 ClawPanel」

### 新增 (Features)

- **初始设置自动创建配置文件** — 检测到 CLI 已装但 `openclaw.json` 不存在时，自动创建含合理默认值的配置文件（mode:local, tools:full 等），无需手动执行 `openclaw configure`
- **一键初始化配置按钮** — 自动创建失败时，设置页第三步显示「一键初始化配置」按钮作为手动备选
- **ClawPanel Web 版部署文档** — 新增 Linux 一键部署脚本和 Docker 部署指南，官网增加文档中心

## [0.4.4] - 2026-03-06

### 新增 (Features)

- **Agent 工具权限配置** — Gateway 配置页新增「工具权限」区域，可选完整权限（full）/ 受限模式（limited）/ 禁用工具（none），以及会话可见性设置
- **工具权限自愈** — 安装/升级后自动设置 `tools.profile: "full"` + `tools.sessions.visibility: "all"`，老用户打开面板也会自动补全，避免 OpenClaw 2026.3.2 新版默认关闭工具导致不好用

## [0.4.3] - 2026-03-06

### 修复 (Bug Fixes)

- **Gateway 首次安装后无法启动** — 安装流程未设置 `mode: "local"`，导致 Gateway 不知道以什么模式运行。现在安装完成后自动写入，仪表盘加载时也会自愈补全

## [0.4.2] - 2026-03-06

### 修复 (Bug Fixes)
- **Windows Node.js 检测失败** — `enhanced_path()` 扩展为跨平台，Windows 上自动扫描 Program Files、LOCALAPPDATA、APPDATA、常见盘符（C/D/E/F）下的 Node.js 安装路径
- **Git SSH 导致安装失败 (exit 128)** — npm 依赖使用 SSH 协议拉取 GitHub 仓库，用户没配 SSH Key 时报 `Permission denied (publickey)`。安装前自动执行 `git config --global url.https://...insteadOf ssh://...` 切换为 HTTPS
- **npm 安装失败无引导** — 安装/升级 OpenClaw 失败时仅显示"安装失败"，现在自动诊断错误类型（Git SSH 权限 / Git 未安装 / EPERM 文件占用 / MODULE_NOT_FOUND 安装不完整 / ENOENT / 权限不足 / 网络错误 / 缓存损坏）并给出具体修复命令

### 优化 (Improvements)

- **Node.js 路径扫描** — 检测不到 Node.js 时提供「自动扫描」按钮，扫描 C/D/E/F/G 盘常见安装路径（含 AI 工具目录），找到后一键选用
- **手动指定 Node.js 路径** — 用户可手动输入 Node.js 安装目录，检测通过后自动保存到 `~/.openclaw/clawpanel.json`，后续所有命令自动使用
- **跨平台检测引导** — 安装引导页 Node.js 检测失败时，macOS 提示从终端启动，Windows 提示重启 ClawPanel 或检查 PATH
- **错误诊断模块** — 新增 `error-diagnosis.js` 共享模块，安装引导页和服务管理页共用错误诊断逻辑
- **README 常见问题** — 新增 7 个常见安装问题的排查指南

## [0.4.1] - 2026-03-06

### 修复 (Bug Fixes)

- **macOS Node.js 检测失败** — Tauri 从 Finder 启动时 PATH 不含 `/usr/local/bin`、`/opt/homebrew/bin` 等常见路径，导致 `check_node`、`npm_command`、`openclaw_command` 找不到命令。新增 `enhanced_path()` 补充 nvm/volta/nodenv/fnm/n 等 Node.js 管理器路径

## [0.4.0] - 2026-03-05

### 新增 (Features)

- **Gateway 进程守护** — 检测到 Gateway 意外停止时自动重启（最多 3 次，60s 冷却期），用户主动停止不干预
- **守护恢复横幅** — 连续重启失败后顶部弹出恢复选项（重试启动 / 从备份恢复 / 服务管理 / 查看日志）
- **配置文件自愈** — 读取 `openclaw.json` 时自动剥离 UTF-8 BOM，JSON 损坏时自动从 `.bak` 恢复
- **双配置同步** — 保存模型配置时自动同步到 agent 运行时注册表（`models.json`），包括新增/修改/删除 provider 和 model
- **流式输出安全超时** — 90 秒无新数据自动结束流式输出，防止 UI 卡死
- **聊天响应耗时显示** — AI 回复时间戳后显示响应耗时（如 `20:09 · 1.7s`）
- **跨天时间显示** — 非当天消息显示日期（如 `03-04 20:09`），当天仅显示时间
- **仪表盘自动刷新** — Gateway 状态变化时自动刷新仪表盘数据，无需手动刷新

### 修复 (Bug Fixes)

- **401 无效令牌** — 修复 `models.json`（agent 运行时注册表）与 `openclaw.json` provider 配置不同步导致的认证失败
- **删除模型后 Gateway 崩溃** — 删除模型/渠道后自动切换主模型到第一个可用模型，同步清理 `models.json` 中已删除的 provider 和 model
- **WebSocket 连接被拒** — `allowedOrigins` 改为通配符 `["*"]`，兼容所有 Tauri 运行模式
- **模型测试触发 Gateway 重启** — 测试结果保存改用 `saveConfigOnly`，不再触发不必要的重启
- **主模型配置不生效** — `applyDefaultModel` 同步更新到各 agent 的模型覆盖配置，防止 agent 级别旧值覆盖全局默认
- **WS 代理报错刷屏** — Vite 配置静默处理 Gateway 不可达时的 proxy error
- **历史图片丢失提示** — 刷新后 Gateway 不返回图片原始数据时显示友好提示

### 优化 (Improvements)

- **拖拽排序重写** — 模型拖拽排序改用 Pointer Events 实现，兼容 Tauri WebView2/WKWebView
- **用户消息附件保存** — 发送的图片附件保存到本地缓存，支持页面内恢复

## [0.3.0] - 2026-03-04

### 新增 (Features)

- **Gateway 认证模式切换** — 支持 Token / 密码双认证模式，卡片式选项可视化配置
- **GitHub Pages 全面重写** — 零 CDN 依赖（移除 Tailwind/Google Fonts），纯 CSS 实现，页面秒开
- **社区交流板块** — 新增多种社区入口与更新渠道
- **10 张演示截图** — GitHub Pages 与 README 同步集成功能截图，含交互式灯箱与 hover 特效
- **高级视觉特效** — 粒子上升动画、旋转彩虹边框、鼠标追光、浮动光球、透视英雄图等纯 CSS/JS 实现

### 修复 (Bug Fixes)

- **origin not allowed 自动修复** — WebSocket 握手阶段的 origin 拒绝错误现在正确触发自动配对修复
- **防止自动配对死循环** — 限制自动配对最多尝试 1 次，失败后显示连接遮罩而非无限重连
- **诊断页修复按钮反馈** — 「一键修复配对」按钮增加 loading 状态和日志面板自动滚动
- **Logo 加载修复** — GitHub Pages 使用本地 logo.png，修复私有仓库无法加载的问题
- **亮色模式按钮文字** — 修复 glow-border 按钮在亮色模式下文字不可见的问题

### 优化 (Improvements)

- **README 社区板块** — 新增二维码展示 + 6 个社区渠道链接表格
- **WebSocket 监听器清理** — connectGateway 调用前清理已有事件监听，防止重复绑定

## [0.2.1] - 2026-03-04

### 新增 (Features)

- **聊天图片完整支持** — AI 响应中的图片现在可以正确提取和渲染（支持 Anthropic / OpenAI / 直接格式）
- **图片灯箱查看** — 点击聊天中的图片可全屏查看，支持 ESC 关闭
- **会话列表折叠** — 聊天页面侧边栏支持点击 ≡ 按钮收起/展开，带平滑过渡动画
- **参与贡献入口** — 关于页面新增「参与贡献」区块，包含提交 Issue、提交 PR、贡献指南等快捷链接

### 修复 (Bug Fixes)

- **聊天历史图片丢失** — `extractContent` / `dedupeHistory` / `loadHistory` 现在正确提取和渲染历史消息中的图片
- **流式响应图片丢失** — delta / final 事件处理新增 `_currentAiImages` 收集，`resetStreamState` 正确清理
- **私有仓库更新检测** — 检查更新失败时区分 403/404（仓库未公开）和其他错误，显示友好提示

### 优化 (Improvements)

- **开源文档完善** — 新增 `SECURITY.md` 安全政策，同步版本号至 0.2.x，补充项目元数据
- **仪表盘分波渲染** — 9 个 API 改为三波渐进加载，关键数据先显示，消除白屏等待

## [0.2.0] - 2026-03-04

### 新增 (Features)

- **ClawPanel 自动更新检测** — 关于页面自动检查 ClawPanel 最新版本，显示更新链接
- **系统诊断页面** — 全面检测系统状态（服务、WebSocket、Node.js、设备密钥），一键修复配对
- **聊天连接引导遮罩** — WebSocket 连接失败时显示友好引导界面，提供「修复并重连」按钮，替代原始错误消息
- **图片上传与粘贴** — 聊天页面支持附件上传和 Ctrl+V 粘贴图片，支持多模态对话

### 修复 (Bug Fixes)

- **首次启动 origin 拒绝** — 修复 `autoPairDevice` 在设备密钥不存在时提前退出、未写入 `allowedOrigins` 的问题
- **Gateway 配置不生效** — 写入 `allowedOrigins` 后自动 `reloadGateway`，确保新配置立即生效
- **WebSocket 自动修复** — `_autoPairAndReconnect` 补充 `reloadGateway` 调用，修复自动配对后仍被拒绝的问题
- **wsClient.close 不存在** — 修正为 `wsClient.disconnect()`
- **远程模型缺少视觉支持** — 添加模型时 `input` 改为 `['text', 'image']`
- **连接级错误拦截** — 拦截 `origin not allowed`、`NOT_PAIRED` 等连接级错误，不再作为聊天消息显示

### 优化 (Improvements)

- **仪表盘分波渲染** — 9 个 API 请求改为三波渐进加载，关键数据先显示，消除打开时的白屏等待
- **全页面骨架屏** — 所有页面添加 loading-placeholder 骨架占位，提升加载体验
- **页面清理函数** — models.js 添加 `cleanup()` 清理定时器和中止控制器，防止内存泄漏
- **发布工作流增强** — release.yml 生成分类更新日志、可点击下载链接、首次使用指南

## [0.1.0] - 2026-03-01

首个公开发布版本，包含 OpenClaw 管理面板的全部核心功能。

### 新增 (Features)

- **仪表盘** — 6 张状态卡片（Gateway、版本、Agent 舰队、模型池、隧道、基础服务）+ 系统概览面板 + 最近日志 + 快捷操作
- **服务管理** — OpenClaw 服务启停控制、版本检测与一键升级（支持官方/汉化源切换）、Gateway 安装/卸载、npm 源配置（淘宝/官方/华为云）、配置备份管理（创建/恢复/删除）
- **模型配置** — 多服务商管理（支持 OpenAI/Anthropic/DeepSeek/Google 预设）、模型增删改查、主模型与 Fallback 选择、批量连通性测试与延迟检测、拖拽排序、自动保存 + 撤销栈（最多 20 步）
- **网关配置** — 端口配置、运行模式（本地/云端）、访问权限（本机/局域网）、认证 Token、Tailscale 组网选项，保存后自动重载 Gateway
- **Agent 管理** — Agent 增删改查、身份编辑（名称/Emoji）、模型配置、工作区管理、Agent 备份
- **聊天** — 流式响应、Markdown 渲染、会话管理、Agent 选择、快捷指令、WebSocket 连接
- **日志查看** — 多日志源（Gateway/守护进程/审计日志）实时查看、关键词搜索、自动滚动
- **记忆管理** — 记忆文件查看/编辑、分类管理（工作记忆/归档/核心文件）、ZIP 导出、Agent 切换
- **扩展工具** — cftunnel 内网穿透隧道管理（启停/日志/路由查看）、ClawApp 守护进程状态监控、一键安装
- **关于页面** — 版本信息、社群二维码（QQ/微信）、相关项目链接、一键升级入口
- **主题切换** — 暗色/亮色主题，CSS Variables 驱动
- **自定义 Modal** — 全局替换浏览器原生弹窗（alert/confirm/prompt），兼容 Tauri WebView
- **CI/CD** — GitHub Actions 持续集成 + 全平台发布构建（macOS ARM64/Intel、Windows x64、Linux x64）
- **手动发布** — 支持 workflow_dispatch 手动触发构建，填入版本号即可一键发布

### 优化 (Improvements)

- **全局异步加载** — 所有页面 render() 非阻塞返回 DOM，数据在后台异步加载，消除页面切换卡顿
- **路由模块缓存** — 已加载的页面模块缓存复用，二次切换跳过动态 import
- **Tauri API 预加载** — invoke 模块启动时预加载，避免每次 API 调用的动态 import 开销
- **页面过渡动画** — 进入动画（220ms 上滑淡入）+ 退出动画（100ms 淡出），丝滑切换体验
- **Windows 兼容** — Rust 后端通过 `#[cfg(target_os)]` 条件编译支持 Windows 平台（服务管理、版本检测、扩展工具等）
- **Setup 引导模式** — 未安装 OpenClaw 时自动进入引导页面，安装完成后切换到正常模式

### 技术亮点

- 零框架依赖：纯 Vanilla JS，无 React/Vue 等框架
- Tauri v2 + Rust 后端，原生性能
- 玻璃拟态暗色主题，现代化 UI
- 全中文界面与代码注释
- 跨平台支持：macOS (ARM64/Intel) + Windows + Linux
