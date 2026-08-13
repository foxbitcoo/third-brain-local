#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { checkPublicRelease } from "./release-check.mjs";

const denylistFlag = process.argv.indexOf("--denylist");
let denylist = [];
if (denylistFlag >= 0 && process.argv[denylistFlag + 1]) {
  const text = await readFile(path.resolve(process.argv[denylistFlag + 1]), "utf8");
  denylist = text.split(/\r?\n/u).map((item) => item.trim()).filter((item) => item && !item.startsWith("#"));
}

const root = path.resolve(import.meta.dirname, "..");
const result = await checkPublicRelease(root, { denylist });
if (!result.ok) {
  process.stderr.write(`公开候选检查失败（${result.findings.length} 项）：\n`);
  for (const finding of result.findings) process.stderr.write(`- ${finding.code}: ${finding.file}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`公开候选检查通过：${result.fileCount} 个文件，${result.totalBytes} bytes。\n`);
}
