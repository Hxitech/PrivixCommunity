# Privix Community

开源 AI Agent 桌面工作台,基于 Tauri v2 + Vite 的跨平台应用。核心能力:OpenClaw 管理面板 + Hermes Agent 引擎 + Claw Doctor 助手。

## 架构概览

- **前端**: Vanilla JS (无 React/Vue) + Vite,Hash 路由 SPA
- **后端**: Tauri v2 (Rust) — 桌面版通过 IPC,Web 版通过 `scripts/dev-api.js` HTTP API
- **设计系统**: Apple Design — SF Pro 字体 + Apple Blue `#0071e3` + 980px 胶囊 CTA + navigation glass
- **版本**: 见 `package.json`(唯一真相源),当前 `2.0.0-ce.1`
- **许可证**: Apache-2.0;上游 ClawPanel 衍生部分保留 MIT(详见 `LICENSE` / `NOTICE`)

```
前端 → tauri-api.js → isTauri?
  ├─ YES → invoke() → Rust IPC → src-tauri/src/commands/*.rs
  └─ NO  → webInvoke() → fetch('/__api/cmd') → scripts/dev-api.js
```

## 开发命令

```bash
npm install                    # 安装依赖
npm run tauri dev              # 桌面开发
npm run dev                    # Web 模式
npm run test                   # 运行测试 (node --test)
npm run lint                   # ESLint
npm run i18n:check             # i18n key 审计(默认仅扫 zh-CN 主 locale)
npm run i18n:check:strict      # 全量 11 locale 严格审计(CI 使用)
npm run i18n:install-hook      # 安装 git pre-commit(commit 前自动跑 i18n:check:strict)
npm run version:set 2.0.1      # 设版本号并同步到 Cargo.toml / tauri.conf.json
```

## 关键目录

| 目录 | 内容 |
|------|------|
| `src/pages/` | 页面模块(每个导出 `render()`) |
| `src/lib/` | 工具库 (tauri-api, app-state, theme, product-profile 等) |
| `src/components/` | 通用组件 (sidebar, toast, modal) |
| `src/style/` | CSS 样式(CSS Variables 驱动) |
| `src-tauri/src/commands/` | Rust Tauri 命令模块 |
| `scripts/` | 开发与运维脚本 |
| `tests/` | 测试文件 |

## 产品 Profile

社区版为单一 profile `privix-community`,无激活码、无模块解锁概念。`src/lib/product-profile.js` 保留了 `MODULE_IDS` / `MODULE_META` 结构,但只存在 BASE 模块,所有路由默认可用。

## 代码规范

- **前端**: Vanilla JS,不引入第三方 UI 框架;注释用中文
- **命名**: JS 变量/函数 camelCase,CSS 类名 kebab-case
- **异步**: 页面 `render()` 必须立即返回 DOM,不 await 数据加载
- **API 调用**: 统一通过 `src/lib/tauri-api.js`,不在页面直接 fetch
- **静态资源**: 本地化,禁止引用远程 CDN
- **Rust**: 2021 edition,外部命令必须用 `super::enhanced_path()` 设环境变量
- **提交**: Conventional Commits 格式 `<类型>(范围): 描述`
- **Apple UI**: 新组件优先用 `src/style/components.css` 的 `.apple-*`、`.btn-pill-*`、`.apple-link` 工具类,避免硬编码颜色/字号
- **i18n**: 页面文本**必须** `t('namespace.key')`,配套在 `src/i18n/zh-CN.json` 加键;pre-commit 钩子会跑 `i18n:check:strict`,任一 locale 缺失都阻 commit

## 侧边栏结构

侧边栏为内联折叠组:

1. **OpenClaw**:折叠组,含 dashboard / chat / models / agents / memory / mcp / channels
2. **钳子医生**(Claw Doctor):`/assistant` 独立 AI 助手
3. **一键配置**:`/quick-setup`(多步向导)
4. **系统设置**:折叠组,含 services / route-map / logs / gateway / communication / security / skills / plugin-hub / dreaming / cron / usage / settings / diagnose / chat-debug / about

Hermes 引擎模式下侧边栏收敛为:Hermes 折叠组 + 钳子医生 + 一键配置 + 系统设置。

## 新增页面流程

1. 创建 `src/pages/xxx.js`,导出 `render()`,可选 `cleanup()`(清理 listener / 定时器)
2. `src/engines/openclaw/index.js` 的 `getRoutes()` 添加路由条目
3. `src/lib/product-profile.js` 的 `MODULE_ROUTES[BASE]` 追加路由
4. `src/components/sidebar.js` 如需侧栏入口,在 `getNavPillars()` 或 `getSystemSettingsItems()` 追加;`ICONS` 补图标

## 新增 Tauri 命令流程

1. `src-tauri/src/commands/xxx.rs` 添加 `#[tauri::command]` 函数
2. `src-tauri/src/lib.rs` 的 `invoke_handler!` 注册
3. `src/lib/tauri-api.js` 的 `api` 对象添加前端方法
4. 如果 Web 模式也支持,在 `scripts/dev-api.js` 添加对应 handler

## 发布流程

社区版走 GitHub Release,无官网 CDN、无后台自动轮询更新;仅提供用户手动触发的 GitHub Releases 版本检查按钮。

```bash
# 1. 改版本号
npm run version:set X.Y.Z-ce.N

# 2. 改 CHANGELOG,commit + push
git commit -am "chore(release): vX.Y.Z-ce.N"
git push

# 3. 本地打包
npm run tauri build
# 产物:src-tauri/target/release/bundle/dmg/

# 4. 打 tag + 发 Release
git tag vX.Y.Z-ce.N && git push --tags
gh release create vX.Y.Z-ce.N \
  src-tauri/target/release/bundle/dmg/*.dmg \
  --title "vX.Y.Z-ce.N"
```

## 上游同步

与 [qingchencloud/clawpanel](https://github.com/qingchencloud/clawpanel) 保持 cherry-pick 式同步(不做 git merge)。详见 `UPSTREAM.md`。
