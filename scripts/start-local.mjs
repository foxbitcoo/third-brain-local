#!/usr/bin/env node
import path from "node:path";

import { createLocalConfig } from "../src/config.mjs";
import { createDeepSeekAnalyzer } from "../src/deepseek.mjs";
import { createEncryptedLocalStore } from "../src/encrypted-store.mjs";
import { readEnvFile } from "../src/env-file.mjs";
import { createLocalHttpServer } from "../src/http-server.mjs";
import { createLocalTrialRuntime } from "../src/local-runtime.mjs";

const localEnvironment = await readEnvFile(path.resolve(".env.local"));
const config = createLocalConfig({ ...localEnvironment, ...process.env });
if (!config.ready) {
  process.stderr.write(`配置尚未完成：${config.missing.join(", ")}\n请先运行 npm run setup 和 npm run preflight。\n`);
  process.exit(2);
}
const store = await createEncryptedLocalStore({ root: path.resolve(".runtime", "user-data") });
const runtime = createLocalTrialRuntime({
  config,
  store,
  inference: createDeepSeekAnalyzer(config.model),
});
const server = createLocalHttpServer({ runtime, indexFile: new URL("../public/index.html", import.meta.url) });
server.listen(config.port, config.host, () => {
  process.stdout.write(`第三大脑本地试用已启动：http://${config.host}:${config.port}\n`);
  process.stdout.write("数据只保存在当前电脑；只有点击“分析”后，所选消息才会发送到安装者配置的 DeepSeek API。\n");
});
