// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createEncryptedLocalStore } from "../src/encrypted-store.mjs";
import {
  buildSourceEvidence,
  createBcCandidatePipeline,
} from "../src/public-signal-pipeline.mjs";
import { createLocalTrialRuntime } from "../src/local-runtime.mjs";
import { createLocalReportService } from "../src/report-to-issue.mjs";
import {
  createPublicationReceipt,
  verifyPublicationReceipt,
} from "../scripts/publication-receipt.mjs";

const iso = (minute) => `2026-01-01T09:${String(minute).padStart(2, "0")}:00.000Z`;

test("私聊与群聊消息形成不暴露原始定位符的稳定 Evidence", () => {
  const direct = buildSourceEvidence({
    installationId: "installation_test",
    conversation: { id: "source-direct", name: "", conversationKind: "direct" },
    message: { id: "item-1", occurredAt: iso(0), senderRef: "opaque-source-person", senderName: "", text: "已确认在指定时间完成处理。" },
  });
  const group = buildSourceEvidence({
    installationId: "installation_test",
    conversation: { id: "source-group", name: "", conversationKind: "group" },
    message: { id: "item-2", occurredAt: iso(1), senderName: "", text: "下一步在指定时间复核。" },
  });

  assert.equal(direct.conversationKind, "direct");
  assert.equal(direct.visibility, "personal-only");
  assert.equal(group.conversationKind, "group");
  assert.equal(group.visibility, "source-members");
  assert.equal(group.identity.status, "unresolved");
  assert.match(direct.evidenceId, /^evidence_[a-f0-9]{24}$/u);
  assert.match(direct.source.sourceId, /^[a-f0-9]{64}$/u);
  assert.match(direct.source.itemId, /^[a-f0-9]{64}$/u);
  assert.equal(direct.identity.status, "observed_source_identifier");
  assert.equal(JSON.stringify(direct).includes("opaque-source-person"), false);
  assert.equal(JSON.stringify(direct).includes("source-direct"), false);
  assert.equal(JSON.stringify(direct).includes("item-1"), false);
});

test("B 单条与 C 连续上下文并行抽取后按 Evidence 血缘去重", async () => {
  const conversation = { id: "source-opaque", name: "", conversationKind: "group" };
  const evidence = [0, 1].map((minute, index) => buildSourceEvidence({
    installationId: "installation_test",
    conversation,
    message: {
      id: `item-${index}`,
      occurredAt: iso(minute),
      senderName: "",
      text: index === 0 ? "是否可以在指定时间上线？" : "已确认在指定时间完成。",
    },
  }));
  const calls = [];
  const pipeline = createBcCandidatePipeline({
    analyze: async ({ strategy, units }) => {
      calls.push({ strategy, units });
      return {
        summary: "中性摘要",
        candidates: [{
          title: "时间安排待复核",
          latestChange: "出现明确时间安排。",
          background: "连续上下文补足对象。",
          uncertainty: "需要用户确认归属。",
          userDecision: "是否纳入当前工作？",
          semanticKey: "time-arrangement",
          evidenceIds: strategy === "B"
            ? [evidence[1].evidenceId]
            : evidence.map((item) => item.evidenceId),
        }],
      };
    },
  });

  const result = await pipeline.run(evidence);

  assert.deepEqual(calls.map((call) => call.strategy), ["B", "C"]);
  assert.equal(calls[0].units.length, 2);
  assert.equal(calls[1].units.length, 1);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].strategies, ["B", "C"]);
  assert.deepEqual(
    result.candidates[0].evidence.map((item) => item.evidenceId).toSorted(),
    evidence.map((item) => item.evidenceId).toSorted(),
  );
});

