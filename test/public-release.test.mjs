import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { request as httpRequest } from "node:http";

import {
  assessInstallConfig,
  formatInstallReport,
} from "../scripts/install-config.mjs";
import { checkPublicRelease } from "../scripts/release-check.mjs";
import { isPublicCopyEntry } from "../scripts/standalone-policy.mjs";
import { createLocalConfig } from "../src/config.mjs";
import { createEncryptedLocalStore } from "../src/encrypted-store.mjs";
import { createLocalHttpServer } from "../src/http-server.mjs";
import {
  buildWpsAuthorizationUrl,
  exchangeWpsAuthorizationCode,
} from "../src/wps-oauth.mjs";
import { createLocalTrialRuntime } from "../src/local-runtime.mjs";
import { createWpsMessageClient } from "../src/wps-message-client.mjs";

const REQUIRED_SCOPES = [
  "kso.user_base.read",
  "delegated:kso.mcp_message.readwrite",
];

test("安装预检在缺少外部用户自己的 WPS 与模型配置时给出选择题式引导", () => {
  const assessment = assessInstallConfig({});

  assert.equal(assessment.ready, false);
  assert.equal(assessment.publicPreviewRunnable, true);
  assert.deepEqual(
    assessment.missing.map((item) => item.key),
    [
      "WPS_APP_ID",
      "WPS_APP_KEY",
      "WPS_REDIRECT_URI",
      "WPS_SCOPES",
      "DEEPSEEK_MODEL",
      "DEEPSEEK_API_KEY",
    ],
  );
  assert.match(assessment.nextAction, /复制.*\.env\.example/);
  assert.match(assessment.notes.join("\n"), /WPS_SID.*不支持/);
});

test("安装预检校验最小权限并且报告不会输出密钥", () => {
  const secret = "do-not-print-this-secret";
  const installerAppId = ["app", "owned", "by", "installer"].join("_");
  const assessment = assessInstallConfig({
    WPS_APP_ID: installerAppId,
    WPS_APP_KEY: secret,
    WPS_REDIRECT_URI: "http://127.0.0.1:4310/oauth/wps/callback",
    WPS_SCOPES: REQUIRED_SCOPES.join(" "),
    DEEPSEEK_MODEL: "deepseek-v4-pro",
    ["DEEPSEEK_API_" + "KEY"]: secret,
  });
  const report = formatInstallReport(assessment);

  assert.equal(assessment.ready, false);
  assert.equal(assessment.configurationReady, true);
  assert.equal(assessment.productRuntimeReady, false);
  assert.equal(assessment.productRuntimeIncluded, true);
  assert.equal(assessment.missing.length, 0);
  assert.equal(assessment.missingScopes.length, 0);
  assert.doesNotMatch(report, new RegExp(secret));
  assert.match(report, /WPS 应用配置：已填写，待验证审批发布与用户 OAuth/);
  assert.match(report, /大模型配置：已填写，待验证连接/);
  assert.match(report, /本地试用运行时已包含/);
});

test("安装预检明确拒绝把浏览器 WPS_SID 当作认证方式", () => {
  const assessment = assessInstallConfig({ ["WPS_" + "SID"]: "browser-session-value" });

  assert.equal(assessment.ready, false);
  assert.equal(assessment.blockers.some((item) => item.code === "unsupported_wps_sid"), true);
  assert.doesNotMatch(formatInstallReport(assessment), /browser-session-value/);
});

test("发布检查拒绝凭证、私人绝对路径、私有云文档链接和数据文件", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "third-brain-public-check-"));
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "README.md"), "# safe\n", "utf8");
  await writeFile(path.join(root, "docs", "bad.md"), [
    "WPS_APP_" + "KEY=actual-secret-value",
    ["", "Users", "private-user", "Documents", "source.md"].join("/"),
    "https://example." + "feishu.cn/docx/private-token",
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "messages.json"), "[]\n", "utf8");

  const result = await checkPublicRelease(root);

  assert.equal(result.ok, false);
  assert.equal(result.findings.some((item) => item.code === "credential_assignment"), true);
  assert.equal(result.findings.some((item) => item.code === "private_absolute_path"), true);
  assert.equal(result.findings.some((item) => item.code === "private_cloud_link"), true);
  assert.equal(result.findings.some((item) => item.code === "forbidden_data_file"), true);
});

