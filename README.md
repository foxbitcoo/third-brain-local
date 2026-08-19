# 第三大脑 · 公开版

这是可独立安装的 **Local-first Alpha 产品版**：每位安装者在自己的电脑运行服务，使用自己的 WPS 企业应用、用户 OAuth 和自选模型 API。维护者不会收到安装者的 Token、消息或分析结果。

项目同时维护“个人版”与“公开版”：新能力先在维护者的个人版验证，只有可公开的通用代码和产品承诺才会进入候选分支。发布流程是：**个人版验证 → 公开候选分支 → 隐私扫描与人工复核 → 用户确认 → 公开版**。维护者的私有飞书真相、WPS 授权和本地数据不会同步进来。

当前可运行切片用于尽快验证一个问题：它能不能从你亲自选择的少量 WPS 群聊里，找出值得关注的工作信号，并用可读的中文说明为什么。这是公开版的当前 Alpha 能力边界，不是把公开版定义成只能演示的 Demo。

## 能做什么

- 在本机完成 WPS 用户 OAuth；
- 使用当前用户身份读取其有权访问的会话，不要求把机器人加入群聊；
- 选择 1–10 个群聊，导入最近 1–30 天的文本消息；
- 只有在用户显式点击“分析”后，才把所选消息发送给该用户配置的 OpenAI-compatible 模型 API；
- 将 WPS Token、消息和分析结果加密保存在当前电脑；
- 展示业务化候选，供用户判断“重要、相关但非重点、噪声、不确定”。

当前版本不会发送 WPS 消息、不会自动扩展监控来源、不会上传到维护者服务器，也不是生产部署。

当前仓库使用 [GNU Affero General Public License v3.0](LICENSE)。开源许可只适用于本仓库代码，不授权或要求公开任何安装者的 WPS 数据、模型 Key 或本地记忆。

## 问题反馈边界

公开版将提供 **Report to Issue**：安装者可以让自己的 Agent 在本机生成问题草稿，先完成隐私扫描和脱敏，再完整预览正文、截图与附件；只有安装者明确确认后，才使用安装者自己的 GitHub 身份提交到本仓库的公开 Issue 池。

安全问题、公司内部信息、办公原文、人员与群聊信息、凭证、数据库和本地运行产物不得提交公开 Issue。当前 Alpha **尚未实现自动提交 GitHub Issue**；在正式闭环上线前，请先人工检查并手动提交，不要把产品承诺误解为已经接通的外部写入能力。

## 五分钟开始

需要：Node.js 20+、一个 WPS 企业自建应用，以及一套 OpenAI-compatible 模型 API 配置。

```bash
npm install
npm start
```

首次启动会在终端显示本地地址。用浏览器打开 `http://127.0.0.1:4310` 后进入设置导览；页面会逐步告诉你：

1. 去哪里创建 WPS 企业自建应用并取得 App ID / App Key；
2. 需要申请哪两项 WPS 权限；
3. 在哪里填写本地 OAuth 回调地址；
4. 如何填写模型服务商、API 地址、模型名称／Endpoint ID 和自己的 API Key；
5. 哪些值只保存在当前电脑，不能发给别人。

按导览保存后，停止并重新运行：

```bash
npm start
```

也可以继续使用 `npm run setup` 手动创建 `.env.local`，再运行 `npm run preflight` 检查。

打开 `http://127.0.0.1:4310`，完成配置后按页面顺序：

1. 授权当前 WPS 账号；
2. 读取会话清单；
3. 选择 1–3 个熟悉的群和最近 7 天；
4. 导入消息；
5. 明确点击分析，再判断结果是否有用。

## WPS 应用配置

在 WPS 开放平台创建企业自建应用：

- 用户授权回调：`http://127.0.0.1:4310/oauth/wps/callback`
- 用户基础信息：搜索 `kso.user_base.read`，选择权限类型 `user`
- 用户消息 MCP：搜索 `kso.mcp_message.readwrite`，选择权限类型 `user`

不要在开放平台搜索框输入 `delegated:`，也不要选择同名的 `app` 权限。权限必须先在开发者后台申请并随版本审批发布，然后每位安装者使用自己的账号重新 OAuth。不要复制浏览器 `WPS_SID`。

详见 [WPS 权限与授权](docs/WPS-PERMISSIONS.md)。

## 隐私边界

- `.env.local`、`.runtime/`、日志和本地数据均被 Git 忽略；
- 本地凭证、消息与分析结果使用 AES-256-GCM 加密后落盘，文件权限限制为当前用户；
- 本地加密主要防止误上传和明文泄漏，不能抵御已经控制该电脑账户的恶意程序；
- 点击“分析”意味着所选消息会发送至安装者配置的模型 API；不点击则不会调用模型；
- 每人必须使用自己的 WPS OAuth 和模型 Key。严禁共用维护者或其他同事的办公凭证。

详见 [隐私说明](docs/PRIVACY.md)。

## 发布检查

```bash
npm test
npm run check
npm run verify
```

检查覆盖：凭证字面量、私人绝对路径、私人飞书/WPS 文档链接、数据文件、环境文件、软链接和独立安装。维护者还可传入只存在私人环境的 denylist：

```bash
node scripts/check-release.mjs --denylist /absolute/private/denylist.txt
node scripts/check-public-git.mjs --denylist /absolute/private/denylist.txt
npm run release:gate -- --denylist /absolute/private/denylist.txt
```

第一条检查当前文件，第二条检查已删除文件仍可能残留的完整 Git 历史。真正发布前必须运行第三条发布总门；它强制使用同一份私人 denylist，并串行执行当前文件、完整 Git 历史和干净安装验证。缺少 denylist 时发布总门会直接失败。

## 已验证与未验证

已在无私人配置的干净目录验证：安装、单元测试、发布扫描、配置预检和静态 Demo。

由于发布环境没有安装者的 WPS 应用、OAuth 和模型 Key，以下必须由每位试用者首次运行时验证：WPS 权限审批、真实 OAuth、会话读取、消息分页、所选模型请求与结果质量。未验证能力不会写成已完成。

进一步阅读：[安装](docs/INSTALL.md) · [架构](docs/ARCHITECTURE.md) · [模型配置](docs/MODEL-CONFIG.md) · [首版限制](docs/PREVIEW-LIMITS.md) · [隐私说明](docs/PRIVACY.md)
