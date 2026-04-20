---
name: upstream-check
description: 检查上游 clawpanel 仓库是否有新的可同步变更
when-to-use: 当用户问上游是否有更新、需要同步、或准备同步时
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - WebFetch
---

# 上游同步检查

检查上游 [qingchencloud/clawpanel](https://github.com/qingchencloud/clawpanel) 是否有新变更。

## 步骤

1. 读取 `UPSTREAM.md` 了解当前同步状态和最后同步日期
2. 使用 `gh api repos/qingchencloud/clawpanel/commits?per_page=20` 获取上游最近提交
3. 对比最后同步日期，列出新增的提交
4. 重点关注以下核心文件的变更：
   - `src/pages/channels.js` — 渠道管理
   - `src/pages/gateway.js` — 网关配置
   - `src/pages/services.js` — 服务管理
   - `src/pages/skills.js` — 技能管理
5. 总结哪些变更值得同步，哪些可以跳过
6. 如果有需要同步的内容，建议更新 `UPSTREAM.md`
