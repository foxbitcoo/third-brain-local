#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createPublicationReceipt, publicationDigest } from "./publication-receipt.mjs";

const root = path.resolve(import.meta.dirname, "..");
const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const required = (flag) => {
  const value = valueAfter(flag);
  if (!value) throw new Error(`缺少 ${flag}`);
  return value;
};
const git = (args, options = {}) => {
  const result = spawnSync("git", args, { cwd: root, encoding: options.encoding ?? "utf8", maxBuffer: 50 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("publication receipt Git 读取失败");
  return result.stdout;
};
const runGate = (args) => {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("publication receipt 前置扫描未通过");
  return result.stdout;
};

if (git(["status", "--porcelain"]).trim()) throw new Error("生成 publication receipt 前工作树必须干净");
const repository = required("--repository");
const branch = required("--branch");
const baseSha = required("--base-sha");
const candidateSha = required("--candidate-sha");
const releaseUrl = required("--release-url");
const denylistPath = path.resolve(required("--denylist"));
const outputPath = path.resolve(required("--output"));
if (git(["rev-parse", "HEAD"]).trim() !== candidateSha) throw new Error("candidate SHA 不是当前 HEAD");
if (git(["branch", "--show-current"]).trim() !== branch) throw new Error("branch 与当前工作树不一致");
const outputRelative = path.relative(root, outputPath);
if (!outputRelative.startsWith("..") || path.isAbsolute(outputRelative)) {
  throw new Error("publication receipt 必须写到公开仓库之外");
}

const manifest = git(["ls-tree", "-r", "-l", "--full-tree", candidateSha]).split(/\r?\n/u).filter(Boolean).map((line) => {
  const tab = line.indexOf("\t");
  const [mode, type, oid, sizeText] = line.slice(0, tab).trim().split(/\s+/u);
  if (type !== "blob" || mode === "120000") throw new Error("publication receipt manifest 只允许普通文件");
  return { path: line.slice(tab + 1), oid, size: Number(sizeText) };
});
const diff = git(["diff", "--binary", baseSha, candidateSha, "--"]);
const denylistDigest = createHash("sha256").update(await readFile(denylistPath)).digest("hex");
const scanOutputs = {
  release: runGate(["scripts/check-release.mjs", "--denylist", denylistPath]),
  history: runGate(["scripts/check-public-git.mjs", "--denylist", denylistPath]),
  standalone: runGate(["scripts/verify-standalone.mjs"]),
  denylistDigest,
};
const receipt = createPublicationReceipt({
  repository,
  branch,
  baseSha,
  candidateSha,
  releaseUrl,
  createdAt: new Date().toISOString(),
  fileManifest: manifest,
  diffDigest: createHash("sha256").update(diff).digest("hex"),
  scanDigest: publicationDigest("third-brain/public-scan-gates/v1", scanOutputs),
});
await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
process.stdout.write(`Publication receipt 已生成：${receipt.receiptDigest}\n`);
