#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const denylistFlag = process.argv.indexOf("--denylist");
const denylistPath = denylistFlag >= 0 ? process.argv[denylistFlag + 1] : undefined;

if (!denylistPath) {
  process.stderr.write("发布总门必须通过 --denylist 指定仅存于私人环境的 denylist。\n");
  process.exit(1);
}

for (const args of [
  ["scripts/check-release.mjs", "--denylist", denylistPath],
  ["scripts/check-public-git.mjs", "--denylist", denylistPath],
  ["scripts/verify-standalone.mjs"],
]) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

process.stdout.write("公开版发布总门通过。\n");
