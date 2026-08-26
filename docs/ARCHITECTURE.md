# 本地试用架构

公开版不是个人数据镜像。它只同步经过公开边界复核的通用实现，安装后完全依赖安装者自己的 OAuth、模型配置和本地加密存储。

```text
安装者选择私聊／群聊
  → 完整分页导入
  → Evidence（稳定 ID、revision、fingerprint、provenance）
  → B 单条抽取 + C 连续上下文抽取
  → 先按 Evidence 血缘去重，再形成 EventCandidate
  → 用户确认工作归属
  → 用户确认业务重要性
  → 单次本地加密写入 Decision + WorkEvent + WorkThread + Current State
  → 工作台回读
```

## 数据边界

- 服务只监听 `127.0.0.1`；
- App Key 与模型 Key 只从 `.env.local` 读取；
- OAuth Token、消息、Evidence、候选和状态只以 AES-256-GCM 密文写入 `.runtime/user-data`；
- 加密记录使用同目录临时文件后原子 rename，避免一次写入只留下半份状态；
- 消息只在用户选择来源并点击导入后读取，只在用户点击分析后发送给其模型 API；
- 显示名是 observed value，不是稳定身份映射。缺少稳定用户标识时必须保持 unresolved；
- 维护者没有远程数据后端，也无法读取安装者的本机记录。

## 候选和状态不是一回事

模型只能提出候选，不能直接修改 Current State。公开版把工作归属与重要性拆成两个显式阶段；“收到”“OK”或模型高置信度都不能替代安装者确认。

本次候选只实现新判断的 staged + atomic ripple。对既有正式判断的纠错、撤销、恢复仍未作为公开承诺发布，应视为后续范围，不能在 UI 或文档中冒充已经接通。

## Report to Issue

Report 路径只到本机：本地草稿、扫描、完整预览和确认回执都使用本地加密存储。没有 GitHub submit route，也没有外部副作用。没有安装者私人 denylist 时只能 `manual_review_required`；附件固定为空，等待宿主侧 bytes 扫描能力。真实 GitHub 写入为 NOT_RUN。

## 尚非生产架构

当前没有后台持续调度、自动扩大来源、集中式租户服务、完整长期记忆、机器人发送或生产级恢复流程。若改成集中式服务，必须重新验证租户、身份、凭证、ACL 和删除边界。