test("B/C 并行执行且单路失败时保留另一策略结果和已知缺口", async () => {
  const conversation = { id: "source-partial", name: "", conversationKind: "group" };
  const evidence = [0, 1].map((minute, index) => buildSourceEvidence({
    installationId: "installation_test",
    conversation,
    message: {
      id: `item-partial-${index}`,
      occurredAt: iso(minute),
      senderName: "",
      text: index === 0 ? "是否可以按计划上线？" : "可以按计划推进。",
    },
  }));
  const started = new Set();
  let release;
  const bothStarted = new Promise((resolve) => { release = resolve; });
  const pipeline = createBcCandidatePipeline({
    analyze: async ({ strategy, units }) => {
      started.add(strategy);
      if (started.size === 2) release();
      await bothStarted;
      if (strategy === "B") throw new Error("provider unavailable with private detail");
      return {
        summary: "连续上下文显示需要复核。",
        candidates: [{
          title: "上线安排待复核",
          semanticKey: "release-arrangement",
          evidenceIds: units.flatMap((unit) => unit.evidenceIds),
        }],
      };
    },
  });

  const result = await pipeline.run(evidence);
  assert.deepEqual([...started].toSorted(), ["B", "C"]);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].strategies, ["C"]);
  assert.deepEqual(result.knownGaps, [{
    strategy: "B",
    code: "strategy_failed",
    message: "B 策略分析失败；当前结果仅包含 C 策略。",
  }]);
  assert.deepEqual(result.provenance.strategies, [
    { strategy: "B", status: "failed", unitCount: 2, candidateCount: 0 },
    { strategy: "C", status: "complete", unitCount: 1, candidateCount: 1 },
  ]);
  assert.equal(JSON.stringify(result).includes("private detail"), false);
});

test("B/C 都失败时分析失败，不把空结果伪装成成功", async () => {
  const evidence = [buildSourceEvidence({
    installationId: "installation_test",
    conversation: { id: "source-failed", name: "", conversationKind: "direct" },
    message: { id: "item-failed", occurredAt: iso(0), senderName: "", text: "需要复核。" },
  })];
  const pipeline = createBcCandidatePipeline({
    async analyze() { throw new Error("unavailable"); },
  });
  await assert.rejects(pipeline.run(evidence), /B 与 C 策略均分析失败/u);
});

test("共享 Evidence 但 semanticKey 不同的候选保持分开", async () => {
  const evidence = [buildSourceEvidence({
    installationId: "installation_test",
    conversation: { id: "source-semantic", name: "", conversationKind: "group" },
    message: { id: "item-semantic", occurredAt: iso(0), senderName: "", text: "需要复核时间和风险。" },
  })];
  const pipeline = createBcCandidatePipeline({
    async analyze({ strategy }) {
      return {
        summary: `${strategy} 摘要`,
        candidates: [{
          title: strategy === "B" ? "时间安排待复核" : "风险待复核",
          semanticKey: strategy === "B" ? "time-arrangement" : "delivery-risk",
          evidenceIds: [evidence[0].evidenceId],
        }],
      };
    },
  });
  const result = await pipeline.run(evidence);
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates.map((item) => item.semanticKey).toSorted(), [
    "delivery-risk",
    "time-arrangement",
  ]);
  assert.equal(result.candidates.every((item) => item.strategies.length === 1), true);
});

test("真实导入候选必须先确认工作归属，再确认重要性并产生可回读涟漪", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "third-brain-public-ripple-"));
  const encryptedStore = await createEncryptedLocalStore({ root });
  let writeCount = 0;
  const store = {
    read: (name) => encryptedStore.read(name),
    async write(name, value) {
      writeCount += 1;
      return encryptedStore.write(name, value);
    },
  };
  await store.write("credentials", { accessToken: "installer-owned-token" });
  const runtime = createLocalTrialRuntime({
    config: { ready: true, wps: {} },
    store,
    oauth: {},
    now: () => new Date(iso(30)),
    wpsClientFactory: () => ({
      async listChats() {
        return {
          chats: [{ id: "source-direct", name: "", privateChat: true, groupChat: false, conversationKind: "direct" }],
          completeness: { complete: true },
        };
      },
      async getMessages() {
        return {
          messages: [{ id: "item-1", senderName: "", occurredAt: iso(0), text: "已确认在指定时间完成处理。" }],
          completeness: { complete: true },
        };
      },
    }),
    inference: {
      async analyze({ strategy, units }) {
        const ids = units.flatMap((unit) => unit.evidenceIds);
        return {
          summary: "中性摘要",
          candidates: [{
            title: "时间安排待复核",
            latestChange: "出现明确时间安排。",
            background: "上下文完整。",
            uncertainty: "需要用户确认归属。",
            userDecision: "是否纳入当前工作？",
            semanticKey: "time-arrangement",
            evidenceIds: [...new Set(ids)],
          }],
        };
      },
    },
  });

  await runtime.listChats();
  await runtime.importMessages({ chatIds: ["source-direct"], days: 1 });
  const analysis = await runtime.analyzeImportedMessages();
  const candidateId = analysis.candidates[0].candidateId;

  await assert.rejects(
    runtime.saveImportance({ candidateId, importance: "current_important" }),
    /先确认工作归属/u,
  );
  await runtime.saveOwnership({ candidateId, kind: "new_work_thread", threadTitle: "待复核事项" });
  writeCount = 0;
  const receipt = await runtime.saveImportance({ candidateId, importance: "current_important" });
  const readback = await runtime.readWorkspace();

  assert.equal(receipt.ripple.workEventCreated, true);
  assert.equal(writeCount, 1, "Decision、WorkEvent、WorkThread 与 CurrentState 必须一次原子写入");
  assert.equal(readback.analysis.decisions.length, 1);
  assert.equal(readback.workThreads.length, 1);
  assert.equal(readback.workEvents.length, 1);
  assert.equal(readback.currentStates.length, 1);
  assert.equal(readback.currentStates[0].latestChange, "出现明确时间安排。");
});

