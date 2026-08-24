import { types as utilTypes } from "node:util";

import { ReportToIssueError } from "./errors.mjs";

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const ATTACHMENT_MEDIA_TYPES = Object.freeze({
  diagnostic: new Set(["text/plain", "application/json"]),
  log: new Set(["text/plain"]),
  screenshot: new Set(["image/png", "image/jpeg"]),
});

function invalid(message) {
  throw new ReportToIssueError("invalid_draft", message);
}

export function snapshotPlainData(value) {
  const ancestors = new Set();
  const visit = (candidate) => {
    if (candidate === null || ["string", "boolean"].includes(typeof candidate)) {
      return candidate;
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate !== "object") invalid("report draft must contain plain data only");
    if (utilTypes.isProxy(candidate)) invalid("report draft must not contain proxies");
    if (ancestors.has(candidate)) invalid("report draft must not contain cycles");
    let descriptors;
    let prototype;
    try {
      descriptors = Object.getOwnPropertyDescriptors(candidate);
      prototype = Object.getPrototypeOf(candidate);
    } catch {
      invalid("report draft must contain inspectable plain data only");
    }
    if (
      prototype !== Object.prototype &&
      prototype !== Array.prototype &&
      prototype !== null
    ) {
      invalid("report draft must contain plain objects and arrays only");
    }
    ancestors.add(candidate);
    const keys = Reflect.ownKeys(descriptors);
    if (
      Array.isArray(candidate) &&
      (keys.filter((key) => key !== "length").length !== candidate.length ||
        keys
          .filter((key) => key !== "length")
          .some((key, index) => key !== String(index)))
    ) {
      invalid("report draft must not contain sparse arrays");
    }
    const snapshot = Array.isArray(candidate) ? [] : Object.create(null);
    for (const key of keys) {
      if (typeof key === "symbol") invalid("report draft must not contain symbol keys");
      if (Array.isArray(candidate) && key === "length") continue;
      const descriptor = descriptors[key];
      if (
        descriptor.get ||
        descriptor.set ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        invalid("report draft must not contain accessors or hidden fields");
      }
      snapshot[key] = visit(descriptor.value);
    }
    ancestors.delete(candidate);
    return Object.freeze(snapshot);
  };
  return visit(value);
}

