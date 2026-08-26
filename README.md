# 第三大脑 · 公开版

这是可独立安装的 **Local-first Alpha 产品版**。每位安装者在自己的电脑运行服务，使用自己的 WPS 企业应用、用户 OAuth 和 OpenAI-compatible 模型配置；维护者不会收到安装者的凭证、消息或分析结果。

项目同时维护个人版与公开版。新能力先在个人版验证，再按明确 allowlist 进入公开候选分支，经过当前文件扫描、完整 Git 历史扫描、私人 denylist、干净安装和人工复核后才能发布：**个人版验证 → 公开候选 → 隐私扫描 → 用户确认 → 公开版**。

## 当前可运行链路

- 安装者显式选择自己有权访问的 1–10 个私聊或群聊，导入最近 1–30 天的文本消息；
- 每条消息先形成带稳定本机 Evidence ID、修订、指纹和来源范围的 Evidence；显示名只作为观察值，不能被当作已验证身份；
- B 路径处理信息充分的单条消息，C 路径补足同一来源的连续上下文；两路结果先按 Evidence 血缘去重，再形成候选；
- 候选在工作台按“未决优先、同状态内最新证据优先”排序，并分层展示标题、最新变化、背景、AI 无法确定的点、需要用户判断的内容和最少必要原文；
- 用户必须先确认工作归属，再确认业务重要性；只有确认“当前重要”后，系统才在一次本地加密写入中记录 Decision、WorkEvent、WorkThread 和 Current State；
- 工作台首页回读经用户确认的当前状态变化，不把模型候选直接升级成正式记忆。

公开版不打包任何人物、项目、群聊、组织关系或业务候选 fixture。没有安装者自己的数据时，页面保持空状态。

当前版本不会发送 WPS 消息、不会自动扩大监控来源、不会上传办公数据到维护者服务器，也不是生产部署。真实 WPS OAuth、真实模型结果和用户点击后的业务正向涟漪仍需每位安装者验证；发布者状态为 **NOT_RUN_PENDING_USER**。

## Report to Issue 边界

当前只提供本地安全链路：**本地草稿 → 自由文本隐私扫描 → 完整预览 → 本地确认回执**。

- 默认附件必须为空；在宿主能够读取原始 bytes 并生成可信扫描回执前，不接受调用方自报的附件扫描结果；
- 未配置安装者自己的私人 denylist 时，草稿状态只能是 `manual_review_required`，不能显示通过，也不能生成确认回执；
- 回执不可变绑定目标仓库、标题、正文、附件集合、隐私摘要、预览摘要和安装者填写的 GitHub 登录名；任一内容或身份变化都要求重新生成草稿并完整预览；
- 安全、凭证、内部链接、稳定办公 ID、本地路径或数据库信息一律拒绝；
- 当前没有 GitHub 提交接口，不会自动创建 Issue。真实 GitHub 写入状态为 **NOT_RUN**。

这不是完整的 Report to Issue 外部闭环；它是发布前可独立验收的 local-only candidate。

## 五分钟开始

需要 Node.js 20+、一个 WPS 企业自建应用，以及安装者自己的 OpenAI-compatible 模型配置。

```bash
npm install
npm start
```

首次启动会显示本地设置地址。浏览器打开 `http://127.0.0.1:4310` 后，按导览填写 WPS App ID / App Key、两项 user 权限、OAuth 回调、模型 API 地址、模型名称和 API Key。保存后停止并重新运行 `npm start`。

也可以运行 `npm run setup` 手动生成仅存本机的 `.env.local`，再运行 `npm run preflight`。

完成配置后：

1. 授权当前 WPS 账号；
2. 读取会话清单；
3. 选择少量熟悉的私聊或群聊和时间范围；
4. 完整导入消息；
5. 明确点击 B/C 分析；
6. 先确认工作归属，再确认重要性；
7. 回到首页检查 Current State 是否发生符合预期的变化。

## WPS 应用配置

- 用户授权回调：`http://127.0.0.1:4310/oauth/wps/callback`
- 用户基础信息：`kso.user_base.read`，权限类型选择 `user`
- 用户消息 MCP：`kso.mcp_message.readwrite`，权限类型选择 `user`

不要搜索或填写 `delegated:`，不要选择同名 `app` 权限，也不要复制浏览器 `WPS_SID`。权限发布后，每位安装者都需要用自己的账号重新 OAuth。详见 [WPS 权限与授权](docs/WPS-PERMISSIONS.md)。

## 隐私与存储

- `.env.local`、`.runtime/`、日志和本地数据均被 Git 忽略；
- Token、消息、Evidence、候选、Decision 和 Current State 使用 AES-256-GCM 加密后原子落盘，文件权限限制为当前用户；
- 本地加密主要防止误上传和磁盘明文泄漏，不能抵御已经控制本机账户的恶意程序；
- 点击分析意味着所选最少必要内容会发送给安装者配置的模型 API；不点击则不会调用模型；
- 每人必须使用自己的 WPS OAuth、模型 Key 和私人 denylist。

当前仓库使用 [GNU Affero General Public License v3.0](LICENSE)。许可证覆盖本仓库代码，不授权也不要求公开安装者的办公数据、凭证或本地记忆。详见 [隐私说明](docs/PRIVACY.md)。

## 发布门禁

```bash
npm test
npm run check
npm run verify
```

真正发布前必须使用只存在私人环境的 denylist：

```bash
node scripts/check-release.mjs --denylist /absolute/private/denylist.txt
node scripts/check-public-git.mjs --denylist /absolute/private/denylist.txt
npm run release:gate -- --denylist /absolute/private/denylist.txt
```

门禁检查当前文件、已删除文件仍可能残留的完整 Git 历史、二进制／大文件、凭证、内部链接、数据文件、软链接和干净安装。发布候选还会生成仓库外的不可变 publication receipt，绑定仓库、分支、base/candidate SHA、文件 manifest、diff、扫描摘要和 PR／Release URL。

进一步阅读：[安装](docs/INSTALL.md) · [架构](docs/ARCHITECTURE.md) · [模型配置](docs/MODEL-CONFIG.md) · [首版限制](docs/PREVIEW-LIMITS.md) · [隐私说明](docs/PRIVACY.md)
