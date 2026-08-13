import { readFile } from "node:fs/promises";

export function parseEnvFile(text) {
  const output = {};
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
    output[key] = value;
  }
  return output;
}

export async function readEnvFile(file) {
  try { return parseEnvFile(await readFile(file, "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}
