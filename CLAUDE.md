# Privix

AI Agent 工作台，基于 Tauri v2 + Vite 的跨平台桌面应用。核心能力：Claw 助手、ProspectResearch、Agentic Swarm、OpenClaw、Hermes。

## 架构概览

- **前端**: Vanilla JS (无 React/Vue) + Vite，Hash 路由 SPA
- **后端**: Tauri v2 (Rust) — 桌面版通过 IPC，Web 版通过 `dev-api.js` HTTP API
- **设计系统**: Apple Design(详见 `DESIGN.md`)— SF Pro 字体 + Apple Blue `#0071e3` + 980px 胶囊 CTA + navigation glass
- **版本**: v1.4.1,`package.json` 为唯一真相源

```
前端 → tauri-api.js → isTauri?
  ├─ YES → invoke() → Rust IPC → src-tauri/src/commands/*.rs
  └─ NO  → webInvoke() → fetch('/__api/cmd') → scripts/dev-api.js
```

## 开发命令

```bash
npm install                    # 安装依赖
./scripts/dev.sh               # macOS/Linux 桌面开发
./scripts/dev.sh web           # macOS/Linux Web 模式
npm run tauri dev              # Windows 桌面开发
npm run dev                    # Windows Web 模式
npm run test                   # 运行测试 (node --test)
npm run i18n:check             # i18n key 审计(默认仅扫 zh-CN 主 locale)
npm run i18n:check:strict      # 全量 11 locale 严格审计(CI 使用)
npm run i18n:install-hook      # 安装 git pre-commit(commit 前自动跑 i18n:check:strict)
npm run version:set 1.4.2      # 设版本号并同步
npm run version:sync           # 仅同步版本号到其他文件
# profile:invest / profile:qa / profile:sop 已废弃(v1.4.2+),保留仅供历史兼容
```

## 关键目录

| 目录 | 内容 | 数量 |
|------|------|------|
| `src/pages/` | 页面模块（每个导出 `render()`） | 40+ |
| `src/lib/` | 工具库（tauri-api, app-state, theme 等） | 47 |
| `src/components/` | 通用组件（sidebar, toast, modal） | 16 |
| `src/style/` | CSS 样式（CSS Variables 驱动） | - |
| `src-tauri/src/commands/` | Rust Tauri 命令模块 | 19 |
| `scripts/` | 开发与运维脚本 | - |
| `tests/` | 测试文件 | 31 |

## 产品 Profile 系统(已废弃)

> **v1.4.2+ 废弃说明**:产品已统一为单一 **Privix** 身份,不再按场景打包独立产品。投资工作台 / Agent 知识库 / Agent SOP 现在都是同一 App 内的**行业模块**(sidebar 主线 1),运行时按 license 激活,不需要独立构建。
>
> `scripts/apply-product-profile.js` 与 `npm run profile:invest/qa/sop` 保留仅供历史兼容,新的发布流程**不再切换 profile**,直接 `./scripts/build.sh release` 即可。
>
> v1.2.2 起 bundle identifier / 产品名已统一为 `Privix`;v1.4.2 起官网彩页、CHANGELOG、UPSTREAM 均以「AI Agent 工作台」单一定位叙述,场景化变体不再作为独立产品出现。
>
> 历史遗留字段(向后兼容,新代码不再使用):
> - `PROSPECTCLAW_PRODUCT_PROFILE` 环境变量
> - `invest_workbench` / `local_qa_kb` / `doc_sop` profile ID
> - `src/lib/product-profile.js` 中的 `MODULE_ROUTES` 与多身份分支

## 代码规范

- **前端**: Vanilla JS，不引入第三方 UI 框架；注释用中文
- **命名**: JS 变量/函数 camelCase，CSS 类名 kebab-case
- **异步**: 页面 `render()` 必须立即返回 DOM，不 await 数据加载
- **API 调用**: 统一通过 `src/lib/tauri-api.js`，不在页面直接 fetch
- **静态资源**: 本地化，禁止引用远程 CDN
- **Rust**: 2021 edition，外部命令必须用 `super::enhanced_path()` 设环境变量
- **提交**: Conventional Commits 格式 `<类型>(范围): 描述`
- **Apple UI**: 新组件优先用 `src/style/components.css` 的 `.apple-*`、`.btn-pill-*`、`.apple-link` 工具类,避免硬编码颜色/字号;颜色语义走 `--accent-blue`、`--link-blue`、`--surface-light`、`--text-body-secondary`、`--shadow-card` 等 token
- **i18n**: 页面文本**必须** `t('namespace.key')`,配套在 `src/i18n/zh-CN.json` 加键;pre-commit 钩子会跑 `i18n:check:strict`,任一 locale 缺失都阻 commit

