import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function readOrCreateKey(root) {
  const file = path.join(root, "local.key");
  try {
    return Buffer.from((await readFile(file, "utf8")).trim(), "base64");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const key = randomBytes(32);
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(`${key.toString("base64")}\n`, "utf8"); }
  finally { await handle.close(); }
  return key;
}

function seal(key, value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    body: body.toString("base64"),
  };
}

function openSealed(key, envelope) {
  if (envelope?.version !== 1) throw new Error("unsupported encrypted local record");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(envelope.body, "base64")),
    decipher.final(),
  ]).toString("utf8"));
}

export async function createEncryptedLocalStore({ root }) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const key = await readOrCreateKey(root);
  if (key.length !== 32) throw new Error("invalid local encryption key");
  return Object.freeze({
    async read(name) {
      try {
        return openSealed(key, JSON.parse(await readFile(path.join(root, `${name}.enc.json`), "utf8")));
      } catch (error) {
        if (error?.code === "ENOENT") return undefined;
        throw error;
      }
    },
    async write(name, value) {
      const file = path.join(root, `${name}.enc.json`);
      await writeFile(file, `${JSON.stringify(seal(key, value))}\n`, { encoding: "utf8", mode: 0o600 });
      await chmod(file, 0o600);
    },
  });
}
