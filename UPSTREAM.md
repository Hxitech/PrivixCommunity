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
- ProspectResearch / EvoScientist
- ClawSwarm 多 Agent 编排
- Star Office / 像素宠物
- 自动更新检查、privix.cn CDN、portal 分发基础设施

保留的能力:
- OpenClaw 核心面板(上游 ClawPanel 衍生):dashboard / chat / models / agents / channels / gateway / memory / MCP / skills 等
- Hermes Agent 引擎(社区版双引擎)
- Claw Doctor(钳子医生)独立 AI 助手
- Apple 设计系统、i18n(11 locales)、多实例管理

## 同步策略

1. **不做 git merge**:与上游结构差异大,直接 merge 会产生大量冲突
2. **Cherry-pick 式同步**:对比上游变更,手动将有价值的改进移植到社区版
3. **关注核心页面**:channels.js、gateway.js、services.js、skills.js、chat.js 是主要同步点
4. **定期检查**:每个上游 release 发布后评估是否需要同步
5. **安全修复优先**:上游的安全修复(CVE、XSS、注入漏洞)直接跟进

## 待评估同步项

跟踪 upstream clawpanel main 分支的变更,评估是否对社区版有价值:
- SkillHub 安全校验(SHA-256 + VirusTotal)
- 渠道插件版本智能适配
- 工作区文件面板(Chat 页实时文件浏览)
- service.rs 自动修复(config mismatch + 进程超时保护)
- Hermes 页面内容补全(services.js / config.js / channels.js)
