#!/usr/bin/env node
import { chmod, copyFile, open } from "node:fs/promises";
import path from "node:path";

const source = path.resolve(".env.example");
const target = path.resolve(".env.local");
try {
  const handle = await open(target, "wx", 0o600);
  await handle.close();
  await copyFile(source, target);
  await chmod(target, 0o600);
  process.stdout.write("已创建 .env.local（权限 600）。请填写你自己的 WPS 应用凭证和 DeepSeek API Key。\n");
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
  await chmod(target, 0o600);
  process.stdout.write(".env.local 已存在，未覆盖。\n");
}
process.stdout.write("下一步：npm run preflight；通过后运行 npm start。\n");
