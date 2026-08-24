import assert from "node:assert/strict";
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

test("unclassified free-form report text fails closed without a private denylist scanner", async () => {
  const workbench = createPublicCandidateWorkbench({
    store: memoryStore(),
    localPrivacyScanner: createLocalReportPrivacyScanner(),
  });
  const unclassifiedMarker = "UNCLASSIFIED_SYNTHETIC_REPORT_TEXT";

  const created = await workbench.draftReport({
    candidateId: "synthetic-candidate-01",
    title: unclassifiedMarker,
    body: unclassifiedMarker,
  });

  assert.equal(created.draft.privacy.status, "blocked");
  assert.equal(JSON.stringify(created).includes(unclassifiedMarker), false);
  assert.equal(
    created.draft.privacy.privateScan.findingCodes.includes("private_denylist_unavailable"),
    true,
  );
  await assert.rejects(
    workbench.confirmReport({
      draftId: created.draft.id,
      previewDigest: created.draft.previewDigest,
      acknowledgement: "CONFIRM_LOCAL_DRAFT",
    }),
    (error) => error.code === "privacy_blocked",
  );
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
    title: "Synthetic local preview",
    body: "This local-only report has no private content.",
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