test("发布检查覆盖 HTML、JS 与 MJS 中的字面量凭证赋值", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "third-brain-public-code-secret-"));
  await mkdir(path.join(root, "demo"), { recursive: true });
  const backtick = String.fromCharCode(96);
  await writeFile(path.join(root, "demo", "bad.mjs"), "const LLM_API_" + "KEY = \"actual-secret-value\";\n", "utf8");
  await writeFile(path.join(root, "demo", "bad.html"), "<script>const WPS_APP_" + "KEY='another-secret-value'</script>\n", "utf8");
  await writeFile(path.join(root, "demo", "template.mjs"), "const LLM_API_" + `KEY = ${backtick}template-secret-value${backtick};\n`, "utf8");
  await writeFile(path.join(root, "demo", "comment.mjs"), "// WPS_APP_" + "KEY=comment-secret-value\n", "utf8");
  await writeFile(path.join(root, "demo", "bearer.mjs"), "// Authorization: " + "Bearer literal-token-value\n", "utf8");

  const result = await checkPublicRelease(root);

  assert.equal(result.findings.some((item) => item.code === "credential_assignment" && item.file === "demo/bad.mjs"), true);
  assert.equal(result.findings.some((item) => item.code === "credential_assignment" && item.file === "demo/bad.html"), true);
  assert.equal(result.findings.some((item) => item.code === "credential_assignment" && item.file === "demo/template.mjs"), true);
  assert.equal(result.findings.some((item) => item.code === "credential_assignment" && item.file === "demo/comment.mjs"), true);
  assert.equal(result.findings.some((item) => item.code === "bearer_token_literal" && item.file === "demo/bearer.mjs"), true);
});

test("独立副本排除所有本地环境、包管理器凭证和依赖目录", () => {
  for (const name of [".env", ".env.local", ".env.production.local", ".npmrc", ".yarnrc", "node_modules", ".git"]) {
    assert.equal(isPublicCopyEntry(path.join("/candidate", name)), false, name);
  }
  assert.equal(isPublicCopyEntry("/candidate/.env.example"), true);
  assert.equal(isPublicCopyEntry("/candidate/docs/INSTALL.md"), true);
});

test("当前公开候选目录满足必需文件与通用泄漏门禁", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const result = await checkPublicRelease(root);

  assert.deepEqual(result.findings, []);
  assert.equal(result.ok, true);
});

test("本地配置只接受安装者自己的 WPS 应用与 DeepSeek V4 Pro Key", () => {
  const installerAppSecret = ["installer", "app", "secret"].join("-");
  const installerModelKey = ["installer", "model", "key"].join("-");
  const config = createLocalConfig({
    ["WPS_APP_" + "ID"]: "installer-app-id",
    ["WPS_APP_" + "KEY"]: installerAppSecret,
    WPS_REDIRECT_URI: "http://127.0.0.1:4310/oauth/wps/callback",
    WPS_SCOPES: REQUIRED_SCOPES.slice(0, 2).join(" "),
    ["DEEPSEEK_API_" + "KEY"]: installerModelKey,
    DEEPSEEK_MODEL: "deepseek-v4-pro",
  });

  assert.equal(config.ready, true);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 4310);
  assert.deepEqual(config.wps.scopes, ["kso.user_base.read", "delegated:kso.mcp_message.readwrite"]);
  assert.equal(JSON.stringify(config).includes(installerAppSecret), false);
  assert.equal(JSON.stringify(config).includes(installerModelKey), false);
  assert.equal(createLocalConfig({
    ["WPS_APP_" + "ID"]: "installer-app-id",
    ["WPS_APP_" + "KEY"]: installerAppSecret,
    WPS_REDIRECT_URI: "https://localhost:8443/arbitrary",
    WPS_SCOPES: REQUIRED_SCOPES.join(" "),
    ["DEEPSEEK_API_" + "KEY"]: installerModelKey,
    DEEPSEEK_MODEL: "deepseek-v4-pro",
    LOCAL_PORT: "4310",
  }).ready, false);
});

