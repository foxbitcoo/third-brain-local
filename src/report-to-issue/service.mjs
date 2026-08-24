import { randomUUID } from "node:crypto";

import { canonicalDigest, canonicalJson, immutableCopy } from "./canonical.mjs";
import {
  assertConfirmationInput,
  assertCorrectionInput,
  assertDraftInput,
  assertPrivateScanResponse,
  assertReceiptActionInput,
  assertRevocationInput,
  snapshotPlainData,
} from "./contracts.mjs";
import { ReportToIssueError } from "./errors.mjs";
import { scanAndSanitizeReport } from "./privacy.mjs";

const PUBLIC_TARGET = "foxbitcoo/third-brain-local";

function renderBody(report) {
  return [
    "## Reproduction steps",
    ...report.reproductionSteps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Expected result",
    report.expectedResult,
    "",
    "## Actual result",
    report.actualResult,
    "",
    "## Diagnostics",
    `- Version: ${report.diagnostics.version}`,
    `- Operating system: ${report.diagnostics.operatingSystem}`,
    `- Install method: ${report.diagnostics.installMethod}`,
    `- Failed stage: ${report.diagnostics.failedStage}`,
    `- Error code: ${report.diagnostics.errorCode}`,
  ].join("\n");
}

function privateScanEnvelope({ edition, repository, issue, source, attachments }) {
  return immutableCopy({
    schemaVersion: "report-private-scan-input/v1",
    edition,
    target: { repository },
    issue,
    source,
    attachments: attachments.map((attachment) => ({
      name: attachment.name,
      kind: attachment.kind,
      mediaType: attachment.mediaType,
      contentDigest: attachment.contentDigest,
    })),
  });
}

function redactedBlockedPreview(scan, input, findingCode) {
  return {
    issue: {
      title: "Local report requires private review",
      body: [
        "## Privacy gate",
        "The local private scanner blocked this preview from confirmation.",
      ].join("\n"),
    },
    source: {
      branch: "redacted",
      commit: input.source.commit,
      files: input.source.files.map((file, index) => ({
        path: `redacted/file-${index + 1}`,
        contentDigest: file.contentDigest,
        diffDigest: file.diffDigest,
      })),
    },
    attachments: [],
    findings: [
      ...scan.findings,
      { code: findingCode, field: "rendered_preview", action: "removed_and_blocked" },
    ],
  };
}

function createPreview(
  input,
  { createdAt, draftId, localPrivacyScanner, revision = 1, updatedAt = createdAt },
) {
  const repository = PUBLIC_TARGET;
  const scan = scanAndSanitizeReport(input);
  let issue = {
    title: scan.report.title,
    body: renderBody(scan.report),
  };
  let source = immutableCopy(input.source);
  let attachments = immutableCopy(scan.attachments);
  const envelope = privateScanEnvelope({
    edition: input.edition,
    repository,
    issue,
    source,
    attachments,
  });
  const scannedDigest = canonicalDigest("third-brain/report-private-scan-input/v1", envelope);
  let privateScan = {
    status: "required",
    coverage: "unavailable",
    scannerVersion: "host_scanner_unavailable",
    denylistDigest: "0".repeat(64),
    findingCodes: ["private_scan_required"],
    scannedDigest,
  };
  if (localPrivacyScanner !== undefined) {
    try {
      const response = assertPrivateScanResponse(localPrivacyScanner.scan(envelope));
      privateScan = { ...response, scannedDigest };
    } catch {
      privateScan = {
        status: "blocked",
        coverage: "unavailable",
        scannerVersion: "host_scanner_invalid",
        denylistDigest: "0".repeat(64),
        findingCodes: ["private_scanner_failed_closed"],
        scannedDigest,
      };
    }
  }
  const privateScanPassed = privateScan.status === "passed"
    && privateScan.coverage === "private_denylist";
  const privateScanNeedsManualReview = privateScan.status === "manual_review_required"
    && privateScan.coverage === "generic_patterns_only"
    && privateScan.findingCodes.length === 0;
  let findings = immutableCopy(scan.findings);
  if (scan.status === "blocked" || (!privateScanPassed && !privateScanNeedsManualReview)) {
    const redacted = redactedBlockedPreview(
      scan,
      input,
      privateScan.status === "required" ? "private_scan_required" : "private_scanner_blocked",
    );
    issue = redacted.issue;
    source = redacted.source;
    attachments = redacted.attachments;
    findings = immutableCopy(redacted.findings);
  }
  const privacyStatus = scan.status === "blocked"
    ? "blocked"
    : privateScan.status === "required"
      ? "pending_private_scan"
      : privateScanPassed
        ? "passed"
        : privateScanNeedsManualReview
          ? "manual_review_required"
          : "blocked";
  const preview = {
    schemaVersion: "report-to-issue-draft/v1",
    draftId,
    revision,
    createdAt,
    updatedAt,
    edition: input.edition,
    status: "preview_only",
    target: { repository },
    source,
    attachments,
    issue,
    privacy: {
      status: privacyStatus,
      findings,
      privateScan: immutableCopy(privateScan),
      scanDigest: canonicalDigest("third-brain/report-privacy-scan/v1", {
        repository,
        issue,
        source,
        attachments,
        builtInStatus: scan.status,
        privateScan,
      }),
    },
    previewDigest: canonicalDigest("third-brain/report-preview/v1", {
      repository,
      issue,
      source,
      attachments,
    }),
    sideEffects: { githubIssueCreated: false },
  };
  return immutableCopy(preview);
}

