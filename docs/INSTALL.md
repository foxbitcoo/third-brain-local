# 安装引导

## 1. 本机准备

- Node.js 20 或更高；
- WPS 企业自建应用；
- DeepSeek API Key。

```bash
npm install
npm start
```

首次启动会在终端显示 `http://127.0.0.1:4310`。用浏览器打开该地址后进入网页设置导览，依次说明 WPS 应用、权限、回调地址和 DeepSeek Key 的获取位置。三个需要保密的值会通过本地页面写入权限为 600 的 `.env.local`；页面不会再把密钥读出来。

保存后，在终端按 Control + C 停止服务，再次运行 `npm start` 进入 WPS 授权与群聊选择页面。

如果希望手动配置，也可以运行 `npm run setup`。该命令只在本机创建权限为 600 的 `.env.local`，不会覆盖已有配置。

## 2. 填写自己的配置

```text
WPS_APP_ID=
WPS_APP_KEY=
WPS_REDIRECT_URI=http://127.0.0.1:4310/oauth/wps/callback
WPS_SCOPES=kso.user_base.read delegated:kso.mcp_message.readwrite
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-pro
LOCAL_PORT=4310
```

不要提交、截图或发送 `.env.local`。本项目不支持浏览器 `WPS_SID`。

## 3. WPS 后台

在应用安全配置中把用户授权回调地址设置为：

```text
http://127.0.0.1:4310/oauth/wps/callback
```

申请并发布两个用户侧权限，随后当前用户重新授权。详见 [WPS 权限](WPS-PERMISSIONS.md)。

## 4. 预检与启动

```bash
npm run preflight
npm start
```

预检只检查字段和范围，不会联网证明审批、OAuth 或模型连接已经成功。启动后打开 `http://127.0.0.1:4310` 完成真实验证。

如果只想先看无数据页面：

```bash
npm run demo
```