## 侧边栏 9 主线(v1.4.0+)

侧边栏不再是弹出/zone 模式,改为 9 条内联主线:

1. **行业模块**(动态):Invest / Knowledge / SOP 三者运行时仅激活 1 个,折叠组
2. **Hermes**:点击切换引擎(保留引擎模式)
3. **OpenClaw**:折叠组,含 dashboard/chat/models/agents/memory/channels
4. **ProspectResearch**:`/evoscientist`
5. **Claw Swarm**:`/clawswarm`
6. **Claw Assistant**(钳子助手):`/assistant`
7. **AI 办公室 / 像素宠物**:`/star-office`
8. **一键配置**:`/quick-setup`(4 步向导)
9. **系统设置**:折叠组,含 services/logs/gateway/security/... 等 14 项

Hermes 引擎模式下侧边栏收敛为 4 主线子集(Hermes + Claw Assistant + 一键配置 + 系统设置)。

## 新增页面流程

1. 创建 `src/pages/xxx.js`,导出 `render()`,可选 `cleanup()`(清理 listener / 定时器)
2. `src/engines/openclaw/index.js` 的 `getRoutes()` 添加路由条目
3. `src/lib/product-profile.js` 的 `MODULE_ROUTES[BASE]` 或相应行业模块追加路由
4. `src/components/sidebar.js` 如需加入主线的 `children`,在 `getNavPillars()` 或 `getSystemSettingsItems()` 追加;`ICONS` 补图标

## 新增 Tauri 命令流程

1. `src-tauri/src/commands/xxx.rs` 添加 `#[tauri::command]` 函数
2. `src-tauri/src/lib.rs` 的 `invoke_handler` 注册
3. `src/lib/tauri-api.js` 的 `api` 对象添加前端方法
4. `mockInvoke` 的 `mocks` 对象添加 mock 数据

## 发布流程

仓库地址 `Hxitech/ProspectClaw`,**private 仓库** — GitHub release 下载链接对匿名访客返回 404,不能用作官网下载源。

DMG 分发走 **Vercel CDN**:
- 独立仓库:`Hxitech/prospectclaw-portal`(clone 到 `~/Documents/ProspectClawPortal/`)
- 自动部署:push 到 main → Vercel 自动构建 → `https://www.privix.cn/`
- DMG 路径约定:`downloads/Privix_X.Y.Z_aarch64.dmg`(underscore,匹配 Tauri 原生输出)

发布 vX.Y.Z 新版本:

```bash
# 1. 改版本号(同步 package.json / Cargo.toml / tauri.conf.json)
npm run version:set X.Y.Z

# 2. 改 CHANGELOG、UPSTREAM、openclaw-version-policy.json 相关条目,commit + push

# 3. 编译 DMG
./scripts/build.sh release

# 4. 打 tag + 推送(GitHub Release 由 gh CLI 创建,作为备份/归档,不用作下载源)
git tag vX.Y.Z && git push origin vX.Y.Z
gh release create vX.Y.Z \
  src-tauri/target/release/bundle/dmg/Privix_X.Y.Z_aarch64.dmg \
  --repo Hxitech/ProspectClaw \
  --title "vX.Y.Z — <亮点>" \
  --notes-file /tmp/release-notes.md

# 5. 发布到官网(Vercel CDN)- 一条命令搞定
./scripts/release-to-portal.sh
```

`release-to-portal.sh` 自动完成:
- 复制 DMG 到 `$PORTAL_DIR/downloads/`
- 改 `index.html` hero badge / download badge / 下载按钮 href
- 改 3 个 i18n locale 文件的 `hero.badge` / `download.badge`
- 同步面板内 `src/portal/portal.html` 下载 URL
- commit + push Portal 仓库 → Vercel 自动部署(~30s)

跑前可以 `./scripts/release-to-portal.sh --dry-run` 预览。

## 上游同步

与 [qingchencloud/clawpanel](https://github.com/qingchencloud/clawpanel) 保持 cherry-pick 式同步（不做 git merge）。
Invest / Knowledge / SOP 三个场景化模块的页面（`invest-*.js` 等）为我们独有，无需同步。
详见 `UPSTREAM.md`。