export { ReportToIssueError };

function assertGithubIdentity(identity) {
  if (
    identity === null ||
    typeof identity !== "object" ||
    Array.isArray(identity) ||
    Object.keys(identity).length !== 1 ||
    typeof identity.login !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(identity.login)
  ) {
    throw new ReportToIssueError(
      "invalid_github_identity",
      "confirmation requires the current user's GitHub login without credentials",
    );
  }
}

function createConfirmationReceipt(record, input, { confirmedAt, receiptId }) {
  const draft = record.current;
  assertGithubIdentity(input.githubIdentity);
  if (input.previewDigest !== draft.previewDigest) {
    throw new ReportToIssueError(
      "confirmation_mismatch",
      "the confirmation does not match the current report preview",
    );
  }
  const bound = {
    schemaVersion: "report-confirmation-receipt/v1",
    receiptId,
    draftId: draft.draftId,
    draftRevision: draft.revision,
    confirmedAt,
    actor: {
      provider: "github_user",
      login: input.githubIdentity.login,
    },
    target: immutableCopy(draft.target),
    source: immutableCopy(draft.source),
    attachments: draft.attachments.map((attachment) => ({
      name: attachment.name,
      kind: attachment.kind,
      mediaType: attachment.mediaType,
      contentDigest: attachment.contentDigest,
    })),
    issue: {
      titleDigest: canonicalDigest("third-brain/report-issue-title/v1", draft.issue.title),
      bodyDigest: canonicalDigest("third-brain/report-issue-body/v1", draft.issue.body),
    },
    privacyScanDigest: draft.privacy.scanDigest,
    ...(draft.privacy.status === "manual_review_required"
      ? { privacyAcknowledgement: input.privacyAcknowledgement }
      : {}),
    previewDigest: draft.previewDigest,
  };
  return immutableCopy({
    ...bound,
    bindingDigest: canonicalDigest("third-brain/report-confirmation-binding/v1", bound),
  });
}

function assertReceiptBinding(receipt, expectedBindingDigest) {
  let snapshot;
  try {
    snapshot = snapshotPlainData(receipt);
  } catch {
    throw new ReportToIssueError(
      "confirmation_stale_or_tampered",
      "report confirmation receipt has an invalid immutable binding",
    );
  }
  const { bindingDigest, ...bound } = snapshot;
  const expected = expectedBindingDigest ?? bindingDigest;
  if (
    bindingDigest !== expected ||
    bindingDigest !== canonicalDigest("third-brain/report-confirmation-binding/v1", bound)
  ) {
    throw new ReportToIssueError(
      "confirmation_stale_or_tampered",
      "report confirmation receipt has an invalid immutable binding",
    );
  }
  return snapshot;
}

