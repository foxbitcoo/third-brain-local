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
          semanticKey: strategy === "B" ? "time-arrangement-single" : "time-arrangement-context",
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
