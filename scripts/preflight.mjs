#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { assessInstallConfig, formatInstallReport } from "./install-config.mjs";

function parseEnv(text) {
  const parsed = {};
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

async function readLocalEnvironment(filePath) {
  try {
    return parseEnv(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

const informational = process.argv.includes("--informational");
const envFlag = process.argv.indexOf("--env");
const envPath = envFlag >= 0 && process.argv[envFlag + 1]
  ? path.resolve(process.argv[envFlag + 1])
  : path.resolve(".env.local");
const fileEnvironment = await readLocalEnvironment(envPath);
const assessment = assessInstallConfig({ ...fileEnvironment, ...process.env });

process.stdout.write(formatInstallReport(assessment));
if (!assessment.configurationReady && !informational) process.exitCode = 2;
