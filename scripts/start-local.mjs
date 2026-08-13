#!/usr/bin/env node
import path from "node:path";

import { createLocalConfig } from "../src/config.mjs";
import { createDeepSeekAnalyzer } from "../src/deepseek.mjs";
import { createEncryptedLocalStore } from "../src/encrypted-store.mjs";
import { readEnvFile } from "../src/env-file.mjs";
import { createLocalHttpServer } from "../src/http-server.mjs";
import { createLocalTrialRuntime } from "../src/local-runtime.mjs";
import { createLocalSetupServer } from "../src/setup-server.mjs";

const localEnvironment = await readEnvFile(path.resolve(".env.local"));
const config = createLocalConfig({ ...localEnvironment, ...process.env });
const listenPort = Number.isInteger(config.port) && config.port >= 1024 && config.port <= 65535 ? config.port : 4310;
let server;
if (!config.ready) {
  server = createLocalSetupServer({
    setupFile: new URL("../public/setup.html", import.meta.url),
    envFile: path.resolve(".env.local"),
    port: listenPort,
  });
} else {
  const store = await createEncryptedLocalStore({ root: path.resolve(".runtime", "user-data") });
  const runtime = createLocalTrialRuntime({
    config,
    store,
    inference: createDeepSeekAnalyzer(config.model),
  });
  server = createLocalHttpServer({ runtime, indexFile: new URL("../public/index.html", import.meta.url) });
}
server.listen(listenPort, config.host, () => {
  process.stdout.write(`第三大脑本地试用已启动：http://${config.host}:${listenPort}\n`);
  if (!config.ready) process.stdout.write(`首次设置尚未完成：请在浏览器打开 http://${config.host}:${listenPort}，按导览准备并保存自己的 WPS 与 DeepSeek 配置。\n`);
  else process.stdout.write("数据只保存在当前电脑；只有点击“分析”后，所选消息才会发送到安装者配置的 DeepSeek API。\n");
});
