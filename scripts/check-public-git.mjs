#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { scanReleaseText } from "./release-check.mjs";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("Git 历史检查无法完成");
  return result.stdout;
}

function inspectHistoryPath(relative) {
  const basename = path.basename(relative);
  if (/^\.env(?:\..+)?$/u.test(basename) && basename !== ".env.example") return "private_environment_file";
  if ([".npmrc", ".yarnrc", ".pypirc", ".netrc"].includes(basename)) return "package_manager_credential_file";
  if (relative.startsWith(".runtime/") || relative.includes("/node_modules/")) return "private_runtime_path";
  if (/\.(?:csv|tsv|jsonl|sqlite|sqlite3|db|log)$/iu.test(relative)
    || (path.extname(relative).toLowerCase() === ".json" && !["package.json", "package-lock.json"].includes(basename))) {
    return "forbidden_data_file";
  }
  return null;
}

function scanBlobObjects(blobOids, pathsByOid, denylist) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["cat-file", "--batch"], { stdio: ["pipe", "pipe", "ignore"] });
    const findings = [];
    let buffer = Buffer.alloc(0);
    let current = null;

    child.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        if (!current) {
          const newline = buffer.indexOf(0x0a);
          if (newline < 0) return;
          const [oid, type, sizeText] = buffer.subarray(0, newline).toString("utf8").split(" ");
          buffer = buffer.subarray(newline + 1);
          if (type !== "blob") {
            reject(new Error("Git 历史检查返回了非 blob 对象"));
            child.kill();
            return;
          }
          current = { oid, size: Number(sizeText) };
        }
        if (buffer.length < current.size + 1) return;
        const content = buffer.subarray(0, current.size).toString("utf8");
        const relative = pathsByOid.get(current.oid)?.[0] ?? `git-object:${current.oid.slice(0, 12)}`;
        findings.push(...scanReleaseText(`git-history:${relative}`, content));
        for (const literal of denylist) {
          if (literal.length >= 2 && content.includes(literal)) {
            findings.push({ code: "private_denylist_match", file: `git-history:${relative}` });
          }
        }
        buffer = buffer.subarray(current.size + 1);
        current = null;
      }
    });
    child.on("error", () => reject(new Error("Git 历史检查无法启动")));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error("Git 历史检查无法完成"));
        return;
      }
      if (current || buffer.length > 0) {
        reject(new Error("Git 历史检查返回了不完整的 blob"));
        return;
      }
      resolve(findings);
    });
    child.stdin.end(`${blobOids.join("\n")}\n`);
  });
}

if (git(["status", "--porcelain"]).trim()) throw new Error("公开仓库工作树不干净");
const tracked = git(["ls-files"]).split(/\r?\n/u).filter(Boolean);
for (const file of tracked) {
  if (/^\.env(?:\..+)?$/u.test(file) && file !== ".env.example") throw new Error("公开仓库跟踪了环境文件");
  if (file.startsWith(".runtime/") || file.includes("node_modules/")) throw new Error("公开仓库跟踪了本地运行数据");
}
const denylistFlag = process.argv.indexOf("--denylist");
if (denylistFlag < 0 || !process.argv[denylistFlag + 1]) {
  throw new Error("公开 Git 历史检查必须通过 --denylist 指定私人逐行 denylist");
}
const denylist = (await readFile(path.resolve(process.argv[denylistFlag + 1]), "utf8"))
  .split(/\r?\n/u)
  .map((item) => item.trim())
  .filter((item) => item && !item.startsWith("#"));

const objectLines = git(["rev-list", "--objects", "--all"]).split(/\r?\n/u).filter(Boolean);
const objectOids = [];
const pathsByOid = new Map();
const findings = [];
for (const line of objectLines) {
  const separator = line.indexOf(" ");
  const oid = separator < 0 ? line : line.slice(0, separator);
  objectOids.push(oid);
  if (separator >= 0) {
    const relative = line.slice(separator + 1);
    const paths = pathsByOid.get(oid) ?? [];
    paths.push(relative);
    pathsByOid.set(oid, paths);
    const code = inspectHistoryPath(relative);
    if (code) findings.push({ code, file: `git-history:${relative}` });
  }
}
const typeResult = spawnSync("git", ["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
  encoding: "utf8",
  input: `${[...new Set(objectOids)].join("\n")}\n`,
  maxBuffer: 50 * 1024 * 1024,
});
if (typeResult.status !== 0) throw new Error("Git 历史对象检查无法完成");
const blobOids = typeResult.stdout.split(/\r?\n/u)
  .map((line) => line.split(" "))
  .filter(([, type]) => type === "blob")
  .map(([oid]) => oid);
findings.push(...await scanBlobObjects(blobOids, pathsByOid, denylist));
if (findings.length) {
  const unique = [...new Map(findings.map((item) => [`${item.code}\0${item.file}`, item])).values()];
  process.stderr.write(`${JSON.stringify({ ok: false, findings: unique })}\n`);
  process.exit(1);
}
const commitCount = Number(git(["rev-list", "--all", "--count"]).trim());
process.stdout.write(`公开 Git 历史检查通过：${commitCount} 个提交。\n`);
