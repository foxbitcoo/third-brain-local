// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function publicationDigest(domain, value) {
  return createHash("sha256").update(`${domain}\0${canonicalJson(value)}`).digest("hex");
}

function sha(value, label) {
  if (!/^[a-f0-9]{40,64}$/u.test(String(value ?? ""))) throw new TypeError(`${label} 无效`);
  return String(value);
}

function text(value, label, expression) {
  const normalized = String(value ?? "").trim();
  if (!expression.test(normalized)) throw new TypeError(`${label} 无效`);
  return normalized;
}

export function createPublicationReceipt(input) {
  const repository = text(input?.repository, "repository", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u);
  const branch = text(input?.branch, "branch", /^[A-Za-z0-9._/-]+$/u);
  const candidateSha = sha(input?.candidateSha, "candidate SHA");
  const baseSha = sha(input?.baseSha, "base SHA");
  const releaseUrl = text(input?.releaseUrl, "release URL", /^https:\/\/github\.com\/[^\s]+$/u);
  const createdAt = text(input?.createdAt, "createdAt", /^\d{4}-\d{2}-\d{2}T/u);
  const fileManifest = (Array.isArray(input?.fileManifest) ? input.fileManifest : []).map((item) => ({
    path: text(item?.path, "manifest path", /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$)).+$/u),
    oid: sha(item?.oid, "manifest oid"),
    size: Number(item?.size),
  })).toSorted((left, right) => left.path.localeCompare(right.path));
  if (!fileManifest.length || fileManifest.some((item) => !Number.isSafeInteger(item.size) || item.size < 0)) {
    throw new TypeError("file manifest 无效");
  }
  const bound = {
    schemaVersion: "public-publication-receipt/v1",
    repository,
    branch,
    baseSha,
    candidateSha,
    releaseUrl,
    createdAt,
    fileCount: fileManifest.length,
    fileManifestDigest: publicationDigest("third-brain/public-file-manifest/v1", fileManifest),
    diffDigest: sha(input?.diffDigest, "diff digest"),
    scanDigest: sha(input?.scanDigest, "scan digest"),
  };
  return Object.freeze({
    ...bound,
    receiptDigest: publicationDigest("third-brain/public-publication-receipt/v1", bound),
  });
}

export function verifyPublicationReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") return false;
  const { receiptDigest, ...bound } = receipt;
  return /^[a-f0-9]{64}$/u.test(String(receiptDigest ?? ""))
    && publicationDigest("third-brain/public-publication-receipt/v1", bound) === receiptDigest;
}
