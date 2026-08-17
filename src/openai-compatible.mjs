function parseJsonContent(content) {
  const normalized = content.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  try { return JSON.parse(normalized); }
  catch { throw new Error("模型返回了无法解析的 JSON 结果"); }
}

export function createOpenAiCompatibleAnalyzer({
  apiKey,
  baseUrl,
  model,
  provider = "custom",
  fetchImpl = fetch,
}) {
  return Object.freeze({
    async analyze({ messages }) {
      const compact = messages.slice(-300).map((message) => ({
        evidenceId: message.id,
        chat: message.chatName,
        time: message.occurredAt,
        sender: message.senderName,
        text: message.text.slice(0, 1200),
      }));
      const response = await fetchImpl(baseUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            {
              role: "system",
              content: "你是办公信号分析助手。只根据证据，用中文业务语言输出 JSON：summary 字符串；candidates 数组，每项含 title、reason、nextQuestion、evidenceIds（1至3个输入中真实存在的 evidenceId）。不要把普通聊天包装成项目，不确定就明确写不确定。只输出 JSON。",
            },
            { role: "user", content: JSON.stringify(compact) },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      let payload;
      try { payload = await response.json(); } catch { payload = null; }
      const content = payload?.choices?.[0]?.message?.content;
      if (!response.ok || typeof content !== "string") throw new Error(`${provider || "模型服务"}分析失败`);
      const parsed = parseJsonContent(content);
      return {
        summary: typeof parsed.summary === "string" ? parsed.summary : "暂无可靠摘要",
        candidates: Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, 12) : [],
      };
    },
  });
}
