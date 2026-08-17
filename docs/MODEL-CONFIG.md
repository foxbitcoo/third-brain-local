# 大模型配置

本地包支持标准 OpenAI-compatible Chat Completions 接口，不限定服务商和模型。每位安装者填写自己的配置：

```text
LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com/chat/completions
LLM_MODEL=deepseek-chat
LLM_API_KEY=
```

常见示例：

| 服务 | `LLM_BASE_URL` | `LLM_MODEL` |
| --- | --- | --- |
| DeepSeek 官方 | `https://api.deepseek.com/chat/completions` | 账号当前可用的模型名称 |
| 豆包／火山方舟 | `https://ark.cn-beijing.volces.com/api/v3/chat/completions` | 推理 Endpoint ID，例如 `ep-...` |
| OpenAI | `https://api.openai.com/v1/chat/completions` | 账号当前可用的模型名称 |
| 其他兼容服务 | 服务商给出的 HTTPS Chat Completions 完整地址 | 服务商要求的模型名称 |

`LLM_PROVIDER` 只用于界面和错误提示；实际请求由 `LLM_BASE_URL` 和 `LLM_MODEL` 决定。远程地址必须使用 HTTPS；本机模型可使用 `127.0.0.1` 或 `localhost` 的 HTTP 地址。CodingPlan 是开发套餐，不应直接当作产品 API；使用火山方舟时应创建正常推理 Endpoint。

## 何时会调用

导入消息只写本地密文，不调用模型。只有用户在页面点击“使用我的模型分析”后，最多 300 条所选消息的文本、发送者显示名和时间才会发送至所配置的服务。

安装者需要自行承担费用，并确认企业对办公消息发送到该模型服务的合规要求。预检只验证字段和地址格式，不证明该服务真实兼容、Key 有效或模型可用。首版没有集中计费、预算控制或企业代理。
