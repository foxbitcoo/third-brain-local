import { createServer } from "node:http";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { createLocalConfig } from "./config.mjs";

const REQUIRED_FIELDS = Object.freeze(["WPS_APP_ID", "WPS_APP_KEY", "DEEPSEEK_API_KEY"]);
const INPUT_KEYS = Object.freeze(["deepseekApiKey", "wpsAppId", "wpsAppKey"]);
const SAFE_INSTALL_VALUE = /^[A-Za-z0-9._-]{3,512}$/u;

function json(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function assertLoopbackHost(request) {
  try {
    if (new URL(`http://${request.headers.host}`).hostname !== "127.0.0.1") throw new Error();
  } catch {
    throw new Error("设置服务只接受 127.0.0.1 Host");
  }
}

function assertSameOriginJson(request) {
  if (request.headers.origin !== `http://${request.headers.host}`) throw new Error("请求来源不是当前本地页面");
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    throw new Error("请求必须使用 application/json");
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) throw new Error("设置内容过大");
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("设置格式无效");
  if (Object.keys(value).sort().join("|") !== [...INPUT_KEYS].sort().join("|")) throw new Error("设置字段不完整或包含额外字段");
  for (const key of INPUT_KEYS) {
    if (typeof value[key] !== "string" || !SAFE_INSTALL_VALUE.test(value[key].trim())) throw new Error("设置值格式无效");
  }
  return Object.fromEntries(INPUT_KEYS.map((key) => [key, value[key].trim()]));
}

function environmentFromInput(input, port) {
  return {
    WPS_APP_ID: input.wpsAppId,
    WPS_APP_KEY: input.wpsAppKey,
    WPS_REDIRECT_URI: `http://127.0.0.1:${port}/oauth/wps/callback`,
    WPS_SCOPES: "kso.user_base.read delegated:kso.mcp_message.readwrite",
    DEEPSEEK_API_KEY: input.deepseekApiKey,
    DEEPSEEK_MODEL: "deepseek-v4-pro",
    LOCAL_PORT: String(port),
  };
}

function serializeEnvironment(environment) {
  const orderedKeys = ["WPS_APP_ID", "WPS_APP_KEY", "WPS_REDIRECT_URI", "WPS_SCOPES", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL", "LOCAL_PORT"];
  return ["# 由第三大脑本地设置导览生成。不要提交、截图或发送此文件。", ...orderedKeys.map((key) => `${key}=${environment[key]}`), ""].join("\n");
}

async function persistEnvironment(envFile, environment) {
  const temporaryFile = `${envFile}.tmp-${randomUUID()}`;
  await writeFile(temporaryFile, serializeEnvironment(environment), { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(temporaryFile, 0o600);
  await rename(temporaryFile, envFile);
  await chmod(envFile, 0o600);
}

export function createLocalSetupServer({ setupFile, envFile, port = 4310 }) {
  return createServer(async (request, response) => {
    try {
      assertLoopbackHost(request);
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/") {
        const html = await readFile(setupFile, "utf8");
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; form-action 'self' https://open.wps.cn https://platform.deepseek.com",
          "x-frame-options": "DENY",
        });
        response.end(html);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/setup/status") {
        return json(response, 200, {
          configurationReady: false,
          requiredFields: REQUIRED_FIELDS,
          callbackUri: `http://127.0.0.1:${port}/oauth/wps/callback`,
        });
      }
      if (request.method === "POST" && url.pathname === "/api/setup/save") {
        assertSameOriginJson(request);
        const environment = environmentFromInput(await readJsonBody(request), port);
        if (!createLocalConfig(environment).ready) throw new Error("配置校验失败");
        await persistEnvironment(envFile, environment);
        return json(response, 200, { saved: true, configurationReady: true, restartRequired: true });
      }
      json(response, 404, { error: "not_found" });
    } catch (error) {
      json(response, 400, { error: "setup_failed", message: String(error?.message || "设置失败").slice(0, 120) });
    }
  });
}
