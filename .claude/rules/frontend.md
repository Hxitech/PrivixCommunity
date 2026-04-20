---
description: 前端页面和组件的开发规范
paths: ["src/**"]
---

# 前端开发规范

## 页面模块 (`src/pages/`)

- 每个页面导出 `render()` 函数，必须立即返回 DOM 元素
- 禁止在 `render()` 中 `await` 数据加载，数据走后台异步：
  ```javascript
  export async function render() {
    const page = document.createElement('div')
    page.className = 'page'
    page.innerHTML = `<!-- 骨架 + 加载占位 -->`
    loadData(page)  // 不 await
    return page
  }
  ```
- 可选导出 `cleanup()` 函数用于页面卸载时清理（定时器、事件监听等）

## API 调用

- 统一通过 `import { api } from '../lib/tauri-api.js'`
- 不要在页面中直接 `fetch`，tauri-api.js 会自动处理 Tauri/Web 双模式
- 读操作有缓存，写操作自动清缓存

## 技术栈

- Vanilla JS，不引入 React/Vue/任何 UI 框架
- CSS Variables 驱动主题（`src/style/variables.css`）
- CSS 类名用 kebab-case，JS 变量/函数用 camelCase
- 所有代码注释使用中文
- 静态资源本地化，禁止引用远程 CDN

## 双模式适配

```javascript
const isTauri = !!window.__TAURI_INTERNALS__
```

需要区分行为时使用此标志，但大部分情况通过 tauri-api.js 自动处理。
