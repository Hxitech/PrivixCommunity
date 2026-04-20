# Privix 工作流架构

> v1.5.2 (2026-04-17) · 梳理 Privix 内部 4 个工作流/编排系统的职责边界、共享词汇、持久化现状，以及与 `~/Desktop/open-claude-code` 架构模式的对照。

## 两套工作流系统 + 一套审批系统

Privix 当前有 3 套面向不同问题域的 "工作流" 抽象:

| 系统 | 目录 | 核心问题 | 驱动者 |
|------|------|---------|--------|
| **ClawSwarm 蜂群** | `src/lib/clawswarm-*.js` + `src/pages/clawswarm.js` | 多 Agent **并行 DAG** 一次性编排 | LLM 规划器拆解任务 → 分配到多个 Agent 同时跑 |
| **SOP Engine** | `src/lib/sop-engine.js` + `sop-flow.js` + `src/pages/sop{,-invest}.js` | **顺序/DAG + 人审检查点** | 预置或 LLM 归纳出 SOP 模板,逐步推进 |
| **Workflows 审批**(不在本轮审计范围) | `src/pages/workflows.js` | 业务审批多阶段 + SLA(投资场景) | 人工决策 + 事件流 |

### 决策树：什么时候用哪一套？

```
新任务来了
  │
  ├─ 需要多个 Agent 同时跑不同子任务,最后合并结果?
  │   └─→ ClawSwarm(DAG + wave-parallel + orchestrator 决策)
  │
  ├─ 任务步骤有固定顺序/依赖,关键节点需要人审?
  │   └─→ SOP(步骤 status: pending → ready → running → waiting_review → completed)
  │
  └─ 业务流程审批(投资、合同)?
      └─→ Workflows 审批页
```

反过来说:
- 不要用 ClawSwarm 做需要"一步一步确认"的顺序任务 — 它的调度器假设 wave 内可并行,orchestrator 主导决策。
- 不要用 SOP 做"开放式探索" — SOP 预设步骤清单,不擅长动态 branching。

---

## 共享词汇

所有工作流系统对齐到同一套生命周期与配色，便于用户跨系统理解。

### 生命周期枚举

基础集：`pending → running → completed | failed`

扩展（不同系统取不同子集）：

| 状态 | ClawSwarm SwarmAgent | SOP Step | 含义 |
|------|---------------------|----------|------|
| `pending` | ✓ | ✓ | 尚未启动（SOP 下依赖未满足，ClawSwarm 下未排队） |
| `queued` | ✓ | — | ClawSwarm 专有：已排队，等待 wave slot |
| `ready` | — | ✓ | SOP 专有：依赖已满足，可以推进 |
| `running` | ✓ | ✓ | 执行中 |
| `waiting_review` | — | ✓ | SOP 专有：检查点人审 |
| `paused` | ✓ | — | ClawSwarm 专有：被 orchestrator 暂停 |
| `completed` | ✓ | ✓ | 正常完成 |
| `failed` | ✓ | ✓ | 异常终止 |
| `cancelled` | ✓ | — | ClawSwarm 专有：主动取消 |
| `skipped` | — | ✓ | SOP 专有：条件不满足跳过 |

**i18n：** 状态标签通过 `t('labels.swarm_status_*')` / `t('labels.agent_status_*')` / `t('labels.sop_plan_status_*')` / `t('labels.sop_step_status_*')` 获取，走 Proxy 动态读取（见 [src/lib/clawswarm-state.js](../src/lib/clawswarm-state.js) 与 [src/lib/sop-engine.js](../src/lib/sop-engine.js)）。

### 配色系统

三套并存色板，由 [src/lib/dag-styling.js](../src/lib/dag-styling.js) 单一收口：

1. **`VIVID_STATUS_COLORS`** — 饱和色（`#5A72EE` / `#10b981` / `#ef4444` 等），用于 badge / 图例。ClawSwarm 的 `AGENT_STATUS_COLORS` 在此基础上做状态映射。
2. **`PASTEL_STATUS_FILLS`** — 浅彩色（`#dbeafe` / `#d1fae5` 等），用于 Mermaid 节点 fill + 深字。
3. **`DARK_NODE_FILLS` + `DARK_NODE_STROKES`** — 深色节点 + 亮色描边，用于 ClawSwarm SVG 拓扑图。

工具：`withAlpha(hex, alpha='20')` 拼接 `#RRGGBBAA`，`get{Vivid,Pastel,DarkNode}Color(status)` 安全包装。

### 统一类型骨架

[src/lib/task-descriptor.js](../src/lib/task-descriptor.js) 定义 `TaskDescriptor` JSDoc typedef,是跨系统的**共同词汇**(不是运行时抽象)。两个系统的实体(SwarmAgent / TaskStep)都可映射到这个骨架用于日志展示、状态持久化、未来可能的统一 UI 等场景。

---

## 持久化现状

**所有三套系统目前都走 `localStorage`**（前端单机），没有 Rust 后端持久化：

| 文件 | localStorage key | TODO 注释 |
|------|-----------------|----------|
| `clawswarm-state.js` | `clawswarm_tasks`, `clawswarm_config` | 无显式 TODO |
| `sop-engine.js:75` | `sop_engine_plans`, `sop_patterns` | ✓ `// 任务计划暂存在 localStorage,未来后端 ready 后迁移到 API` |

