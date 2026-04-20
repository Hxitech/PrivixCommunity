# Changelog

遵循 [Keep a Changelog](https://keepachangelog.com/) 风格 + [SemVer](https://semver.org/) 版本号。

`-ce.N` 后缀表示 Community Edition 的迭代号。

## [2.0.0-ce.2] - 2026-04-20

### Cleanup (audit D)
- Remove residual invest_workbench / evoscientist / doc_sop / local_qa_kb dead code across 30+ files
- Simplify quick-setup wizard from 4 steps to 2 steps (OpenClaw status + completion)
- Remove /api license backend (commercial authorization server)
- Fix deploy.sh URLs pointing to legacy repo

## [2.0.0-ce.1] — 2026-04-19

Privix Community 首个独立开源发行版。从 Privix 内部版本 v1.6.0-fix1 拉出,以 Apache-2.0 开源,与商业版彻底切断。

### 加入(相对于上游 ClawPanel v0.13.3 基线)

- **Hermes Agent 引擎集成**:双引擎架构,8 页面 + 25 个 Rust 命令,SSE 流式对话 + Python 集成
- **Claw Doctor(钳子医生)**:独立 AI 助手,支持 15+ 模型服务商、80+ 模型预设、多模态图文对话、工具调用、Agent 灵魂移植
- **多实例管理**:一个客户端管理多个 OpenClaw 实例
- **Apple Design 设计系统**:SF Pro 字体 + 980px 胶囊 CTA + navigation glass
- **消息渠道丰富**:Telegram / Discord / 飞书 / 钉钉 / QQ / 企业微信 / 微信 / Slack
- **版本特性门控**:按 OpenClaw 版本动态显隐功能

### 移除(相对于 Privix 商业版 v1.6.0-fix1)

- 激活码 / 授权系统(license-gate、Rust `license.rs`、product profile `licensePolicy`)
- Invest 工作台(20+ 页面:pool、pipeline、companies、contacts、deal、scoring、audit、automation、invest-dashboard、invest-docs 等)
- Knowledge Wiki 模块(Karpathy 式知识库:kb-wiki-ingest/prompts/query、`kb_wiki.rs`)
- SOP 引擎(DAG 依赖、执行监督、模式归纳)
- ProspectResearch / EvoScientist 科研智能体(`evoscientist.rs` + Python bridge)
- ClawSwarm 多 Agent 蜂群编排(7 libs + `swarm_chat_complete` 命令)
- Star Office / 像素宠物工作台游戏化
- 自动更新检查(`check_frontend_update` 等 4 个命令、检查器循环)
- 官网 portal、`release-to-portal.sh`、Vercel CDN 分发、`privix.cn` phone-home
- Extension 命令(cftunnel / ClawApp)

### 许可证

- **本项目整体**:Apache License 2.0
- **上游 ClawPanel 衍生代码**:保留 MIT 原许可
- 详见 [LICENSE](./LICENSE) 与 [NOTICE](./NOTICE)
