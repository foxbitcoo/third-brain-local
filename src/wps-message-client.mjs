const ENDPOINT = "https://openapi.wps.cn/mcp/v2/kso-message/message";

function decode(result) {
  if (result?.isError) throw new Error("WPS 消息读取失败");
  if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  for (const block of result?.content || []) {
    if (block?.type !== "text") continue;
    try { return JSON.parse(block.text); } catch { /* ignore */ }
  }
  throw new Error("WPS 消息返回无法解析");
}

async function defaultClientFactory(accessToken) {
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
  ]);
  const client = new Client({ name: "third-brain-local", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
  });
  await client.connect(transport);
  return client;
}

function normalizeChat(item) {
  const chat = item?.chat || item;
  const type = String(chat?.type || "unknown");
  const privateChat = /(?:p2p|private|direct|single|one[_-]?to[_-]?one)/iu.test(type);
  const groupChat = /group/iu.test(type);
  return { id: chat?.id || "", name: chat?.name || "未命名会话", type, privateChat, groupChat };
}

function normalizeMessage(item) {
  const message = item?.message || item;
  const content = message?.content?.text?.content ?? message?.content?.text ?? message?.text ?? "";
  return {
    id: message?.id || "",
    senderName: message?.sender?.name || message?.sender?.id || "未知成员",
    occurredAt: message?.ctime || message?.create_time || "",
    text: typeof content === "string" ? content : "",
  };
}

export function createWpsMessageClient({ accessToken, clientFactory = defaultClientFactory }) {
  async function call(name, arguments_) {
    const client = await clientFactory(accessToken);
    try { return decode(await client.callTool({ name, arguments: arguments_ })); }
    finally { await client.close?.(); }
  }
  return Object.freeze({
    async listChats() {
      const chats = [];
      let pageToken;
      let pageCount = 0;
      do {
        const payload = await call("kso_message_get_chat_list", {
          page_size: 50,
          ...(pageToken ? { page_token: pageToken } : {}),
        });
        chats.push(...(payload.items || []).map(normalizeChat).filter((chat) => chat.id));
        pageToken = payload.next_page_token;
        pageCount += 1;
      } while (pageToken && chats.length < 1_000);
      return {
        chats,
        completeness: {
          complete: !pageToken,
          reason: pageToken ? "chat_limit_1000" : "source_exhausted",
          pageCount,
        },
      };
    },
    async getMessages({ chatId, startAt, endAt }) {
      const all = [];
      let pageToken;
      do {
        const payload = await call("kso_message_get_chat_messages", {
          chat_id: chatId,
          start_time: Math.floor(Date.parse(startAt) / 1000),
          end_time: Math.floor(Date.parse(endAt) / 1000),
          page_size: 50,
          order: "asc",
          ...(pageToken ? { page_token: pageToken } : {}),
        });
        all.push(...(payload.items || []).map(normalizeMessage));
        pageToken = payload.next_page_token;
      } while (pageToken && all.length < 2_000);
      return {
        messages: all.filter((message) => message.id && message.text),
        completeness: {
          complete: !pageToken,
          reason: pageToken ? "message_limit_2000" : "source_exhausted",
        },
      };
    },
  });
}