### 未来的 API seam

当需要迁移到 Rust 后端时，建议的命令骨架（尚未实现）：

```rust
// src-tauri/src/commands/workflow_plans.rs
#[tauri::command] async fn workflow_plans_list(kind: String) -> Vec<TaskDescriptor>
#[tauri::command] async fn workflow_plans_get(kind: String, id: String) -> Option<TaskDescriptor>
#[tauri::command] async fn workflow_plans_save(kind: String, plan: TaskDescriptor)
#[tauri::command] async fn workflow_plans_delete(kind: String, id: String)
```

`kind` 取值 `'swarm' | 'sop' | 'evo'`（与 `TaskDescriptor.kind` 对齐）。迁移时前端只需改各 state 模块的 `loadPlans / savePlans` 函数，DataShape 可保留兼容。

---

## License 与模块关系（v1.5.2+）

历史上 Privix 按多个产品身份发布,由 license 下发的 `enabledModules` 控制模块激活。

**v1.2.2** 起统一为单一 Privix 身份 + 运行时模块激活（`src/lib/product-profile.js`）。

**v1.5.2** 起进一步简化：**任一有效激活码即解锁全部 4 个模块**（base + invest + knowledge + sop）。`src/lib/license-gate.js:syncEnabledModules` 不再把 license server 下发的 `enabledModules` 作为 scope，只作"是否激活"判断。

`MODULE_IDS` / `MODULE_ROUTES` 骨架保留用于路由组织，但 `isModuleEnabled` 对业务模块的 gate 等同于 `isLicenseActive`。

---

## open-claude-code 架构对照（未采纳，留作后续参考）

`~/Desktop/open-claude-code` 是 Bun + Ink TypeScript CLI（Claude Code-like），提供了几个启发性的架构模式。本轮**不采纳到 Privix runtime**，但记录在此以便未来演进：

| 概念 | 来源 | 可能的 Privix 对应 |
|------|------|------------------|
| **Polymorphic Task Registry** | `src/tasks/` — 7 种 Task(LocalAgent / RemoteAgent / InProcessTeammate / DreamTask 等),共同 `{name, type, kill()}` 接口 | 未来若统一 ClawSwarm SwarmAgent + SOP TaskStep 到一层,参照此接口 |
| **Coordinator Mode** | `src/coordinator/coordinatorMode.ts` — 编译期 feature flag 切换"普通 Agent → 多 Agent 编排者" | Privix 可用 runtime 配置（非 Bun feature flag）实现类似切换 |
| **Decoupled Teammate Identity** | `src/tasks/InProcessTeammateTask/types.ts` — TeammateIdentity 与运行时 context 解耦 | Agent persona 可进一步拆成 identity + runtime 两层 |
| **Dream Task** | `src/tasks/DreamTask/DreamTask.ts` — 后台内存整合 agent，以 pill UI 非阻塞展示 | Privix 的记忆/索引重建可作为"后台 task pill"呈现 |
| **QueryEngine** | `src/QueryEngine.ts` — 单一入口组合 system prompt + coordinator context + thinking config + cost tracking | Hermes/OpenClaw 引擎可采用类似编排层 |

---

## 已知重复 / 未抽取

### sop.js vs sop-invest.js（v1.5.2 审计结论）

两个文件虽都以 "sop" 命名，实际是**两个不同概念**：

- **`sop.js`**（1499 LOC）— **Doc SOP 生成器**：基于 DOC_SOURCE_SCOPE / DOC_SCENARIO_OPTIONS / DOC_ROLE_OPTIONS 帮用户创作 SOP 文档/模板，核心函数 `createDocSopForm`、`buildDocNotes`、`normalizeDocScenario`。
- **`sop-invest.js`**（1552 LOC）— **Invest 计划执行器**：运行 TaskPlan（来自 sop-engine.js）的 Tab 式 UI，有 `renderPlannerTab`、`renderPlanDetail`、`renderStepTimeline`、category colors、score dims、status labels。

两者唯一共享的是 `escapeHtml`（6 行），而这是**项目级**问题 — 25 个 `src/pages/*.js` / `src/lib/*.js` 文件都内联定义了同名函数。要抽取应当一起抽到 `src/lib/html.js`，而不是只在 sop 两文件之间共享。

**本轮决策：** 不抽取。两文件各自内聚，无清晰接缝。遵循 CLAUDE.md "3 similar lines is better than a premature abstraction"。

**后续触发条件：**
- 若未来 `sop.js` 引入"运行已生成 SOP"功能 → 与 `sop-invest.js` 出现真实共享执行逻辑时再评估
- 若决定统一 escapeHtml 项目级去重 → 一次性抽 25 个文件到 `src/lib/html.js`

审计时间：2026-04-17 / v1.5.2

---

## 引用

- ClawSwarm 架构文档：[clawswarm-architecture-v1.2.0.md](./clawswarm-architecture-v1.2.0.md)
- 投资工作台：[invest-workbench-v1.md](./invest-workbench-v1.md)
- Karpathy LLM Wiki 设计：<https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>（阶段 B Knowledge 模块参考）
- 上游同步追踪：[../UPSTREAM.md](../UPSTREAM.md)