function exactKeys(value, keys, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${path} must be an object`);
  }
  const expected = new Set(keys);
  if (
    Object.keys(value).length !== expected.size ||
    Object.keys(value).some((key) => !expected.has(key))
  ) {
    invalid(`${path} contains unsupported fields`);
  }
}

function text(value, path, { max = 10_000 } = {}) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > max ||
    CONTROL_CHARACTERS.test(value)
  ) {
    invalid(`${path} must be bounded non-empty text`);
  }
}

function assertReport(report) {
  exactKeys(
    report,
    ["title", "reproductionSteps", "expectedResult", "actualResult", "diagnostics"],
    "report",
  );
  text(report.title, "report.title", { max: 200 });
  if (
    !Array.isArray(report.reproductionSteps) ||
    report.reproductionSteps.length === 0 ||
    report.reproductionSteps.length > 20
  ) {
    invalid("report.reproductionSteps must contain 1 to 20 steps");
  }
  report.reproductionSteps.forEach((step, index) =>
    text(step, `report.reproductionSteps[${index}]`, { max: 2_000 }));
  text(report.expectedResult, "report.expectedResult");
  text(report.actualResult, "report.actualResult");
  const diagnosticKeys = [
    "version",
    "operatingSystem",
    "installMethod",
    "failedStage",
    "errorCode",
  ];
  exactKeys(report.diagnostics, diagnosticKeys, "report.diagnostics");
  for (const key of diagnosticKeys) {
    text(report.diagnostics[key], `report.diagnostics.${key}`, { max: 500 });
  }
}

function assertSource(source) {
  exactKeys(source, ["branch", "commit", "files"], "source");
  text(source.branch, "source.branch", { max: 200 });
  if (
    source.branch.startsWith("/") ||
    source.branch.includes("://") ||
    source.branch.includes("\\")
  ) {
    invalid("source.branch must be a repository branch name");
  }
  if (!COMMIT.test(source.commit)) invalid("source.commit must be a full commit digest");
  if (!Array.isArray(source.files) || source.files.length > 50) {
    invalid("source.files must be a bounded array");
  }
  source.files.forEach((file, index) => {
    exactKeys(file, ["path", "contentDigest", "diffDigest"], `source.files[${index}]`);
    text(file.path, `source.files[${index}].path`, { max: 500 });
    const segments = file.path.split("/");
    if (
      file.path.startsWith("/") ||
      file.path.includes("\\") ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      invalid(`source.files[${index}].path must be repository-relative`);
    }
    if (!SHA256.test(file.contentDigest) || !SHA256.test(file.diffDigest)) {
      invalid(`source.files[${index}] digests must be SHA-256`);
    }
  });
}

function assertAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length > 10) {
    invalid("attachments must be a bounded array");
  }
  attachments.forEach((attachment, index) => {
    exactKeys(
      attachment,
      [
        "name",
        "kind",
        "mediaType",
        "contentDigest",
        "userApproved",
        "privacyScanStatus",
      ],
      `attachments[${index}]`,
    );
    text(attachment.name, `attachments[${index}].name`, { max: 255 });
    if (
      attachment.name.includes("/") ||
      attachment.name.includes("\\") ||
      attachment.name === "." ||
      attachment.name === ".."
    ) {
      invalid(`attachments[${index}].name must not be a local locator`);
    }
    if (!Object.hasOwn(ATTACHMENT_MEDIA_TYPES, attachment.kind)) {
      invalid(`attachments[${index}].kind is unsupported`);
    }
    text(attachment.mediaType, `attachments[${index}].mediaType`, { max: 100 });
    if (!ATTACHMENT_MEDIA_TYPES[attachment.kind].has(attachment.mediaType)) {
      invalid(`attachments[${index}].mediaType is unsupported for its kind`);
    }
    if (!SHA256.test(attachment.contentDigest)) {
      invalid(`attachments[${index}].contentDigest must be SHA-256`);
    }
    if (typeof attachment.userApproved !== "boolean") {
      invalid(`attachments[${index}].userApproved must be boolean`);
    }
    if (!["passed", "not_run", "failed"].includes(attachment.privacyScanStatus)) {
      invalid(`attachments[${index}].privacyScanStatus is unsupported`);
    }
  });
}

function assertDraftSnapshot(snapshot) {
  exactKeys(
    snapshot,
    ["edition", "report", "source", "attachments", "classification"],
    "draft",
  );
  if (snapshot.edition !== "public") {
    invalid("public report drafts must use the fixed public edition");
  }
  assertReport(snapshot.report);
  assertSource(snapshot.source);
  assertAttachments(snapshot.attachments);
  exactKeys(
    snapshot.classification,
    ["containsOfficeText", "containsInternalInformation", "isSecurityOrPrivacyIssue"],
    "classification",
  );
  for (const value of Object.values(snapshot.classification)) {
    if (typeof value !== "boolean") invalid("classification values must be boolean");
  }
  return snapshot;
}

export function assertDraftInput(input) {
  return assertDraftSnapshot(snapshotPlainData(input));
}

export function assertConfirmationInput(input) {
  try {
    const snapshot = snapshotPlainData(input);
    exactKeys(
      snapshot,
      ["draftId", "previewDigest", "githubIdentity"],
      "confirmation",
    );
    text(snapshot.draftId, "confirmation.draftId", { max: 200 });
    if (!SHA256.test(snapshot.previewDigest)) {
      invalid("confirmation.previewDigest must be SHA-256");
    }
    exactKeys(snapshot.githubIdentity, ["login"], "confirmation.githubIdentity");
    text(snapshot.githubIdentity.login, "confirmation.githubIdentity.login", { max: 39 });
    return snapshot;
  } catch (error) {
    if (error instanceof ReportToIssueError) {
      throw new ReportToIssueError(
        "invalid_confirmation",
        "confirmation must contain only the draft, preview digest, and GitHub login",
      );
    }
    throw error;
  }
}

function invalidAction(code, message) {
  throw new ReportToIssueError(code, message);
}

function snapshotAction(input, keys, code, message) {
  let snapshot;
  try {
    snapshot = snapshotPlainData(input);
    exactKeys(snapshot, keys, "request");
  } catch (error) {
    if (error instanceof ReportToIssueError) invalidAction(code, message);
    throw error;
  }
  return snapshot;
}

export function assertCorrectionInput(input) {
  const snapshot = snapshotAction(
    input,
    ["draftId", "expectedRevision", "replacement", "reason"],
    "invalid_correction",
    "correction must contain only a draft, revision, replacement, and reason code",
  );
  try {
    text(snapshot.draftId, "correction.draftId", { max: 200 });
    if (!Number.isSafeInteger(snapshot.expectedRevision) || snapshot.expectedRevision < 1) {
      invalid("correction.expectedRevision must be a positive integer");
    }
    if (snapshot.reason !== "user_correction") invalid("correction reason is unsupported");
    assertDraftSnapshot(snapshot.replacement);
  } catch (error) {
    if (error instanceof ReportToIssueError) {
      invalidAction(
        "invalid_correction",
        "correction must contain only a draft, revision, replacement, and reason code",
      );
    }
    throw error;
  }
  return snapshot;
}

export function assertRevocationInput(input) {
  const snapshot = snapshotAction(
    input,
    ["receiptId", "reason"],
    "invalid_revocation",
    "revocation must contain only a receipt and supported reason code",
  );
  if (typeof snapshot.receiptId !== "string" || snapshot.receiptId.trim() === "") {
    invalidAction("invalid_revocation", "revocation receipt is invalid");
  }
  if (snapshot.reason !== "user_revoked") {
    invalidAction("invalid_revocation_reason", "revocation reason is unsupported");
  }
  return snapshot;
}

export function assertReceiptActionInput(input) {
  const snapshot = snapshotAction(
    input,
    ["receiptId"],
    "invalid_receipt_request",
    "receipt request must contain only a receipt identifier",
  );
  if (
    typeof snapshot.receiptId !== "string" ||
    snapshot.receiptId.trim() === "" ||
    snapshot.receiptId.length > 200
  ) {
    invalidAction("invalid_receipt_request", "receipt request is invalid");
  }
  return snapshot;
}

export function assertPrivateScanResponse(input) {
  const snapshot = snapshotAction(
    input,
    ["status", "scannerVersion", "denylistDigest", "findingCodes"],
    "invalid_private_scan_response",
    "private scanner returned an invalid bounded receipt",
  );
  try {
    if (!["passed", "blocked"].includes(snapshot.status)) invalid("scan status is invalid");
    text(snapshot.scannerVersion, "privateScan.scannerVersion", { max: 100 });
    if (!SHA256.test(snapshot.denylistDigest)) invalid("denylist digest is invalid");
    if (!Array.isArray(snapshot.findingCodes) || snapshot.findingCodes.length > 50) {
      invalid("finding codes must be bounded");
    }
    for (const code of snapshot.findingCodes) {
      if (typeof code !== "string" || !/^[a-z0-9][a-z0-9_-]{0,99}$/u.test(code)) {
        invalid("finding code is invalid");
      }
    }
    if (snapshot.status === "passed" && snapshot.findingCodes.length !== 0) {
      invalid("a passed private scan cannot contain findings");
    }
  } catch (error) {
    if (error instanceof ReportToIssueError) {
      invalidAction(
        "invalid_private_scan_response",
        "private scanner returned an invalid bounded receipt",
      );
    }
    throw error;
  }
  return snapshot;
}
