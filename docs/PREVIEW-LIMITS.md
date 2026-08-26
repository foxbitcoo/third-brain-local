# 本地 Alpha 限制

## 已包含

- 本地安装、设置导览、配置预检与 loopback 服务；
- WPS 用户 OAuth、会话列表与用户主动选择的私聊／群聊文本读取；
- 最近 1–30 天、最多 10 个来源的手动导入；
- 分页完整性门禁；达到安全上限时明确截断并禁止分析；
- AES-256-GCM 本地加密与原子记录替换；
- Evidence 层与 B 单条／C 连续上下文双路径抽取；
- B/C 结果按 Evidence 血缘去重；
- 未决优先、时间倒序的业务化候选卡；
- 工作归属后再判断重要性的 staged decision；
- 用户确认当前重要后，单次写入 WorkEvent、WorkThread 与 Current State；
- 历史回顾仅显示安装者本机已确认并写入 WorkEvent／WorkThread／Current State 的变化；无确认记录时显示空态，不内置业务样例；
- Report 本地草稿、扫描、完整预览和本地确认回执；
- 当前文件、完整 Git 历史、二进制／大小、私人 denylist 与干净安装门禁。

公开版不包含人物、项目、群聊、组织关系或业务候选 fixture。

## 发布者尚未真实验证

- 其他企业的 WPS 应用审批、OAuth 和私聊／群聊完整分页；
- Token 过期自动刷新；
- 不同 OpenAI-compatible 模型的真实兼容性、费用、限流和结果质量；
- 用户完成 staged decision 后对真实业务看板是否产生正向价值：`NOT_RUN_PENDING_USER`；
- GitHub Issue 外部写入：`NOT_RUN`；当前没有 GitHub submit route。

## 暂不承诺

- 图片 OCR、文件、转发、会议、文档、日历和组织架构采集；
- 自动发现来源、后台定时任务、WPS 机器人发送或工作台内嵌；
- 公网多用户服务和集中式凭证托管；
- 完整长期记忆；
- 对正式判断的纠错、撤销与恢复闭环；
- Report 附件、自动 GitHub 提交、Issue 历史同步。

代码存在不等于真实 provider、host 或用户验收通过。
