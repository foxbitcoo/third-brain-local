import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createLocalReportPrivacyScanner } from "../src/local-report-privacy.mjs";
import { createPublicCandidateWorkbench } from "../src/public-workbench.mjs";
import { createInMemoryReportStore, createReportToIssueService } from "../src/report-to-issue/index.mjs";

function memoryStore() {
  const values = new Map();
  return {
    async read(key) { return values.has(key) ? structuredClone(values.get(key)) : undefined; },
    async write(key, value) { values.set(key, structuredClone(value)); },
  };
}

function passingScanner(calls = []) {
  return {
    scan(envelope) {
      calls.push(envelope);
      return {
        status: "passed",
        coverage: "private_denylist",
        scannerVersion: "synthetic-public-denylist/v1",
        denylistDigest: "f".repeat(64),
        findingCodes: [],
      };
    },
  };
}

test("generic-only clean report requires explicit manual review acknowledgement before local confirmation", async () => {
  const store = memoryStore();
  const workbench = createPublicCandidateWorkbench({
    store,
    localPrivacyScanner: createLocalReportPrivacyScanner(),
  });
  const unclassifiedMarker = "UNCLASSIFIED_SYNTHETIC_REPORT_TEXT";

  const created = await workbench.draftReport({
    candidateId: "synthetic-candidate-01",
    title: unclassifiedMarker,
    body: unclassifiedMarker,
  });

  assert.equal(created.draft.privacy.status, "manual_review_required");
  assert.equal(created.draft.privacy.privateScan.coverage, "generic_patterns_only");
  assert.deepEqual(created.draft.privacy.privateScan.findingCodes, []);
  assert.equal(created.preview.title, unclassifiedMarker);
  assert.match(created.preview.body, new RegExp(unclassifiedMarker, "u"));
  await assert.rejects(
    workbench.readLatestReport({ candidateId: "synthetic-candidate-01" }),
    (error) => error.code === "draft_not_found",
  );
  assert.equal(JSON.stringify(await store.read("public-workbench") ?? {}).includes(unclassifiedMarker), false);
  await assert.rejects(
    workbench.confirmReport({
      draftId: created.draft.id,
      previewDigest: created.draft.previewDigest,
      acknowledgement: "CONFIRM_LOCAL_DRAFT",
    }),
    (error) => error.code === "manual_review_acknowledgement_required",
  );
  await assert.rejects(
    workbench.readLatestReport({ candidateId: "synthetic-candidate-01" }),
    (error) => error.code === "draft_not_found",
  );
  const confirmed = await workbench.confirmReport({
    draftId: created.draft.id,
    previewDigest: created.draft.previewDigest,
    acknowledgement: "CONFIRM_LOCAL_DRAFT",
    privacyAcknowledgement: "ACKNOWLEDGE_PRIVATE_IDENTIFIERS_NOT_FULLY_VERIFIED",
  });
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.submission, "NOT_IMPLEMENTED");
  assert.equal(
    confirmed.receipt.privacyAcknowledgement,
    "ACKNOWLEDGE_PRIVATE_IDENTIFIERS_NOT_FULLY_VERIFIED",
  );
  const reloaded = await workbench.readLatestReport({ candidateId: "synthetic-candidate-01" });
  assert.equal(reloaded.draft.privacy.status, "manual_review_required");
  const history = await workbench.readReportHistory({ draftId: created.draft.id });
  assert.deepEqual(history.history.events.map((event) => event.type), ["confirmed"]);
  const revoked = await workbench.revokeReportConfirmation({ receiptId: confirmed.receipt.receiptId });
  assert.equal(revoked.submission, "NOT_IMPLEMENTED");
});

