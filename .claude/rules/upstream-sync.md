---
description: 上游同步注意事项，标记哪些文件来自上游
paths: ["src/pages/channels.js", "src/pages/gateway.js", "src/pages/services.js", "src/pages/skills.js", "src/pages/dashboard.js", "src/pages/chat.js", "src/pages/config.js", "src/pages/agents.js", "src/pages/memory.js", "src/pages/security.js", "src/pages/setup.js", "src/pages/about.js", "src/pages/logs.js", "src/pages/cron.js", "src/pages/models.js"]
---

# 上游同步文件

这些文件可能需要与上游 [qingchencloud/clawpanel](https://github.com/qingchencloud/clawpanel) 保持同步。

## 修改注意

- 修改前先检查 `UPSTREAM.md` 确认上游是否有更新
- 我们的改动尽量保持向前兼容，方便后续 cherry-pick 上游变更
- 如果必须大改，在 `UPSTREAM.md` 的「分叉差异概要」中记录

## 我们独有的文件（无需考虑上游）

- `src/pages/invest-*.js` — 投资域全部页面
- `src/lib/product-profile.js` — 产品 Profile 系统
- `src/lib/openclaw-feature-gates.js` — 版本特性门控