test("再次导入和重新分析不会清空已经确认的业务状态", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "third-brain-public-refresh-"));
  const store = await createEncryptedLocalStore({ root });
  await store.write("credentials", { accessToken: "installer-owned-token" });
  let content = "已确认在指定时间完成处理。";
  const options = {
    config: { ready: true, wps: {} },
    store,
    oauth: {},
    now: () => new Date(iso(30)),
    wpsClientFactory: () => ({
      async listChats() {
        return {
          chats: [{ id: "source-direct", name: "", privateChat: true, groupChat: false, conversationKind: "direct" }],
          completeness: { complete: true },
        };
      },
      async getMessages() {
        return {
          messages: [{ id: "item-1", senderName: "", occurredAt: iso(0), text: content }],
          completeness: { complete: true },
        };
      },
    }),
    inference: {
      async analyze({ units }) {
        return {
          summary: "中性摘要",
          candidates: [{
            title: "时间安排待复核",
            latestChange: "出现明确时间安排。",
            semanticKey: "time-arrangement",
            evidenceIds: [...new Set(units.flatMap((unit) => unit.evidenceIds))],
          }],
        };
      },
    },
  };
  const firstRuntime = createLocalTrialRuntime(options);
  await firstRuntime.listChats();
  await firstRuntime.importMessages({ chatIds: ["source-direct"], days: 1 });
  const firstAnalysis = await firstRuntime.analyzeImportedMessages();
  const candidateId = firstAnalysis.candidates[0].candidateId;
  await firstRuntime.saveOwnership({ candidateId, kind: "new_work_thread", threadTitle: "待复核事项" });
  const firstReceipt = await firstRuntime.saveImportance({ candidateId, importance: "current_important" });

  content = "已确认在调整后的指定时间完成处理。";
  const restartedRuntime = createLocalTrialRuntime(options);
  await restartedRuntime.listChats();
  await restartedRuntime.importMessages({ chatIds: ["source-direct"], days: 1 });
  const afterImport = await restartedRuntime.readWorkspace();
  assert.equal(afterImport.analysis.decisions.length, 1);
  assert.equal(afterImport.decisions.length, 1);
  assert.equal(afterImport.workThreads.length, 1);
  assert.equal(afterImport.workEvents.length, 1);
  assert.equal(afterImport.currentStates.length, 1);
  assert.equal(afterImport.analysis.decisions[0].decisionId, firstReceipt.decision.decisionId);

  await restartedRuntime.analyzeImportedMessages();
  const afterAnalysis = await restartedRuntime.readWorkspace();
  assert.equal(afterAnalysis.analysis.decisions.length, 1);
  assert.equal(afterAnalysis.decisions.length, 1);
  assert.equal(afterAnalysis.workThreads.length, 1);
  assert.equal(afterAnalysis.workEvents.length, 1);
  assert.equal(afterAnalysis.currentStates.length, 1);
  assert.equal(afterAnalysis.analysis.decisions[0].decisionId, firstReceipt.decision.decisionId);
});

