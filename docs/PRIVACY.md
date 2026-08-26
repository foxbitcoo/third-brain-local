# 隐私与隔离

## 公开仓库不得包含

- 维护者或测试用户的真实消息、文档、会议、人员关系、项目、群名和裁决；
- App Key、Access Token、Refresh Token、OAuth code、Cookie、WPS_SID、模型 Key 和日志；
- 内部飞书／WPS 链接、截图、附件、本机私人绝对路径、SQLite 或其他数据导出；
- source、user、chat、tenant 等稳定办公 ID；
- 围绕人物、项目或群聊组织的独立示例或叙事型 fixture。

私有仓库中的 API Key、OAuth 凭证和原始办公正文同样不得依赖 private 权限保存。公开测试只使用极简、不带人物／项目／群聊语义的占位值。

## 安装者本地边界

- `.env.local` 保存该安装者自己的 WPS 和模型配置，并被 Git 忽略；
- `.runtime/` 保存随机本地密钥、Token、消息、Evidence、候选、判断和状态，并被 Git 忽略；
- 目录和文件权限限制为当前系统用户；
- 本地密钥和密文位于同一账户下，主要防止误上传与磁盘明文泄漏，不抵御已控制该账户的攻击者；
- 删除 `.env.local` 与 `.runtime/` 可移除本地配置和数据。

## 外部数据流

- OAuth 和消息读取只发往 WPS 官方接口；
- 模型分析只发往安装者明确配置的 HTTPS API 或本机 loopback；
- 没有维护者遥测、分析 SDK 或远程后端；
- 不点击分析，就不会把导入内容发送给模型。

## Report to Issue

公开 Alpha 提供本地草稿、自由文本扫描、完整预览和本地确认回执。它没有 GitHub 外部提交能力，真实提交状态为 NOT_RUN。

- 标题和正文必须通过内建规则与安装者私人 denylist；
- 缺少私人 denylist 时状态只能是 `manual_review_required`，不能生成确认回执；
- 附件固定为空，不能信任调用方自报的 `privacyScanStatus` 或 digest；
- 确认回执绑定目标、预览、隐私摘要和 GitHub 登录名，内容或身份改变会失败关闭；
- 当前没有自动创建 Issue 的 API、按钮或副作用。

## 发布门禁

候选必须经过当前文件扫描、完整 Git 历史（含已删除二进制和大文件）扫描、只存私人环境的 denylist、干净安装、人工复核和用户确认。脚本只输出命中类型与文件，不打印 denylist 内容。通过技术门禁也不等于真实用户验收。
