# 上游同步追踪

本文档记录 Privix Community 与上游 [qingchencloud/clawpanel](https://github.com/qingchencloud/clawpanel) 的同步状态。

## 仓库信息

| 项目 | 地址 | 许可证 |
|------|------|-------|
| 本项目 | https://github.com/privix-community/privix | Apache-2.0 |
| 上游 ClawPanel | https://github.com/qingchencloud/clawpanel | MIT |
| OpenClaw 核心 | https://github.com/openclaw/openclaw | — |
| OpenClaw 汉化版 | https://github.com/1186258278/OpenClawChineseTranslation | — |

## 初始起点

Privix Community 于 2026-04-19 从 Privix 内部版本 v1.6.0-fix1 拉出独立仓库,剥离所有商业专有模块后以 Apache-2.0 开源。初始版本 `2.0.0-ce.1`。

已剥离的商业模块(不再包含在本仓库):
- 激活码 / 授权系统 (license-gate、license.rs、product profile licensePolicy)
- Invest 工作台(20+ 页面:pool / pipeline / companies / contacts / deal / scoring / audit / automation 等)
- Knowledge Wiki 模块(Karpathy 式知识库)
- SOP 引擎(DAG 依赖、执行监督)
- ClawSwarm 多 Agent 编排
- Star Office / 像素宠物
- 自动更新检查、privix.cn CDN、portal 分发基础设施

保留的能力:
- OpenClaw 核心面板(上游 ClawPanel 衍生):dashboard / chat / models / agents / channels / gateway / memory / MCP / skills 等
- Hermes Agent 引擎(社区版双引擎)
- Claw Doctor(钳子医生)独立 AI 助手
- Apple 设计系统、i18n(11 locales)、多实例管理

## v2.1.0-ce.1(2026-04-20):隐私功能 + 研究工作台

CE 独有的差异化功能,明确社区版与商业版的切分:

| 新增 | 内容 | 文件 |
|---|---|---|
| **零遥测守卫** | `scripts/check-no-telemetry.js` 扫全仓硬编码 URL + allowlist,pre-commit 强制 | `scripts/check-no-telemetry.js`、`scripts/telemetry-allowlist.txt` |
| **敏感信息检测** | 发送前检测 API Key / JWT / PEM / 身份证 / 手机号 / 银行卡,弹窗选择掩码/移除/原文 | `src/lib/sensitive-detect.js` |
| **ProspectResearch 精简版** | 从商业版 EvoScientist 移植通用研究 flow,**剥离 PE/VC KB 依赖** | `src/pages/evoscientist.js` + `src/lib/evoscientist-*.js`,路由 `/research` |
| **Workspace 隔离** | localStorage 命名空间 monkey-patch + 侧边栏切换器 + CRUD | `src/lib/workspace-storage.js`、`workspace-manager.js`、`src/components/workspace-switcher.js` |

## CE ↔ 商业版 ProspectResearch 同步表

| 社区版 `/research` | 商业版 `/evoscientist` | 同步策略 |
|---|---|---|
| 多轮研究 / 综述 / 引用 flow | 同上 + PE/VC 尽调模板 + 企业 KB | Cherry-pick 商业版改动到 CE,剥离 PE/VC 相关代码 |
| 持久化:会话 / 线程 / 模型 provider | 同上 | 共用 evoscientist-state.js、evoscientist-readiness.js、evoscientist-persona.js |
| 导出:DOCX / PPTX / HTML | 同上 | doc-export.js 同源共享,无差异 |
| 依赖 `task-case-templates.js` | ✅ | CE 已移除(strip PE/VC case 分类) |
| 依赖 `pevc-kb.js` / `invest-*` | ✅(商业版独有) | CE 不 sync |

**当商业版 `evoscientist.js` 改动时**:
1. 检查改动是否涉及 `pevc-kb`、`invest-*`、`task-case-templates` → 若涉及,只 port 非 PE/VC 部分
2. 通用研究 flow 改进(prompt / UI / 性能) → 直接 port 到 CE 同名文件
3. Bug fix → 直接 port

## 同步策略

1. **不做 git merge**:与上游结构差异大,直接 merge 会产生大量冲突
2. **Cherry-pick 式同步**:对比上游变更,手动将有价值的改进移植到社区版
3. **关注核心页面**:channels.js、gateway.js、services.js、skills.js、chat.js 是主要同步点
4. **定期检查**:每个上游 release 发布后评估是否需要同步
5. **安全修复优先**:上游的安全修复(CVE、XSS、注入漏洞)直接跟进

## 已同步记录

| 批次 | 来源 commit (ClawPanelInvest) | 同步范围 | CE commit |
|---|---|---|---|
| `sync/invest-2026-05` | `66c0db4` (v1.10.5) | Hermes Agent URL 版本 pin → `v2026.5.7` (0.13.0),含 8 个 P0 安全修复。未取该 commit 的 v1.7~v1.10 累积 Rust 命令、guardian / usage 命令 | b8fa531 |
| `sync/invest-2026-05` | `d191810` (v1.9.3) | `enhanced_path()` 三平台补齐 cargo/go/deno/.local/bin,消除"shell OK / Privix command not found"诊断盲区 | b8fa531 |
| `sync/invest-2026-05` | `74a7f08` (v1.10.0) 摘取 | Hermes 三大运维页(channels/services/config)落地 + `hermes_list_channels` / `hermes_set_channel_enabled` Rust 命令 + 通用化 `check_platform_enabled` / `patch_yaml_set_platform_enabled` + 3 个新 lib(gateway-restart-queue / async-button / error-report) + 11 locale × 34 i18n key + 3 comp_toast key。**跳过 models.js / dashboard 使用卡 / hermes_usage_today**(均为新功能而非 fix) | 待 commit |
| `sync/invest-2026-05` | `71df25e` (v1.10.0) 摘取 | escHtml → escapeHtml 安全修复(channels.js / services.js 属性转义 XSS) + config.js lineHeight 魔法数修复。**跳过 dashboard.js refresh 并行化 / hermes_usage_today 反向扫尾**(我们没 port hermes_usage_today) | 243ea74 |
| `sync/invest-2026-05` | `cdda719` (v1.10.7) Module A + D | Plugin 冲突主动检测(openclaw-plugin-doctor.js + plugin-hub.js conflict banner)+ Gateway Guardian 状态暴露(service.rs last_config_error + guardian-banner.js + dashboard 挂载)+ 11 locale × 21 key i18n。**跳过 Module B**(workspace 权限自检,涉及新 Rust 命令)、**Module C**(沙箱可视化,涉及新 Rust 命令 + channels.js modal 改)、**Module E**(健康总览 modal,依赖 B/C/D 全部) | f8f1408 |
| `sync/invest-2026-05` | `18cf7cd` (v1.10.6) Bug 1 摘取 | OAuth Provider Doctor:`openclaw-provider-doctor.js`(216 行)修复 OpenClaw 5.4+ *-portal OAuth 与 API Key sibling 共存导致 fallback chain 全挂的问题。main.js boot hook 24h 节流触发。**跳过 Bug 2**(钳子助手→医生重命名,与 CE 命名状态不对齐)、**Bug 3**(chat 多模态,涉及 hermes_agent_run Rust 改动 + file-utils 新建 + chat.js 改)、**Bug 4**(welcome modal 路由 + version-migration.js 新建) | a862b71 |
| `sync/invest-2026-06` | `df5dd02` | 启动引擎选择智能回退 + Hermes 初始化空头支票(`engine-manager.js` +29 行) | 待 commit |
| `sync/invest-2026-06` | `47bd66d` (v1.10.8) 摘取 | OpenClaw 升级前自动 `create_backup()`(config.rs)+ Gateway `/health` 卡死探针 3 次失败自动 reload(service.rs)+ `CONFIG_ERROR_PATTERNS` 加 9 个模式(ECONNREFUSED/EMFILE/TLS) + Hermes 安装日志 `sanitize_hermes_install_output()`(hermes.rs)+ boot Promise.all 三路并发 + `.catch` 错误 UI 兜底(main.js)+ readOpenclawConfig/readMcpConfig TTL 15→60s + chat.js loadHistory 代际计数 + assistant.js visibility skip + cron.js render 去 await + guardian-banner restore-recommended 按钮 + 11 locale × 8 i18n key。**跳过** star-office.js / automation.js(CE 无)/ openclaw-version-policy.json(CE 自己 baseline)/ run_openclaw_compat_repair_after_upgrade(CE 无该函数) | 待 commit |
| `sync/invest-2026-06` | `8bfc138` (v1.10.9) | Windows 关机阶段 0xc0000142 弹窗修复:删除 `RunEvent::Exit` 的 Windows shutdown handler(lib.rs -13 行)。同步上游 v0.15.3 | 待 commit |
| `sync/invest-2026-06` | `ca62b5d` (v1.10.10) 摘取 | Hermes `memory.js` / `skills.js` 本地 `escHtml`(缺 `"`/`'` 转义)→ `escape.js#escapeHtml`,与 sync-05 的 channels/services 修复同源。**跳过 hero.js 提取 / hermes.css 动画去重 / 死资源删除**(均为视觉个性化,CE 未引入对应基线) | 4ab3ecb |
| `sync/invest-2026-07` | `cdda719` (v1.10.7) Module B + C 摘取 | **Workspace 权限自检** — `openclaw-workspace-doctor.js`(109 行 lib)+ `check_workspace_permissions` Rust 命令(扫 workspace + 6 个子目录的 Unix uid,与当前 $HOME uid 比对)+ Channels 页 render() 后触发 + modal(列 bad dirs + sudo chown 命令一键复制 + "复检"按钮)+ 24h localStorage 节流。**本地文件沙箱可视化** — 11 个 platform 配置 modal 顶部 info card(workspace / media / tmp 允许目录)+ "打开 workspace" 按钮调新 Rust `open_workspace_folder` 命令(macOS open / Linux xdg-open / Windows explorer)+ 11 locale × 16 新 i18n key。**跳过 Module E**(health-overview-modal.js 209 行新组件) | 待 commit |
| `sync/invest-2026-07` | `77b7ca3` (v1.10.14) 摘取 | **OpenClaw 5.12 内核兼容** — `8b690cb`: Gateway 握手协议 v4 (`maxProtocol: 3→4` 在 device.rs `create_connect_frame`) + `ws-client.js` 加 `negotiatedProtocol` getter + `chat-event-compat.js` 加 `replace=true` 语义 + `openclaw-feature-gates.js` 加 2 个新常量。`dcafd29`(部分): `versions_match` / `recommended_is_newer` suffix 级补丁检测。**chat 路由守卫** — `f411386`: 5 处 `_messagesEl.isConnected` 守卫(`createStreamBubble` / `renderChatGroup` / `appendSystemMessage` 等),消除路由切换后异步事件污染死 DOM。**主模型自愈** — `9742786`: dashboard.js 加 `collectConfigModels` / `defaultModelNeedsNormalization` / `normalizeDefaultModelConfig` 自愈 primary/fallbacks。**Dashboard 启动性能** — `322bf1a` + `2f7cd6d`: version 拉到独立 Promise + 核心 timeout 12s/5s → 2.5s/2s + 1.2s 首屏兜底 + 模块级 `_dashboardVersionCache`。**跳过** Services/About "升级到最新版" 按钮 / 协议徽标 UI / 助手按引擎切换身份 / Hermes Rust/install fix(provider 自愈、互斥锁、hermes_capabilities、安装诊断、Qwen rename — CE 无 Hermes provider 系统前置)/ Windows Gateway 可见终端(Privix 独有)/ 推荐版本号 5.7→5.12(CE baseline 自决) | 2279a26 |
| `sync/invest-2026-08` | `e748b72` + Hermes 0.13→0.16 链 + `e0edd60` + `ac08330` 摘取 | **内核兼容** — `e748b72`: ws-client.js hello.server.version 双读(2026.5.18+ 嵌套版本字段)+ mod.rs 补 `windows_npm_global_prefix()`(修 skills.rs 引用但未定义的 Windows 潜伏编译失败)+ 3 个 feature gate 留位(HELLO_NESTED_SERVER / SKILL_WORKSHOP / WORKBOARD)。**Hermes 0.16.0** — `fd6948b`/`b6a297b`/`6cbbbaa`: HERMES_TARGET_VERSION 0.13→0.16 + URL v2026.5.7→v2026.6.5 + `HERMES_TOOL_WITH_DEPS` 数组(croniter/httpx/openai/aiohttp/websockets,消息发送依赖)应用到 install+reinstall。**内存泄漏** — `e0edd60`: chat.js 灯箱 close 解绑 keydown + `_transientOverlayClosers` Set cleanup 兜底 + chat-event-compat replace 空值守卫(+3 单测)。**i18n 时序** — `ac08330`: welcome-modal AI_SPOTLIGHT_STEPS const → getAiSpotlightSteps() 延迟求值。**跳过** 推荐版本号强升 5.12→6.1(CE baseline 自决)/ Windows CLI .exe/.js 检测(留下批)/ d2cf86e CLI 缓存(耦合 Windows)/ Hermes pages(自主演化)/ env.js + 商业页面(CE 无)/ Power User 新功能 / 外部客户端导入 | 7ce281c / b1c84f3 |
| `sync/invest-2026-08` (loop 续) | `36e7c3e` + `6a2feeb` + `293a8e6` + `8b57448` + `e748b72`/`d2cf86e` 摘取 | **崩溃** — `36e7c3e`: service.rs 3 处 `Command::new("openclaw")` → 缓存 `openclaw_command[_async]()`(升级后版本切换失效)。**路由卡死** — `6a2feeb`: engine-route-policy `isHermesEngineRoute` + OpenClaw→Hermes 深链切换 + main.js 守卫 `switchEngine` + product-profile 补 `/h/logs` `/h/memory`。**桌面启动卡死** — `293a8e6`: checkAuth/登录 `readPanelConfig` 加 2.5s withTimeout + 登录 web session 非阻塞 `syncWebSessionBestEffort`。**性能/内存** — `8b57448`: chat 队列上限 50 + 图片 lazy/decoding + channels Promise.allSettled 并发超时。**Windows CLI** — `e748b72`+`d2cf86e`: `find_openclaw_cmd` 检测 .exe/.js 新入口 + 60s TTL 缓存 + `apply_windows_openclaw_invocation`(.js 走 node)+ agent_detect 去多余 CommandExt(双目标 cargo check 验证)。**跳过** memory.js 搜索防抖(CE 无搜索功能)/ scan_all_installations 多安装扫描(新功能)/ renderFatalStartupError(sync-06 已有兜底) | 6707152 / 81c7dad / 待 commit |

## 待评估同步项

跟踪商业版 ClawPanelInvest 与上游 clawpanel main 分支的变更,评估是否对社区版有价值:
- SkillHub 安全校验(SHA-256 + VirusTotal) — ❌ 商业版未实现
- 渠道插件版本智能适配 — ✅ **已完成**:Plugin doctor + conflict banner(`cdda719` Module A,sync-05)+ Workspace 权限自检 + 沙箱可视化(`cdda719` Module B+C,sync-07);Module E 健康总览暂跳(新功能,209 行)
- 工作区文件面板(Chat 页实时文件浏览) — ❌ 商业版未实现
- service.rs 自动修复(config mismatch + 进程超时保护) — ✅ **部分完成**:`last_config_error` 暴露给前端 banner(`cdda719` Module D),完整的"自动修复"留待后续(目前是给用户根因 tip + 手动重启入口)
- Hermes 页面内容补全(services.js / config.js / channels.js) — ✅ **已完成**(`sync/invest-2026-05` 第二批次同步自 invest `74a7f08` + `71df25e`)

### 下一批次候选(评估顺序按价值)

> v1.10.14→v1.10.29 范围内所有**可安全 port 的 fix 已全部同步**(见上方 sync-08 + loop 续两行)。
> 剩余仅一项关键路径 fix 需专门一轮 + Windows 实测,不宜混在批量同步里:

0. **`6cbbbaa` Windows 配对稳定性**(⚠️ 关键路径,独立一轮处理):pairing.rs 就地升级旧 paired.json 条目
   (`normalize_control_ui_pairing` / `ensure_operator_token`,修 stale 条目被 Gateway 无限拒绝,347 行)
   + ws-client.js/main.js 配对后不再 auto-reloadGateway(Windows 上误杀手动启动的 Gateway)+ chat.js
   autoPairDevice 竞态守卫。**为何 defer**:改设备配对/连接关键路径,upgrade-in-place 语义依赖 Gateway 行为,
   reload 移除与 pairing.rs 升级强耦合,半 port 有破坏连接流回归风险,需 Windows 实测验证。

1. **`cdda719` Module E**(health-overview-modal.js 209 行新组件 — 跳过,新功能)
2. **`77b7ca3` 剩余**:`models.js` 主模型自愈完整版(154 行 diff,补 dashboard 简版未覆盖的 toast + 4 个 helper)/`settings.js` Windows 终端选项 / `assistant.js` 引擎切换身份(110 LOC,Hermes Only)/ `about.js`+`services.js` "升级到最新版" 按钮
3. **`18cf7cd`** Bug 3:chat 多模态(涉及 hermes_agent_run Rust 改 + file-utils 新建 + chat.js 改)
4. **`7b3a1d9`** 摘取:openclaw-feature-gates 6 个新 gate + Plugin Hub doctor
5. **`b623c32`** 摘取:chat.js 中文引号 escape 修复 + i18n.js 通用占位符
6. **`3bbdcda`** 摘取:engine-manager.invalidate fix + i18n memo(页面切换性能)
7. **`4a52b22`** 摘取:gateway-restart-queue + agent-health circuit-breaker 通用化(部分已在 sync-05 port `gateway-restart-queue.js`)
8. **`ebcc8cd`** Hermes 流式 fallback + Provider 注册表 + Dashboard 生命周期(依赖 CE 没有的 backend)— 完整 port 需大量前置