test("相同归属和重要性重试及并发返回同一份可回读回执", async () => {
  const records = new Map();
  const store = {
    async read(key) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return structuredClone(records.get(key));
    },
    async write(key, value) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      records.set(key, structuredClone(value));
    },
  };
  await store.write("workspace", {
    messages: [],
    evidence: [],
    sources: [],
    analysis: {
      candidates: [{
        candidateId: "candidate_stable",
        latestChange: "出现明确变化。",
        background: "最少必要背景。",
        userDecision: "是否继续推进？",
        latestOccurredAt: iso(0),
        evidence: [],
      }],
      ownershipDrafts: [],
      decisions: [],
    },
    workThreads: [],
    workEvents: [],
    currentStates: [],
  });
  let tick = 0;
  const runtime = createLocalTrialRuntime({
    config: { ready: true, wps: {} },
    store,
    oauth: {},
    inference: { async analyze() { return {}; } },
    now: () => new Date(Date.parse(iso(30)) + tick++ * 1_000),
  });
  const ownership = { candidateId: "candidate_stable", kind: "new_work_thread", threadTitle: "稳定事项" };
  const [ownershipA, ownershipB] = await Promise.all([
    runtime.saveOwnership(ownership),
    runtime.saveOwnership(ownership),
  ]);
  assert.deepEqual(ownershipA.ownership, ownershipB.ownership);

  const [receiptA, receiptB] = await Promise.all([
    runtime.saveImportance({ candidateId: "candidate_stable", importance: "current_important" }),
    runtime.saveImportance({ candidateId: "candidate_stable", importance: "current_important" }),
  ]);
  assert.deepEqual(receiptA, receiptB);
  assert.deepEqual(
    await runtime.saveImportance({ candidateId: "candidate_stable", importance: "current_important" }),
    receiptA,
  );
  const readback = await runtime.readWorkspace();
  assert.equal(readback.analysis.decisions.length, 1);
  assert.equal(readback.workThreads.length, 1);
  assert.equal(readback.workEvents.length, 1);
  assert.equal(readback.currentStates.length, 1);

  await assert.rejects(
    runtime.saveImportance({ candidateId: "candidate_stable", importance: "related" }),
    /纠错、撤销或恢复尚未开放/u,
  );
  await assert.rejects(
    runtime.saveOwnership({ candidateId: "candidate_stable", kind: "not_current_work" }),
    /纠错、撤销或恢复尚未开放/u,
  );
});

test("同一来源条目的内容变化只提升 Evidence revision，精确重复保持幂等", async () => {
  const records = new Map([["credentials", { accessToken: "installer-owned-token" }]]);
  const store = {
    async read(key) { return structuredClone(records.get(key)); },
    async write(key, value) { records.set(key, structuredClone(value)); },
  };
  let text = "第一版内容。";
  const runtime = createLocalTrialRuntime({
    config: { ready: true, wps: {} },
    store,
    oauth: {},
    now: () => new Date(iso(30)),
    wpsClientFactory: () => ({
      async listChats() {
        return {
          chats: [{ id: "source-group", name: "", privateChat: false, groupChat: true, conversationKind: "group" }],
          completeness: { complete: true },
        };
      },
      async getMessages() {
        return {
          messages: [
            { id: "item-1", senderName: "", occurredAt: iso(0), text },
            { id: "item-1", senderName: "", occurredAt: iso(0), text },
          ],
          completeness: { complete: true },
        };
      },
    }),
    inference: { async analyze() { return {}; } },
  });
  await runtime.listChats();
  await runtime.importMessages({ chatIds: ["source-group"], days: 1 });
  let stored = records.get("workspace");
  assert.equal(stored.evidence.length, 1);
  assert.equal(stored.evidence[0].revision, 1);
  const evidenceId = stored.evidence[0].evidenceId;
  const firstFingerprint = stored.evidence[0].fingerprint;

  await runtime.importMessages({ chatIds: ["source-group"], days: 1 });
  stored = records.get("workspace");
  assert.equal(stored.evidence.length, 1);
  assert.equal(stored.evidence[0].revision, 1);
  assert.equal(stored.evidence[0].fingerprint, firstFingerprint);

  text = "第二版内容。";
  await runtime.importMessages({ chatIds: ["source-group"], days: 1 });
  stored = records.get("workspace");
  assert.equal(stored.evidence.length, 1);
  assert.equal(stored.evidence[0].evidenceId, evidenceId);
  assert.equal(stored.evidence[0].revision, 2);
  assert.notEqual(stored.evidence[0].fingerprint, firstFingerprint);
});

