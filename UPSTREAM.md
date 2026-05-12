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
| `sync/invest-2026-05` | `66c0db4` (v1.10.5) | Hermes Agent URL 版本 pin → `v2026.5.7` (0.13.0),含 8 个 P0 安全修复。未取该 commit 的 v1.7~v1.10 累积 Rust 命令、guardian / usage 命令 | 待 commit |
| `sync/invest-2026-05` | `d191810` (v1.9.3) | `enhanced_path()` 三平台补齐 cargo/go/deno/.local/bin,消除"shell OK / Privix command not found"诊断盲区 | 待 commit |

## 待评估同步项

跟踪商业版 ClawPanelInvest 与上游 clawpanel main 分支的变更,评估是否对社区版有价值:
- SkillHub 安全校验(SHA-256 + VirusTotal) — ❌ 商业版未实现
- 渠道插件版本智能适配 — ✅ 商业版 `cdda719`(v1.10.7)已实现,可 cherry-pick
- 工作区文件面板(Chat 页实时文件浏览) — ❌ 商业版未实现
- service.rs 自动修复(config mismatch + 进程超时保护) — ⚠️ 商业版 `cdda719` 部分实现(诊断已成熟,主动修复待补)
- Hermes 页面内容补全(services.js / config.js / channels.js) — ✅ 商业版 `74a7f08`(v1.10.0)+ `7b3a1d9`(v1.10.2)已实现,Rust 后端依赖 `hermes_list_channels` / `hermes_set_channel_enabled` 等新 RPC,需配套 port 大量 hermes.rs 改动

### 下一批次候选(评估顺序按价值)

1. **`74a7f08`** Hermes 三大运维页落地(channels / services / config)— UPSTREAM 第 5 项核心。**实际跨度远超单 commit**,需先 port 多个前置依赖:
   - 新建 `src/lib/gateway-restart-queue.js`(防抖 + 串行的 gateway 重启队列)
   - 新建 `src/lib/async-button.js`(`wrapAsyncButton` 工具)
   - 新建 `src/lib/error-report.js`(`reportError` 统一错误上报)
   - Rust 端:`hermes.rs` 新增 `hermes_list_channels` / `hermes_set_channel_enabled` 命令,通用化 `check_platform_enabled` / `patch_yaml_set_platform_enabled` 等 ~300 行
   - `src/lib/tauri-api.js`:挂上述 RPC + Web 模式 mock
   - 三页面落地:`channels.js`(164 行)、`services.js`(150 行)、`config.js`(118 行)
   - i18n:11 locale × ~15 新 key ≈ 165 行翻译(可机械同步自 invest 的 i18n diff)
   - 估计 1000+ 行总改动,适合作为独立 PR
2. **`71df25e`** Hermes refactor — 紧跟 74a7f08 的代码风格收敛
3. **`cdda719`** 摘取:openclaw-plugin-doctor / workspace-doctor / guardian-banner / service.rs config error detection — UPSTREAM 第 2 + 第 4 项部分
4. **`18cf7cd`** 摘取:provider-doctor / version-migration / chat.js 多模态 — OAuth 引入需评估零遥测白名单
5. **`7b3a1d9`** 摘取:openclaw-feature-gates 6 个新 gate + Plugin Hub doctor
6. **`b623c32`** 摘取:chat.js 中文引号 escape 修复 + i18n.js 通用占位符
7. **`3bbdcda`** 摘取:engine-manager.invalidate fix + i18n memo(页面切换性能)
8. **`4a52b22`** 摘取:gateway-restart-queue + agent-health circuit-breaker 通用化
