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
    async analyze({ messages = null, strategy = null, units = null }) {
      const compact = Array.isArray(units)
        ? units.slice(-300).map((unit) => ({
          unitId: unit.unitId,
          evidence: unit.items.map((item) => ({
            evidenceId: item.evidenceId,
            source: item.display?.sourceName || "",
            time: item.occurredAt,
            sender: item.display?.senderName || "",
            text: item.excerpt.slice(0, 1200),
          })),
        }))
        : (messages || []).slice(-300).map((message) => ({
          evidenceId: message.id,
          source: message.chatName,
          time: message.occurredAt,
          sender: message.senderName,
          text: message.text.slice(0, 1200),
        }));
      const strategyInstruction = strategy === "B"
        ? "当前是策略 B：每个 unit 只有一条 Evidence，只在单条信息已经足够时提出候选；短确认语不能脱离上下文升级。"
        : strategy === "C"
          ? "当前是策略 C：每个 unit 是同一来源、90 分钟内最多 5 条连续 Evidence；利用连续对话补足对象，但不能跨 unit 猜测。"
          : "当前是兼容分析模式。";
      const response = await fetchImpl(baseUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            {
              role: "system",
              content: `你是办公信号分析助手。${strategyInstruction}只根据输入 Evidence 输出 JSON：summary 字符串；candidates 数组，每项必须含 eventType、title、latestChange、background、uncertainty、userDecision、semanticKey、evidenceIds。eventType 只能是“决策变化、责任归属变化、下一步变化、进展／完成变化、阻塞／风险变化、时间点／截止期限变化”之一；evidenceIds 只能引用输入中真实存在的编号。标题只做简短业务总结；背景、最新变化、AI 不确定点和需要用户判断的事项必须分开。不要把普通聊天包装成工作，不确定就不生成候选。只输出 JSON。`,
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