test("Report to Issue 只生成本地草稿和不可变确认回执，不执行 GitHub 写入", async () => {
  const records = new Map();
  const service = createLocalReportService({
    load: async (id) => records.get(id),
    save: async (id, value) => records.set(id, structuredClone(value)),
    now: () => iso(40),
    privateDenylist: ["private-marker-not-present"],
  });
  const draft = await service.createDraft({
    title: "本地启动失败",
    body: "复现步骤：运行本地启动命令。\n期望：显示本地地址。\n实际：返回中性错误。",
    attachments: [],
  });

  assert.equal(draft.status, "preview_only");
  assert.equal(draft.sideEffects.githubIssueCreated, false);
  assert.equal(draft.target.repository, "foxbitcoo/third-brain-local");
  const receipt = await service.confirm({
    draftId: draft.draftId,
    previewDigest: draft.previewDigest,
    githubLogin: "installer-user",
  });
  assert.equal(receipt.status, "confirmed_local_only");
  assert.equal(receipt.sideEffects.githubIssueCreated, false);
  assert.equal(receipt.actor.login, "installer-user");
  await assert.rejects(service.createDraft({
    title: "本地附件测试",
    body: "附件不能信任调用方自报的扫描状态。",
    attachments: [{
      name: "example.txt",
      mediaType: "text/plain",
      contentDigest: "a".repeat(64),
      userApproved: true,
      privacyScanStatus: "passed",
    }],
  }), /当前不接受附件/u);
  await assert.rejects(service.confirm({
    draftId: draft.draftId,
    previewDigest: draft.previewDigest,
    githubLogin: "different-installer-user",
  }), /确认身份已变化/u);
  await assert.rejects(service.confirm({
    draftId: draft.draftId,
    previewDigest: "a".repeat(64),
    githubLogin: "installer-user",
  }), /预览内容已变化/u);

  await assert.rejects(service.createDraft({
    title: "包含敏感值",
    body: "api_key=not-allowed-value",
    attachments: [],
  }), /隐私扫描未通过/u);

  const manualRecords = new Map();
  const manualOnly = createLocalReportService({
    load: async (id) => manualRecords.get(id),
    save: async (id, value) => manualRecords.set(id, structuredClone(value)),
    now: () => iso(41),
  });
  const manualDraft = await manualOnly.createDraft({
    title: "本地启动失败",
    body: "仅用于完整人工复核。",
    attachments: [],
  });
  assert.equal(manualDraft.privacy.status, "manual_review_required");
  await assert.rejects(manualOnly.confirm({
    draftId: manualDraft.draftId,
    previewDigest: manualDraft.previewDigest,
    githubLogin: "installer-user",
  }), /denylist.*不能生成确认回执/u);
});

test("publication receipt 绑定仓库、分支、candidate SHA、文件、diff、扫描和 release URL", () => {
  const receipt = createPublicationReceipt({
    repository: "example/project",
    branch: "codex/public-candidate",
    baseSha: "a".repeat(40),
    candidateSha: "b".repeat(40),
    releaseUrl: "https://github.com/example/project/pull/1",
    createdAt: iso(42),
    fileManifest: [{ path: "README.md", oid: "c".repeat(40), size: 10 }],
    diffDigest: "d".repeat(64),
    scanDigest: "e".repeat(64),
  });
  assert.equal(verifyPublicationReceipt(receipt), true);
  assert.equal(verifyPublicationReceipt({ ...receipt, candidateSha: "f".repeat(40) }), false);
  assert.equal(verifyPublicationReceipt({ ...receipt, releaseUrl: "https://github.com/example/project/pull/2" }), false);
});
