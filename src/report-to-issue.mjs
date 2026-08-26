// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from "node:crypto";

const TARGET_REPOSITORY = "foxbitcoo/third-brain-local";
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const SCAN_RULES = Object.freeze([
  ["credential", /\b(?:api[_ -]?key|app[_ -]?key|access[_ -]?token|refresh[_ -]?token|oauth[_ -]?code|cookie|authorization|bearer|wps[_ -]?sid)\s*[:=]\s*\S+/iu],
  ["wps_token", /\bkso_(?:ac|rt)_[A-Za-z0-9._-]{12,}\b/u],
  ["github_token", /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b/u],
  ["absolute_path", /(?:\/(?:Users|home|private|tmp|var)\/\S+|[A-Za-z]:\\Users\\\S+)/u],
  ["internal_link", /https?:\/\/(?:[^\s/]+\.)?(?:feishu\.cn|kdocs\.cn|wps\.cn)\/\S+/iu],
  ["runtime_database", /\b\S+\.(?:db|sqlite|sqlite3)\b/iu],
  ["stable_identifier", /\b(?:user|chat|conversation|tenant|source)[_-]?id\s*[:=]\s*[A-Za-z0-9._-]{6,}/iu],
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(domain, value) {
  return createHash("sha256")
    .update(`${domain}\0${canonicalJson(value)}`)
    .digest("hex");
}

function boundedText(value, label, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} 无效`);
  }
  return value.trim();
}

function scanText(text) {
  const findings = [];
  for (const [code, expression] of SCAN_RULES) {
    if (expression.test(text)) findings.push(code);
  }
  return findings;
}

function normalizeAttachments(value) {
  if (!Array.isArray(value) || value.length > 10) throw new TypeError("附件列表无效");
  if (value.length > 0) {
    throw new Error("公开版当前不接受附件：等待宿主读取原始 bytes 并生成隐私扫描回执");
  }
  return Object.freeze([]);
}

export function createLocalReportService({
  load,
  save,
  now = () => new Date().toISOString(),
  createId = () => `draft_${randomUUID()}`,
  privateDenylist = [],
}) {
  if (typeof load !== "function" || typeof save !== "function") {
    throw new TypeError("本地报告存储端口无效");
  }
  return Object.freeze({
    async createDraft(input) {
      const title = boundedText(input?.title, "标题", 200);
      const body = boundedText(input?.body, "正文", 20_000);
      const attachments = normalizeAttachments(input?.attachments ?? []);
      const findings = [...new Set([
        ...scanText(title),
        ...scanText(body),
        ...attachments.flatMap((item) => scanText(item.name)),
      ])];
      if (findings.length) throw new Error("隐私扫描未通过：请删除凭证、内部内容、稳定 ID 或本地定位信息");
      const normalizedDenylist = Array.isArray(privateDenylist)
        ? privateDenylist.map((item) => String(item).trim()).filter((item) => item.length >= 2)
        : [];
      const privateText = `${title}\n${body}\n${attachments.map((item) => item.name).join("\n")}`;
      if (normalizedDenylist.some((literal) => privateText.includes(literal))) {
        throw new Error("隐私扫描未通过：命中本机私人 denylist");
      }
      const privacyStatus = normalizedDenylist.length > 0 ? "passed" : "manual_review_required";
      const createdAt = now();
      const draftId = createId();
      const preview = {
        schemaVersion: "public-report-preview/v1",
        draftId,
        revision: 1,
        createdAt,
        status: "preview_only",
        target: { repository: TARGET_REPOSITORY },
        issue: { title, body },
        attachments,
        privacy: {
          status: privacyStatus,
          scannerVersion: "public-local-report-scan/v1",
          findings: privacyStatus === "passed" ? [] : ["private_denylist_required"],
          denylistDigest: normalizedDenylist.length > 0
            ? digest("third-brain/public-report-private-denylist/v1", normalizedDenylist.toSorted())
            : null,
        },
        sideEffects: { githubIssueCreated: false },
      };
      preview.previewDigest = digest("third-brain/public-report-preview/v1", {
        target: preview.target,
        issue: preview.issue,
        attachments: preview.attachments,
        privacy: preview.privacy,
      });
      await save(draftId, { preview, receipt: null });
      return structuredClone(preview);
    },
    async readDraft(draftId) {
      const record = await load(draftId);
      if (!record) throw new Error("本地问题草稿不存在");
      return structuredClone(record.preview);
    },
    async confirm({ draftId, previewDigest, githubLogin }) {
      const record = await load(draftId);
      if (!record) throw new Error("本地问题草稿不存在");
      if (record.preview.previewDigest !== previewDigest) throw new Error("预览内容已变化，请重新完整确认");
      if (record.preview.privacy.status !== "passed") {
        throw new Error("本地私人 denylist 尚未配置，只能人工复核，不能生成确认回执");
      }
      const normalizedGithubLogin = String(githubLogin ?? "");
      if (!GITHUB_LOGIN.test(normalizedGithubLogin)) throw new Error("GitHub 身份无效");
      if (record.receipt) {
        if (
          record.receipt.previewDigest !== previewDigest
          || record.receipt.actor?.login !== normalizedGithubLogin
        ) {
          throw new Error("确认身份已变化，请重新创建草稿并完整预览");
        }
        return structuredClone(record.receipt);
      }
      const bound = {
        schemaVersion: "public-report-confirmation/v1",
        receiptId: `receipt_${randomUUID()}`,
        draftId,
        draftRevision: record.preview.revision,
        confirmedAt: now(),
        status: "confirmed_local_only",
        actor: { provider: "github_user", login: normalizedGithubLogin },
        target: structuredClone(record.preview.target),
        previewDigest,
        privacyDigest: digest("third-brain/public-report-privacy/v1", record.preview.privacy),
        sideEffects: { githubIssueCreated: false },
      };
      const receipt = {
        ...bound,
        bindingDigest: digest("third-brain/public-report-confirmation/v1", bound),
      };
      await save(draftId, { ...record, receipt });
      return structuredClone(receipt);
    },
  });
}