test("WPS OAuth 使用随机 state、去掉 delegated 前缀且不会请求 app scope", async () => {
  const installerAppSecret = ["installer", "app", "secret"].join("-");
  const authorization = buildWpsAuthorizationUrl({
    appId: "installer-app-id",
    redirectUri: "http://127.0.0.1:4310/oauth/wps/callback",
    scopes: ["kso.user_base.read", "delegated:kso.mcp_message.readwrite"],
    state: "fixed-test-state",
  });
  const url = new URL(authorization.url);

  assert.equal(url.origin + url.pathname, "https://openapi.wps.cn/oauth2/auth");
  assert.equal(url.searchParams.get("state"), "fixed-test-state");
  assert.equal(url.searchParams.get("scope"), "kso.user_base.read,kso.mcp_message.readwrite");
  assert.throws(() => buildWpsAuthorizationUrl({
    appId: "installer-app-id",
    redirectUri: "http://127.0.0.1:4310/oauth/wps/callback",
    scopes: ["app:kso.mcp_message.readwrite"],
  }), /应用权限不能通过用户 OAuth/);

  let captured;
  const result = await exchangeWpsAuthorizationCode({
    appId: "installer-app-id",
    appKey: installerAppSecret,
    code: "one-time-code",
    redirectUri: "http://127.0.0.1:4310/oauth/wps/callback",
    fetchImpl: async (urlValue, options) => {
      captured = { url: urlValue, options };
      return new Response(JSON.stringify({
        access_token: "access-owned-by-installer",
        refresh_token: "refresh-owned-by-installer",
        expires_in: 7200,
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(captured.url, "https://openapi.wps.cn/oauth2/token");
  assert.doesNotMatch(String(captured.options.body), /undefined/);
  assert.equal(result.accessToken, "access-owned-by-installer");
});

test("Token、消息与分析结果只以加密形式写入安装者本地目录", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "third-brain-local-store-"));
  const store = await createEncryptedLocalStore({ root });
  const privateText = "private-message-visible-only-after-decrypt";
  await store.write("workspace", { messages: [{ text: privateText }] });

  const encrypted = await readFile(path.join(root, "workspace.enc.json"), "utf8");
  assert.doesNotMatch(encrypted, new RegExp(privateText));
  assert.deepEqual(await store.read("workspace"), { messages: [{ text: privateText }] });
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(root, "workspace.enc.json"))).mode & 0o777, 0o600);
});

test("本地试用链路由用户选择群聊后拉取，再由用户显式触发模型分析", async () => {
  const writes = new Map();
  const store = {
    async read(key) { return writes.get(key); },
    async write(key, value) { writes.set(key, structuredClone(value)); },
  };
  const calls = [];
  const runtime = createLocalTrialRuntime({
    config: {
      ready: true,
      wps: { appId: "app", appKey: "secret", redirectUri: "http://127.0.0.1/callback", scopes: [] },
      model: { apiKey: "model-key", model: "deepseek-v4-pro" },
    },
    store,
    oauth: {
      buildAuthorization() { return { url: "https://wps.example/auth", state: "state-1" }; },
      async exchange() { return { accessToken: "user-token", refreshToken: "refresh", expiresAt: "2099-01-01T00:00:00.000Z" }; },
    },
    wpsClientFactory() {
      return {
        async listChats() {
          calls.push("list");
          return {
            chats: [
              { id: "chat-1", name: "会话-1", type: "group", privateChat: false, groupChat: true },
              { id: "chat-private", name: "私聊-1", type: "p2p", privateChat: true, groupChat: false },
            ],
            completeness: { complete: true, reason: "source_exhausted" },
          };
        },
        async getMessages({ chatId }) {
          calls.push(`messages:${chatId}`);
          return {
            messages: [{ id: "message-1", senderName: "成员-1", occurredAt: "2026-08-13T09:00:00.000Z", text: "动作-1" }],
            completeness: { complete: true, reason: "source_exhausted" },
          };
        },
      };
    },
    inference: {
      async analyze(input) {
        calls.push(`analyze:${input.messages.length}`);
        return { summary: "候选摘要-1", candidates: [{ title: "候选-1", reason: "规则-1", evidenceIds: ["message-1"] }] };
      },
    },
    now: () => new Date("2026-08-13T12:00:00.000Z"),
  });

  const auth = runtime.beginAuthorization();
  await runtime.finishAuthorization({ code: "code", state: auth.state });
  const chatResult = await runtime.listChats();
  assert.deepEqual(chatResult.chats, [{ id: "chat-1", name: "会话-1", type: "group", privateChat: false, groupChat: true }]);
  assert.equal(chatResult.hiddenPrivateChats, 1);
  await assert.rejects(runtime.importMessages({ chatIds: ["chat-private"], days: 7 }), /私聊默认不进入/);
  const imported = await runtime.importMessages({ chatIds: ["chat-1"], days: 7 });
  assert.equal(imported.messageCount, 1);
  assert.equal(calls.includes("analyze:1"), false);
  const analysis = await runtime.analyzeImportedMessages();
  assert.equal(analysis.summary, "候选摘要-1");
  assert.deepEqual(analysis.candidates[0].evidence, [{
    messageId: "message-1",
    chatName: "会话-1",
    occurredAt: "2026-08-13T09:00:00.000Z",
    excerpt: "动作-1",
  }]);
  assert.deepEqual(await runtime.saveJudgment({ candidateIndex: 0, decision: "important" }), {
    saved: true,
    candidateIndex: 0,
    decision: "important",
  });
  assert.deepEqual(calls, ["list", "messages:chat-1", "analyze:1"]);
});

