# 第三大脑 · 本地试用包

这是一个 **Local-first Alpha**：每位安装者在自己的电脑运行服务，使用自己的 WPS 企业应用、用户 OAuth 和 DeepSeek API Key。维护者不会收到安装者的 Token、消息或分析结果。

当前版本用于尽快验证一个问题：它能不能从你亲自选择的少量 WPS 群聊里，找出值得关注的工作信号，并用可读的中文说明为什么。

## 能做什么

- 在本机完成 WPS 用户 OAuth；
- 使用当前用户身份读取其有权访问的会话，不要求把机器人加入群聊；
- 选择 1–10 个群聊，导入最近 1–30 天的文本消息；
- 只有在用户显式点击“分析”后，才把所选消息发送给该用户自己的 DeepSeek V4 Pro API；
- 将 WPS Token、消息和分析结果加密保存在当前电脑；
- 展示业务化候选，供用户判断“重要、相关但非重点、噪声、不确定”。

当前版本不会发送 WPS 消息、不会自动扩展监控来源、不会上传到维护者服务器，也不是生产部署。

当前仓库用于金山内部同事试用，暂未声明通用开源许可证；公开可见不等于已经授权任意复制、修改或商业分发。

## 五分钟开始

需要：Node.js 20+、一个 WPS 企业自建应用、一个 DeepSeek API Key。

```bash
npm install
npm run setup
```

编辑新生成的 `.env.local`，填写你自己的值。然后：

```bash
npm run preflight
npm start
```

打开 `http://127.0.0.1:4310`，按页面顺序：

1. 授权当前 WPS 账号；
2. 读取会话清单；
3. 选择 1–3 个熟悉的群和最近 7 天；
4. 导入消息；
5. 明确点击分析，再判断结果是否有用。

## WPS 应用配置

在 WPS 开放平台创建企业自建应用：

- 用户授权回调：`http://127.0.0.1:4310/oauth/wps/callback`
- 用户权限：`kso.user_base.read`
- 用户消息 MCP：`delegated:kso.mcp_message.readwrite`

权限必须先在开发者后台申请并随版本审批发布，然后每位安装者使用自己的账号重新 OAuth。不要复制浏览器 `WPS_SID`。

详见 [WPS 权限与授权](docs/WPS-PERMISSIONS.md)。

## 隐私边界

- `.env.local`、`.runtime/`、日志和本地数据均被 Git 忽略；
- 本地凭证、消息与分析结果使用 AES-256-GCM 加密后落盘，文件权限限制为当前用户；
- 本地加密主要防止误上传和明文泄漏，不能抵御已经控制该电脑账户的恶意程序；
- 点击“分析”意味着所选消息会发送至安装者配置的 DeepSeek 官方 API；不点击则不会调用模型；
- 每人必须使用自己的 WPS OAuth 和 DeepSeek Key。严禁共用维护者或其他同事的办公凭证。

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
```

第一条检查当前文件，第二条检查已删除文件仍可能残留的完整 Git 历史。Git 历史检查强制要求传入同一份私人 denylist。

## 已验证与未验证

已在无私人配置的干净目录验证：安装、单元测试、发布扫描、配置预检和静态 Demo。

由于发布环境没有安装者的 WPS 应用、OAuth 和 DeepSeek Key，以下必须由每位试用者首次运行时验证：WPS 权限审批、真实 OAuth、会话读取、消息分页、DeepSeek 请求与结果质量。未验证能力不会写成已完成。

进一步阅读：[安装](docs/INSTALL.md) · [架构](docs/ARCHITECTURE.md) · [模型配置](docs/MODEL-CONFIG.md) · [首版限制](docs/PREVIEW-LIMITS.md)