function assertReceiptMatchesCurrent(record, receipt) {
  const snapshot = assertReceiptBinding(receipt);
  const expected = createConfirmationReceipt(
    record,
    {
      previewDigest: record.current.previewDigest,
      githubIdentity: { login: snapshot.actor.login },
      ...(Object.hasOwn(snapshot, "privacyAcknowledgement")
        ? { privacyAcknowledgement: snapshot.privacyAcknowledgement }
        : {}),
    },
    { confirmedAt: snapshot.confirmedAt, receiptId: snapshot.receiptId },
  );
  if (
    snapshot.draftRevision !== record.current.revision ||
    snapshot.previewDigest !== record.current.previewDigest ||
    canonicalJson(snapshot) !== canonicalJson(expected)
  ) {
    throw new ReportToIssueError(
      "confirmation_stale_or_tampered",
      "report confirmation does not match the current immutable preview",
    );
  }
  return snapshot;
}

function assertGithubSubmissionResponse(response, repository) {
  let snapshot;
  try {
    snapshot = snapshotPlainData(response);
  } catch {
    throw new ReportToIssueError(
      "invalid_github_response",
      "host-owned GitHub port returned an invalid issue reference",
    );
  }
  const valid =
    snapshot !== null &&
    typeof snapshot === "object" &&
    !Array.isArray(snapshot) &&
    Object.keys(snapshot).length === 3 &&
    snapshot.repository === repository &&
    Number.isSafeInteger(snapshot.issueNumber) &&
    snapshot.issueNumber > 0 &&
    snapshot.issueUrl === `https://github.com/${repository}/issues/${snapshot.issueNumber}`;
  if (!valid) {
    throw new ReportToIssueError(
      "invalid_github_response",
      "host-owned GitHub port returned an invalid issue reference",
    );
  }
  return snapshot;
}

