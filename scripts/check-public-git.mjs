#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { scanReleaseText } from "./release-check.mjs";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("Git 历史检查无法完成");
  return result.stdout;
}

if (git(["status", "--porcelain"]).trim()) throw new Error("公开仓库工作树不干净");
const tracked = git(["ls-files"]).split(/\r?\n/u).filter(Boolean);
for (const file of tracked) {
  if (/^\.env(?:\..+)?$/u.test(file) && file !== ".env.example") throw new Error("公开仓库跟踪了环境文件");
  if (file.startsWith(".runtime/") || file.includes("node_modules/")) throw new Error("公开仓库跟踪了本地运行数据");
}
const history = git(["log", "--all", "--format=", "--patch", "--no-ext-diff", "--text"]);
const denylistFlag = process.argv.indexOf("--denylist");
if (denylistFlag < 0 || !process.argv[denylistFlag + 1]) {
  throw new Error("公开 Git 历史检查必须通过 --denylist 指定私人逐行 denylist");
}
const denylist = (await readFile(path.resolve(process.argv[denylistFlag + 1]), "utf8"))
  .split(/\r?\n/u)
  .map((item) => item.trim())
  .filter((item) => item && !item.startsWith("#"));
const findings = scanReleaseText("git-history", history);
for (const literal of denylist) {
  if (literal.length >= 2 && history.includes(literal)) {
    findings.push({ code: "private_denylist_match", file: "git-history" });
  }
}
if (findings.length) {
  process.stderr.write(`${JSON.stringify({ ok: false, findings })}\n`);
  process.exit(1);
}
const commitCount = Number(git(["rev-list", "--all", "--count"]).trim());
process.stdout.write(`公开 Git 历史检查通过：${commitCount} 个提交。\n`);
