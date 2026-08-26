# 安装引导

## 1. 本机准备

- Node.js 20 或更高；
- 安装者自己的 WPS 企业自建应用；
- 安装者自己的 OpenAI-compatible 模型 API；
- 可选：只存于本机的 Report 私人 denylist，一行一个禁止公开的字面量。

```bash
npm install
npm start
```

首次启动会显示 `http://127.0.0.1:4310`。网页导览会说明 WPS 应用、权限、OAuth 回调和模型配置。配置保存到权限为 600 的 `.env.local`，页面不会回显密钥。保存后停止并重新运行 `npm start`。

## 2. 本地配置

```text
WPS_APP_ID=
WPS_APP_KEY=
WPS_REDIRECT_URI=http://127.0.0.1:4310/oauth/wps/callback
WPS_SCOPES=kso.user_base.read kso.mcp_message.readwrite
LLM_PROVIDER=
LLM_BASE_URL=
LLM_MODEL=
LLM_API_KEY=
REPORT_PRIVATE_DENYLIST_FILE=
LOCAL_PORT=4310
```

不要提交、截图或发送 `.env.local`、denylist 或 `.runtime/`。项目不支持浏览器 `WPS_SID`。

`REPORT_PRIVATE_DENYLIST_FILE` 为空时，Report 草稿仍可生成并完整预览，但状态只能是 `manual_review_required`，不能生成确认回执。该文件只在启动时读取，不会打印或复制到仓库。

## 3. WPS 后台

回调地址：

```text
http://127.0.0.1:4310/oauth/wps/callback
```

分别搜索 `kso.user_base.read` 与 `kso.mcp_message.readwrite`，两项都选择 `user`。不要选择 `app`，不要输入 `delegated:`。权限审批并发布后，当前安装者重新 OAuth。

## 4. 预检和真实验证

```bash
npm run preflight
npm start
```

预检只验证字段与范围，不证明审批、OAuth、消息、模型或业务价值已真实通过。启动后由安装者选择少量私聊／群聊，完成导入、B/C 分析、工作归属与重要性判断，再检查首页 Current State。

只查看无数据空状态可运行 `npm run demo`。
