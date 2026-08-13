#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(import.meta.dirname, "..", "demo");

export function createDemoServer({ root = DEFAULT_ROOT, host = "127.0.0.1", port = 4310 } = {}) {
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${host}`);
    if (requestUrl.pathname === "/favicon.ico") {
      response.writeHead(204, { "cache-control": "public, max-age=86400" }).end();
      return;
    }
    const relative = requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.replace(/^\/+/, "");
    const resolved = path.resolve(root, relative);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const body = await readFile(resolved);
      const contentType = resolved.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream";
      response.writeHead(200, {
        "content-type": contentType,
        "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'none'",
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      });
      response.end(body);
    } catch (error) {
      response.writeHead(error?.code === "ENOENT" ? 404 : 500).end("Not found");
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({ server, url: `http://${host}:${address.port}/` });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number.parseInt(process.env.PORT ?? "4310", 10);
  const { url } = await createDemoServer({ port: Number.isFinite(port) ? port : 4310 });
  process.stdout.write(`第三大脑公开预览：${url}\n按 Ctrl+C 停止。\n`);
}