export function createReportToIssueService(options) {
  if (options?.store === undefined) throw new TypeError("report store is required");
  if (options?.githubSubmitPort !== undefined) {
    throw new TypeError("the public local report core does not accept a GitHub submit port");
  }
  if (
    options.localPrivacyScanner !== undefined &&
    typeof options.localPrivacyScanner?.scan !== "function"
  ) {
    throw new TypeError("host-provided local privacy scanner must expose scan");
  }
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? ((kind) => `${kind}_${randomUUID()}`);

  return Object.freeze({
    createDraft(input) {
      const snapshot = assertDraftInput(input);
      const createdAt = now();
      const preview = createPreview(snapshot, {
        createdAt,
        draftId: createId("draft"),
        localPrivacyScanner: options.localPrivacyScanner,
      });
      options.store.save({
        schemaVersion: "report-to-issue-record/v1",
        draftId: preview.draftId,
        current: preview,
        confirmations: [],
        revocations: [],
        submissions: [],
        history: [],
      });
      return immutableCopy(preview);
    },
    readDraft(draftId) {
      const record = options.store.load(draftId);
      if (record === null) throw new TypeError("report draft was not found");
      return immutableCopy(record.current);
    },
    confirmDraft(input) {
      const snapshot = assertConfirmationInput(input);
      const { draftId } = snapshot;
      const record = options.store.load(draftId);
      if (record === null) throw new ReportToIssueError("draft_not_found", "report draft was not found");
      const strictPrivacyPassed = record.current.privacy.status === "passed"
        && record.current.privacy.privateScan?.coverage === "private_denylist";
      const manualReviewAllowed = record.current.privacy.status === "manual_review_required"
        && record.current.privacy.privateScan?.coverage === "generic_patterns_only"
        && record.current.privacy.privateScan?.findingCodes?.length === 0;
      if (!strictPrivacyPassed && !manualReviewAllowed) {
        const code = record.current.privacy.status === "pending_private_scan"
          ? "private_scan_required"
          : "privacy_blocked";
        throw new ReportToIssueError(
          code,
          "报告未通过本地隐私门禁，不能确认",
        );
      }
      if (
        manualReviewAllowed &&
        snapshot.privacyAcknowledgement !== "ACKNOWLEDGE_PRIVATE_IDENTIFIERS_NOT_FULLY_VERIFIED"
      ) {
        throw new ReportToIssueError(
          "manual_review_acknowledgement_required",
          "必须明确承认私人标识未完全自动验证后，才能保存本地草稿",
        );
      }
      assertGithubIdentity(snapshot.githubIdentity);
      const existing = record.confirmations.find((item) =>
        item.draftRevision === record.current.revision &&
        item.previewDigest === snapshot.previewDigest &&
        item.actor.login === snapshot.githubIdentity.login);
      if (existing !== undefined) {
        if (record.revocations.some((item) => item.receiptId === existing.receiptId)) {
          throw new ReportToIssueError(
            "confirmation_revoked",
            "the matching report confirmation receipt was revoked",
          );
        }
        return immutableCopy(existing);
      }
      const receipt = createConfirmationReceipt(record, snapshot, {
        confirmedAt: now(),
        receiptId: createId("confirmation"),
      });
      options.store.save({
        ...record,
        confirmations: [...record.confirmations, receipt],
        history: [
          ...record.history,
          {
            type: "confirmed",
            occurredAt: receipt.confirmedAt,
            receiptId: receipt.receiptId,
            draftRevision: receipt.draftRevision,
            bindingDigest: receipt.bindingDigest,
          },
        ],
      });
      return immutableCopy(receipt);
    },
    readConfirmationReceipt(receiptId) {
      const record = options.store.loadByReceipt(receiptId);
      const receipt = record?.confirmations.find((item) => item.receiptId === receiptId);
      if (receipt === undefined) {
        throw new ReportToIssueError(
          "confirmation_not_found",
          "report confirmation receipt was not found",
        );
      }
      return immutableCopy(receipt);
    },
    correctDraft(input) {
      const request = assertCorrectionInput(input);
      const { draftId, expectedRevision, replacement, reason } = request;
      const record = options.store.load(draftId);
      if (record === null) {
        throw new ReportToIssueError("draft_not_found", "report draft was not found");
      }
      if (record.current.revision !== expectedRevision) {
        throw new ReportToIssueError(
          "revision_mismatch",
          "the correction does not target the current draft revision",
        );
      }
      const updatedAt = now();
      const corrected = createPreview(replacement, {
        createdAt: record.current.createdAt,
        updatedAt,
        draftId,
        localPrivacyScanner: options.localPrivacyScanner,
        revision: record.current.revision + 1,
      });
      options.store.save({
        ...record,
        current: corrected,
        history: [
          ...record.history,
          {
            type: "corrected",
            occurredAt: updatedAt,
            fromRevision: record.current.revision,
            toRevision: corrected.revision,
            fromPreviewDigest: record.current.previewDigest,
            toPreviewDigest: corrected.previewDigest,
            reason,
          },
        ],
      });
      return immutableCopy(corrected);
    },
    revokeConfirmation(input) {
      const { receiptId, reason } = assertRevocationInput(input);
      const record = options.store.loadByReceipt(receiptId);
      const receipt = record?.confirmations.find((item) => item.receiptId === receiptId);
      if (receipt === undefined) {
        throw new ReportToIssueError(
          "confirmation_not_found",
          "report confirmation receipt was not found",
        );
      }
      if (record.revocations.some((item) => item.receiptId === receiptId)) {
        throw new ReportToIssueError(
          "confirmation_revoked",
          "report confirmation receipt is already revoked",
        );
      }
      const revokedAt = now();
      const revocationContent = {
        schemaVersion: "report-confirmation-revocation/v1",
        receiptId,
        bindingDigest: receipt.bindingDigest,
        revokedAt,
        reason,
      };
      const revocation = immutableCopy({
        ...revocationContent,
        revocationDigest: canonicalDigest(
          "third-brain/report-confirmation-revocation/v1",
          revocationContent,
        ),
      });
      options.store.save({
        ...record,
        revocations: [...record.revocations, revocation],
        history: [
          ...record.history,
          {
            type: "revoked",
            occurredAt: revokedAt,
            receiptId,
            bindingDigest: receipt.bindingDigest,
            revocationDigest: revocation.revocationDigest,
          },
        ],
      });
      return immutableCopy(revocation);
    },
    readConfirmationHistory(draftId) {
      const record = options.store.load(draftId);
      if (record === null) {
        throw new ReportToIssueError("draft_not_found", "report draft was not found");
      }
      return immutableCopy({
        schemaVersion: "report-confirmation-history/v1",
        draftId,
        currentRevision: record.current.revision,
        confirmations: record.confirmations,
        revocations: record.revocations,
        submissions: record.submissions,
        events: record.history,
      });
    },
  });
}