test("本地写操作拒绝跨站或非 JSON 请求，不能被网页静默触发模型分析", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "third-brain-local-http-"));
  const indexFile = path.join(root, "index.html");
  await writeFile(indexFile, "<!doctype html><title>local</title>", "utf8");
  let analyses = 0;
  const server = createLocalHttpServer({
    indexFile,
    runtime: {
      async status() { return {}; },
      async readWorkspace() { return {}; },
      async analyzeImportedMessages() { analyses += 1; return { summary: "ok" }; },
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const localOrigin = `http://127.0.0.1:${port}`;
  try {
    const hostile = await fetch(`${localOrigin}/api/analyze`, {
      method: "POST",
      headers: { origin: "https://hostile.example.invalid", "content-type": "text/plain" },
      body: "{}",
    });
    assert.equal(hostile.status, 400);
    assert.equal(analyses, 0);

    const reboundStatus = await new Promise((resolve, reject) => {
      const request = httpRequest({
        hostname: "127.0.0.1",
        port,
        path: "/api/status",
        headers: { host: "hostile.example.invalid" },
      }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(reboundStatus, 400);

    const allowed = await fetch(`${localOrigin}/api/analyze`, {
      method: "POST",
      headers: { origin: localOrigin, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(allowed.status, 200);
    assert.equal(analyses, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("WPS 会话自动翻页，消息达到安全上限时必须显式报告截断", async () => {
  let chatPage = 0;
  let messagePage = 0;
  const client = createWpsMessageClient({
    accessToken: "installer-token",
    clientFactory: async () => ({
      async callTool({ name }) {
        if (name === "kso_message_get_chat_list") {
          chatPage += 1;
          return { structuredContent: {
            items: [{ id: `chat-${chatPage}`, name: `会话-${chatPage}`, type: "group" }],
            ...(chatPage === 1 ? { next_page_token: "page-2" } : {}),
          } };
        }
        messagePage += 1;
        return { structuredContent: {
          items: Array.from({ length: 50 }, (_, index) => ({
            id: `message-${messagePage}-${index}`,
            sender: { name: "成员" },
            ctime: "2026-08-13T09:00:00.000Z",
            content: { text: { content: "动作" } },
          })),
          next_page_token: `page-${messagePage + 1}`,
        } };
      },
      async close() {},
    }),
  });
  const chats = await client.listChats();
  assert.equal(chats.chats.length, 2);
  assert.equal(chats.completeness.complete, true);

  const messages = await client.getMessages({
    chatId: "chat-1",
    startAt: "2026-08-01T00:00:00.000Z",
    endAt: "2026-08-13T00:00:00.000Z",
  });
  assert.equal(messages.messages.length, 2_000);
  assert.deepEqual(messages.completeness, { complete: false, reason: "message_limit_2000" });
});

test("导入存在截断时禁止模型分析，避免把不完整样本当作全量", async () => {
  let analyzed = false;
  const store = {
    async read(name) {
      if (name !== "workspace") return undefined;
      return {
        messages: [{ id: "message-1", text: "动作" }],
        sources: [{ completeness: { complete: false, reason: "message_limit_2000" } }],
      };
    },
    async write() {},
  };
  const runtime = createLocalTrialRuntime({
    config: { wps: {}, model: {} },
    store,
    inference: { async analyze() { analyzed = true; return {}; } },
  });
  await assert.rejects(runtime.analyzeImportedMessages(), /存在截断/);
  assert.equal(analyzed, false);
});

test("公开 Git 历史使用同一私人 denylist 检出已删除内容", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "third-brain-public-history-"));
  const privateLiteral = ["PRIVATE", "ALIAS", "2026"].join("_");
  const denylist = path.join(os.tmpdir(), `third-brain-denylist-${process.pid}.txt`);
  const runGit = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(runGit(["init", "-b", "main"]).status, 0);
  assert.equal(runGit(["config", "user.name", "Release Test"]).status, 0);
  assert.equal(runGit(["config", "user.email", "release@example.invalid"]).status, 0);
  await writeFile(path.join(root, "README.md"), "# safe\n", "utf8");
  assert.equal(runGit(["add", "README.md"]).status, 0);
  assert.equal(runGit(["commit", "-m", "initial"]).status, 0);
  await writeFile(path.join(root, "removed.txt"), `${privateLiteral}\n`, "utf8");
  assert.equal(runGit(["add", "removed.txt"]).status, 0);
  assert.equal(runGit(["commit", "-m", "temporary"]).status, 0);
  await unlink(path.join(root, "removed.txt"));
  assert.equal(runGit(["add", "-u"]).status, 0);
  assert.equal(runGit(["commit", "-m", "remove"]).status, 0);
  await writeFile(denylist, `${privateLiteral}\n`, { encoding: "utf8", mode: 0o600 });

  const result = spawnSync(process.execPath, [
    path.resolve(import.meta.dirname, "..", "scripts", "check-public-git.mjs"),
    "--denylist",
    denylist,
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /private_denylist_match/);
});