test("public report facade fixes target/source and keeps local lifecycle receipts immutable", async () => {
  const calls = [];
  const workbench = createPublicCandidateWorkbench({
    store: memoryStore(),
    now: () => new Date("2026-08-24T12:00:00.000Z"),
    localPrivacyScanner: passingScanner(calls),
  });

  const created = await workbench.draftReport({
    candidateId: "synthetic-candidate-01",
    title: "USER_ENTERED_SYNTHETIC_TITLE",
    body: "USER_ENTERED_SYNTHETIC_BODY",
  });
  assert.equal(created.submission, "NOT_IMPLEMENTED");
  assert.equal(created.draft.target.repository, "foxbitcoo/third-brain-local");
  assert.equal(created.draft.source.branch, "public-local-workbench");
  assert.equal(created.draft.source.files[0].path, "public/synthetic-candidates/synthetic-candidate-01.json");
  assert.equal(created.draft.source.commit, "35e02f1881c657266b1adc000577d7b54fac00c73df864847ffef3725ed396b4");
  assert.equal(created.draft.source.files[0].contentDigest, "1c53f851fb663df1915114d5bd936226da44d8288a19fd0eaa6011522a879a23");
  assert.equal(created.draft.privacy.status, "passed");
  assert.equal(Object.isFrozen(calls[0]), true);
  assert.equal(calls[0].target.repository, "foxbitcoo/third-brain-local");
  assert.equal(calls[0].issue.title, "USER_ENTERED_SYNTHETIC_TITLE");
  assert.match(calls[0].issue.body, /USER_ENTERED_SYNTHETIC_BODY/u);

  const loaded = await workbench.readReport({ draftId: created.draft.id });
  const latest = await workbench.readLatestReport({ candidateId: "synthetic-candidate-01" });
  assert.deepEqual(loaded.draft, created.draft);
  assert.deepEqual(latest.draft, created.draft);

  const confirmed = await workbench.confirmReport({
    draftId: created.draft.id,
    previewDigest: created.draft.previewDigest,
    acknowledgement: "CONFIRM_LOCAL_DRAFT",
  });
  assert.equal(confirmed.submission, "NOT_IMPLEMENTED");
  assert.match(confirmed.receipt.bindingDigest, /^[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(confirmed.receipt), true);
  assert.equal(Object.hasOwn(confirmed.receipt, "privacyAcknowledgement"), false);

  const corrected = await workbench.correctReport({
    draftId: created.draft.id,
    expectedRevision: 1,
    candidateId: "synthetic-candidate-01",
    title: "Synthetic local preview corrected",
    body: "A corrected synthetic local-only report.",
  });
  assert.equal(corrected.draft.revision, 2);
  assert.notEqual(corrected.draft.previewDigest, created.draft.previewDigest);

  const revoked = await workbench.revokeReportConfirmation({ receiptId: confirmed.receipt.receiptId });
  assert.equal(revoked.submission, "NOT_IMPLEMENTED");
  assert.equal(revoked.revocation.bindingDigest, confirmed.receipt.bindingDigest);
  const history = await workbench.readReportHistory({ draftId: created.draft.id });
  assert.deepEqual(history.history.events.map((event) => event.type), ["confirmed", "corrected", "revoked"]);
  assert.deepEqual(history.history.confirmations, [confirmed.receipt]);
});

test("generic finding remains blocked even when manual review acknowledgement is supplied", async () => {
  const workbench = createPublicCandidateWorkbench({
    store: memoryStore(),
    localPrivacyScanner: createLocalReportPrivacyScanner(),
  });
  const created = await workbench.draftReport({
    candidateId: "synthetic-candidate-01",
    title: "Synthetic local preview",
    body: "api_key=sample-placeholder",
  });

  assert.equal(created.draft.privacy.status, "blocked");
  assert.equal(JSON.stringify(created).includes("sample-placeholder"), false);
  await assert.rejects(
    workbench.confirmReport({
      draftId: created.draft.id,
      previewDigest: created.draft.previewDigest,
      acknowledgement: "CONFIRM_LOCAL_DRAFT",
      privacyAcknowledgement: "ACKNOWLEDGE_PRIVATE_IDENTIFIERS_NOT_FULLY_VERIFIED",
    }),
    (error) => error.code === "privacy_blocked",
  );
});

test("invalid or contradictory scanner receipts fail closed without preserving report narrative", async () => {
  const workbench = createPublicCandidateWorkbench({
    store: memoryStore(),
    localPrivacyScanner: {
      scan() {
        return {
          status: "passed",
          scannerVersion: "contradictory-scanner/v1",
          denylistDigest: "e".repeat(64),
          findingCodes: ["private_denylist_match"],
        };
      },
    },
  });
  const privateMarker = "SYNTHETIC_PRIVATE_MARKER";
  const created = await workbench.draftReport({
    candidateId: "synthetic-candidate-02",
    title: privateMarker,
    body: privateMarker,
  });
  assert.equal(created.draft.privacy.status, "blocked");
  assert.equal(JSON.stringify(created).includes(privateMarker), false);
  await assert.rejects(
    workbench.confirmReport({
      draftId: created.draft.id,
      previewDigest: created.draft.previewDigest,
      acknowledgement: "CONFIRM_LOCAL_DRAFT",
    }),
    (error) => error.code === "privacy_blocked",
  );
});

test("legacy generic-only scan receipts cannot confirm a persisted report", async () => {
  const values = new Map();
  const store = {
    async read(key) { return values.has(key) ? structuredClone(values.get(key)) : undefined; },
    async write(key, value) { values.set(key, structuredClone(value)); },
  };
  const workbench = createPublicCandidateWorkbench({
    store,
    localPrivacyScanner: passingScanner(),
  });
  const created = await workbench.draftReport({
    candidateId: "synthetic-candidate-03",
    title: "Synthetic local preview",
    body: "Neutral synthetic report content.",
  });
  const persisted = values.get("public-workbench");
  delete persisted.reportRecords[0].current.privacy.privateScan.coverage;
  persisted.reportRecords[0].current.privacy.privateScan.scannerVersion = "generic-local-rules-v1";
  values.set("public-workbench", persisted);

  await assert.rejects(
    workbench.confirmReport({
      draftId: created.draft.id,
      previewDigest: created.draft.previewDigest,
      acknowledgement: "CONFIRM_LOCAL_DRAFT",
    }),
    (error) => error.code === "privacy_blocked",
  );
});

test("public report core has no GitHub submission boundary", () => {
  const service = createReportToIssueService({ store: createInMemoryReportStore() });
  assert.equal("submitConfirmed" in service, false);
  assert.equal("reconcileUnknownSubmission" in service, false);
  assert.throws(
    () => createReportToIssueService({
      store: createInMemoryReportStore(),
      githubSubmitPort: { createIssue() {} },
    }),
    /does not accept a GitHub submit port/u,
  );
});

test("public workbench keeps source import on the sources route and renders only neutral relationship language", async () => {
  const [page, script] = await Promise.all([
    readFile(path.resolve(import.meta.dirname, "..", "public", "index.html"), "utf8"),
    readFile(path.resolve(import.meta.dirname, "..", "public", "workbench-ui.js"), "utf8"),
  ]);

  assert.match(script, /sources: \["sources", "sourceImport"\]/u);
  assert.match(page, /id="sourceImport"/u);
  assert.match(page, /\.workspace-overview\[hidden\]\{display:none\}/u);
  assert.doesNotMatch(page, /关系 · 原始候选分析/u);
  assert.match(page, /关系 · 中性合成视图/u);
  assert.doesNotMatch(page, /(?:真实姓名|部门|汇报线)/u);
});

test("decisions route restores explicit analysis, four judgments, and complete or truncated source feedback", async () => {
  const [page, script] = await Promise.all([
    readFile(path.resolve(import.meta.dirname, "..", "public", "index.html"), "utf8"),
    readFile(path.resolve(import.meta.dirname, "..", "public", "workbench-ui.js"), "utf8"),
  ]);

  assert.match(script, /decisions: \["analysisPanel", "decisions"\]/u);
  assert.match(page, /id="analysisPanel"/u);
  assert.match(page, /id="analyze"/u);
  assert.match(script, /\/api\/analyze/u);
  assert.match(script, /\/api\/judgments/u);
  for (const [key, label] of [
    ["important", "重要"],
    ["related", "相关但非重点"],
    ["noise", "噪声"],
    ["uncertain", "不确定"],
  ]) {
    assert.match(script, new RegExp(key + ': "' + label + '"', "u"));
  }
  assert.match(script, /result\.completeness\?\.complete/u);
  assert.match(script, /result\.hiddenPrivateChats/u);
  assert.match(script, /result\.complete \? "（完整）" : "（存在截断，已禁止分析）"/u);
  assert.match(script, /source\.completeness\.complete/u);
  assert.match(script, /analyze"\)\.disabled = !status\.importedMessages \|\| !status\.importComplete/u);
});

test("public workbench UI provides local report history, correction, revocation, and refresh readback", async () => {
  const page = (await readFile(path.resolve(import.meta.dirname, "..", "public", "index.html"), "utf8"))
    + (await readFile(path.resolve(import.meta.dirname, "..", "public", "workbench-ui.js"), "utf8"));

  for (const capability of ["refreshReport", "readReportHistory", "correctReport", "revokeReportConfirmation"]) {
    assert.match(page, new RegExp("window\\." + capability + "=async", "u"));
  }
  assert.match(page, /reports\/correct/u);
  assert.match(page, /reports\/revoke/u);
  assert.match(page, /report-history/u);
  assert.match(page, /外部提交：NOT_IMPLEMENTED/u);
  assert.match(page, /confirmation\.draftRevision === history\.history\.currentRevision/u);
  assert.match(page, /revokedReceiptIds\.has\(confirmation\.receiptId\)/u);
});

test("generic-only report UI shows full preview and requires a separate incomplete-coverage acknowledgement", async () => {
  const page = (await readFile(path.resolve(import.meta.dirname, "..", "public", "index.html"), "utf8"))
    + (await readFile(path.resolve(import.meta.dirname, "..", "public", "workbench-ui.js"), "utf8"));

  assert.match(page, /manual_review_required/u);
  assert.match(page, /私人标识未完全自动验证/u);
  assert.match(page, /ACKNOWLEDGE_PRIVATE_IDENTIFIERS_NOT_FULLY_VERIFIED/u);
  assert.match(page, /type=\\"checkbox\\"/u);
  assert.doesNotMatch(page, /manual_review_required[^]{0,500}(?:>passed<|>VERIFIED<)/u);
});
