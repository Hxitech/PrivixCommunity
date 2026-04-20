---
name: add-page
description: 按标准流程新增一个前端页面
when-to-use: 当用户要求新增页面、添加新功能页面时
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
argument-hint: "<page-name>"
---

# 新增页面

按以下步骤创建新页面：

## 步骤

1. **创建页面文件** `src/pages/<page-name>.js`
   - 导出 `render()` 函数，立即返回 DOM 元素
   - 数据加载走后台异步，不在 render() 中 await
   - 可选导出 `cleanup()` 函数

2. **注册路由** — 编辑 `src/main.js`
   - 添加 `registerRoute('/<page-name>', () => import('./pages/<page-name>.js'))`
   - 参考已有路由注册的位置和格式

3. **添加导航** — 编辑 `src/components/sidebar.js`
   - 在 `NAV_ITEMS_FULL` 数组中添加导航项
   - 在 `ICONS` 对象中添加对应 SVG 图标

4. **添加样式**（如需要）
   - 在 `src/style/` 下创建或编辑对应 CSS 文件
   - 使用 CSS Variables（参考 `src/style/variables.css`）

5. **检查产品 Profile**
   - 确认新页面是否所有 Profile 都需要，还是仅特定 Profile
   - 如仅特定 Profile，在 `src/lib/product-profile.js` 中配置可见性
