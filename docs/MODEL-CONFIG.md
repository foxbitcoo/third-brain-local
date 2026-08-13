# DeepSeek 模型配置

首版固定调用 DeepSeek 官方 OpenAI-compatible 接口：

```text
https://api.deepseek.com/chat/completions
```

模型固定为 `deepseek-v4-pro`。每位安装者使用自己的 Key：

```text
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-pro
```

不接受自定义转发地址，也不支持把火山 CodingPlan 当产品后端，避免把个人开发套餐误用为同事试用服务。

## 何时会调用

导入消息只写本地密文，不调用模型。只有用户在页面点击“使用我的 DeepSeek Key 分析”后，最多 300 条所选消息的文本、发送者显示名和时间才会发送至 DeepSeek。

安装者需要自行承担费用，并确认企业对办公消息发送到该模型服务的合规要求。首版没有集中计费、预算控制或企业代理。
