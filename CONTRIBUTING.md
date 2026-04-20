# 贡献指南

感谢你对 Privix Community 的关注。本文档说明开发环境、约定与发版流程。

> 📦 仓库: [github.com/privix-community/privix](https://github.com/privix-community/privix)
> 🪪 许可证: Apache-2.0(上游 ClawPanel 衍生部分保留 MIT,详见 [LICENSE](./LICENSE) / [NOTICE](./NOTICE))

---

## 开发环境

| 依赖 | 最低版本 | 说明 |
|------|----------|------|
| Node.js | 18+ | 前端构建(推荐 22 LTS) |
| Rust | stable | Tauri 后端编译 |
| Tauri CLI | v2 | `cargo install tauri-cli --version "^2"` |

### 快速开始

```bash
git clone https://github.com/privix-community/privix.git
cd privix
npm install

# 桌面开发(完整 Tauri)
npm run tauri dev

# Web 开发(仅浏览器 + Node dev-api)
npm run dev
```

> Windows 开发需要 Visual Studio Build Tools(勾选「使用 C++ 的桌面开发」)和 WebView2(Win10+ 通常已预装)。

---

## 运行模式

前端代码通过 `isTauri` 标志自动适配:

| 模式 | 启动 | 后端 | API 通信 |
|------|------|------|----------|
| Tauri 桌面 | `npm run tauri dev` | Rust IPC | `invoke()` |
| Web 浏览器 | `npm run dev` | `scripts/dev-api.js` | `fetch('/__api/cmd')` |

## 版本管理

`package.json` 是**唯一真相源**。

```bash
# 设置新版本并同步到 Cargo.toml / tauri.conf.json
npm run version:set 2.0.1-ce.2

# 仅同步(不改版本号)
npm run version:sync
```

## 发版流程

社区版走 GitHub Release,无官网 CDN。

```bash
# 1. 设置版本
npm run version:set X.Y.Z-ce.N

# 2. 编写 CHANGELOG,commit + push
git commit -am "chore(release): vX.Y.Z-ce.N"
git push

# 3. 打包
npm run tauri build

# 4. 发 Release
git tag vX.Y.Z-ce.N && git push --tags
gh release create vX.Y.Z-ce.N src-tauri/target/release/bundle/dmg/*.dmg \
  --title "vX.Y.Z-ce.N"
```

---

## 前端约定

### 页面模块

```javascript
export async function render() {
  const page = document.createElement('div')
  page.className = 'page'
  page.innerHTML = `<!-- 页面骨架 + 加载占位 -->`
  loadData(page)  // 不 await
  return page
}

export function cleanup() {
  // 可选:清理 listener / 定时器
}
```

**关键原则**:`render()` 必须立即返回 DOM,不要 await 数据加载,否则会阻塞页面切换。

### API 调用

统一通过 `tauri-api.js`,不在页面直接 `fetch`:

```javascript
import { api } from '../lib/tauri-api.js'
const config = await api.readOpenclawConfig()  // 自带缓存
await api.writeOpenclawConfig(config)          // 自动清缓存
```

### 双模式适配

```javascript
const isTauri = !!window.__TAURI_INTERNALS__
```

大多数情况通过 `tauri-api.js` 自动处理,无需显式分支。

---

## Rust 后端约定

### 新增 Tauri 命令

1. 在对应的 `src-tauri/src/commands/xxx.rs` 中添加 `#[tauri::command]` 函数
2. 在 `src-tauri/src/lib.rs` 的 `invoke_handler!` 中注册
3. 在 `src/lib/tauri-api.js` 的 `api` 对象中添加前端包装
4. 如果 Web 模式也支持,在 `scripts/dev-api.js` 添加对应 handler

### 跨平台代码

```rust
#[cfg(target_os = "macos")]    // launchctl / plist
#[cfg(target_os = "linux")]    // systemd / 进程管理
#[cfg(target_os = "windows")]  // openclaw CLI / tasklist
```

### PATH 问题

Tauri 桌面应用启动时 PATH 可能不完整。所有调用外部命令的地方必须用 `super::enhanced_path()` 设环境变量。

---

## 提交规范

采用 [Conventional Commits](https://www.conventionalcommits.org/):

```
<类型>(范围): 简要描述
```

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 Bug |
| `docs` | 文档变更 |
| `style` | 代码格式 |
| `refactor` | 重构 |
| `perf` | 性能优化 |
| `chore` | 构建/工具 |
| `security` | 安全修复 |

## 代码规范

- 前端:Vanilla JS,不引入第三方 UI 框架
- 注释:中文
- 命名:JS 变量/函数 camelCase,CSS 类名 kebab-case
- 静态资源:本地化,禁止引用远程 CDN
- Rust:2021 edition
- i18n:页面文本必须 `t('namespace.key')`,pre-commit 钩子会跑 `i18n:check:strict` 阻挡缺失键

## 上游同步

我们与 [qingchencloud/clawpanel](https://github.com/qingchencloud/clawpanel) 保持 cherry-pick 式同步(不做 git merge)。详见 [UPSTREAM.md](./UPSTREAM.md)。
