# 安全政策

## 支持的版本

社区版尚处于早期阶段,当前主线 `2.x-ce` 接收安全更新。老版本不再维护。

| 版本 | 支持状态 |
|------|----------|
| 2.x-ce | ✅ 安全更新 |
| < 2.0 | ❌ 不再维护 |

## 报告安全漏洞

如果你发现了安全漏洞,**请不要**通过 public issue 提交。请使用 [GitHub Security Advisories](https://github.com/privix-community/privix/security/advisories/new) 私下报告。

### 报告内容应包含

- 漏洞的详细描述
- 复现步骤
- 受影响的版本
- 可能的影响范围
- 如果有的话,建议的修复方案

### 响应时间

- **确认收到**:尽量 48 小时内(社区项目,维护者可能在时区外)
- **初步评估**:7 个工作日内
- **修复发布**:根据严重程度,通常 30 天内

## 安全最佳实践

使用 Privix Community 时建议注意:

- **访问密码**:Web 部署模式建议设置访问密码(`/security` 页面),避免默认开放
- **Gateway Token**:如果开启局域网共享,务必设置访问密钥
- **网络访问**:默认仅监听本机(loopback),如无必要不要开启局域网模式
- **API Key**:模型服务商的 API Key 存储在本地 `~/.openclaw/openclaw.json`,请确保文件权限安全
- **上游安全修复**:本项目基于上游 [qingchencloud/clawpanel](https://github.com/qingchencloud/clawpanel) cherry-pick 式同步。上游的安全修复会优先跟进。
