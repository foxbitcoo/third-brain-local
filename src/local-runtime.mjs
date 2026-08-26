import { buildWpsAuthorizationUrl, exchangeWpsAuthorizationCode } from "./wps-oauth.mjs";
import { createWpsMessageClient } from "./wps-message-client.mjs";
import { createPublicCandidateWorkbench } from "./public-workbench.mjs";
import { buildSourceEvidence, createBcCandidatePipeline } from "./public-signal-pipeline.mjs";
import { createLocalReportService } from "./report-to-issue.mjs";
import { randomUUID } from "node:crypto";

const fallbackMutationTails = new WeakMap();
const FORMAL_EVENT_TYPES = new Set([
  "决策变化",
  "责任归属变化",
  "下一步变化",
  "进展／完成变化",
  "阻塞／风险变化",
  "时间点／截止期限变化",
]);

function serializeStoreMutation(store, operation) {
  if (typeof store.serialize === "function") return store.serialize(operation);
  const previous = fallbackMutationTails.get(store) || Promise.resolve();
  const result = previous.then(operation, operation);
  const settled = result.then(() => undefined, () => undefined);
  fallbackMutationTails.set(store, settled);
  settled.finally(() => {
    if (fallbackMutationTails.get(store) === settled) fallbackMutationTails.delete(store);
  });
  return result;
}

export function createLocalTrialRuntime({
  config,
  store,
  oauth,
  wpsClientFactory = (options) => createWpsMessageClient(options),
  inference,
  now = () => new Date(),
  reportPrivateDenylist = [],
}) {
  let authorizationState;
  let selectableChats = new Map();
  const oauthPort = oauth || {
    buildAuthorization: () => buildWpsAuthorizationUrl({
      appId: config.wps.appId,
      redirectUri: config.wps.redirectUri,
      scopes: config.wps.scopes,
    }),
    exchange: ({ code }) => exchangeWpsAuthorizationCode({
      appId: config.wps.appId,
      appKey: config.wps.appKey,
      redirectUri: config.wps.redirectUri,
      code,
    }),
  };
  const publicWorkbench = createPublicCandidateWorkbench({ store, now });
  const reportKey = (draftId) => {
    if (!/^draft_[A-Za-z0-9-]{8,80}$/u.test(String(draftId ?? ""))) {
      throw new Error("本地问题草稿标识无效");
    }
    return `report-${draftId}`;
  };
  const reportService = createLocalReportService({
    load: async (draftId) => store.read(reportKey(draftId)),
    save: async (draftId, value) => store.write(reportKey(draftId), value),
    now: () => now().toISOString(),
    privateDenylist: reportPrivateDenylist,
  });

  async function credentials() {
    const value = await store.read("credentials");
    if (!value?.accessToken) throw new Error("请先完成 WPS 用户授权");
    return value;
  }

  async function installationId() {
    const current = await store.read("installation");
    if (typeof current?.installationId === "string") return current.installationId;
    const value = `installation_${randomUUID()}`;
    await store.write("installation", { installationId: value });
    return value;
  }

  function candidateMatchesId(candidate, candidateId, candidates) {
    if (candidate?.candidateId === candidateId) return true;
    if (!candidate?.legacyCandidateId || candidate.legacyCandidateId !== candidateId) return false;
    return candidates.filter((item) => item.legacyCandidateId === candidateId).length === 1;
  }

  function analysisCandidate(workspace, candidateId) {
    const candidates = workspace?.analysis?.candidates || [];
    const exact = candidates.find((item) => item.candidateId === candidateId);
    if (exact) return exact;
    const legacyMatches = candidates.filter((item) => item.legacyCandidateId === candidateId);
    if (legacyMatches.length > 1) throw new Error("旧候选标识对应多个变化类型；请重新选择候选");
    if (legacyMatches.length === 0) throw new Error("候选不存在");
    return legacyMatches[0];
  }

  function serializeMutation(operation) {
    return serializeStoreMutation(store, operation);
  }

  function formalDecisions(workspace) {
    return workspace?.decisions || workspace?.analysis?.decisions || [];
  }

  function analysisWithoutFormalState(analysis) {
    if (!analysis) return null;
    const { decisions: _legacyDecisions, ...rest } = analysis;
    return rest;
  }

  function decisionTargetsCandidate(workspace, decision, candidate) {
    return candidateMatchesId(candidate, decision?.candidateId, workspace?.analysis?.candidates || []);
  }

  function sameOwnership(left, right) {
    const comparable = (value) => value === null || value === undefined ? null : {
      kind: value.kind,
      threadId: value.threadId ?? null,
      threadTitle: value.threadTitle ?? null,
    };
    return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
  }

  function mergeBy(items, additions, keyFor) {
    const merged = new Map(items.map((item) => [keyFor(item), item]));
    for (const item of additions) merged.set(keyFor(item), item);
    return [...merged.values()];
  }

  function reconcileEvidence(previous, observed) {
    const byItem = new Map(previous.map((item) => [item.source.itemId, item]));
    const currentBatch = new Map(observed.map((item) => [item.source.itemId, item]));
    for (const [itemId, item] of currentBatch) {
      const prior = byItem.get(itemId);
      if (!prior) {
        byItem.set(itemId, item);
      } else if (prior.fingerprint !== item.fingerprint) {
        byItem.set(itemId, Object.freeze({
          ...item,
          revision: prior.revision + 1,
        }));
      }
    }
    return [...byItem.values()];
  }

  function decisionReceipt(workspace, decision) {
    const persisted = (workspace.decisionReceipts || []).find((item) => (
      item.decision?.decisionId === decision.decisionId
    ));
    return persisted || Object.freeze({
      schemaVersion: "public-decision-receipt/v1",
      receiptId: `receipt_${decision.decisionId}`,
      saved: true,
      decision,
      ripple: decision.ripple,
    });
  }

  return Object.freeze({
    async status() {
      const credential = await store.read("credentials");
      const workspace = await store.read("workspace");
      const decisions = formalDecisions(workspace);
      return {
        configured: config.ready,
        wpsAuthorized: Boolean(credential?.accessToken),
        importedMessages: workspace?.messages?.length || 0,
        importComplete: workspace?.sources?.every((source) => source.completeness?.complete) ?? false,
        analyzedAt: workspace?.analysis?.generatedAt || null,
        pendingDecisions: workspace?.analysis?.candidates?.filter((candidate) => (
          !decisions.some((decision) => decisionTargetsCandidate(workspace, decision, candidate))
        )).length || 0,
      };
    },
    beginAuthorization() {
      const result = oauthPort.buildAuthorization();
      authorizationState = { value: result.state, expiresAt: Date.now() + 10 * 60 * 1000 };
      return result;
    },
    async finishAuthorization({ code, state }) {
      if (!authorizationState || state !== authorizationState.value || Date.now() > authorizationState.expiresAt) {
        throw new Error("WPS OAuth state 无效或已过期");
      }
      authorizationState = undefined;
      const result = await oauthPort.exchange({ code });
      await store.write("credentials", result);
      return { authorized: true };
    },
    async listChats() {
      const credential = await credentials();
      const result = await wpsClientFactory({ accessToken: credential.accessToken }).listChats();
      const normalizedChats = result.chats.map((chat) => ({
        ...chat,
        conversationKind: chat.conversationKind
          || (chat.privateChat ? "direct" : chat.groupChat ? "group" : "unsupported"),
      }));
      const supportedChats = normalizedChats.filter((chat) => (
        chat.conversationKind === "direct" || chat.conversationKind === "group"
      ));
      selectableChats = new Map(supportedChats.map((chat) => [chat.id, chat]));
      return {
        chats: supportedChats,
        completeness: result.completeness,
        unsupportedChats: normalizedChats.length - supportedChats.length,
      };
    },
    async importMessages(input) {
      return serializeMutation(async () => {
        const { chatIds, days } = input;
        if (!Array.isArray(chatIds) || chatIds.length < 1 || chatIds.length > 10) throw new Error("请选择 1 至 10 个私聊或群聊来源");
        if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error("首轮只支持最近 1 至 30 天");
        for (const chatId of chatIds) {
          if (!selectableChats.has(chatId)) throw new Error("只能导入刚刚读取并显示的私聊或群聊");
        }
        const credential = await credentials();
        const client = wpsClientFactory({ accessToken: credential.accessToken });
        const endAt = now();
        const startAt = new Date(endAt.getTime() - days * 24 * 60 * 60 * 1000);
        const messages = [];
        const evidence = [];
        const sources = [];
        const ownerInstallationId = await installationId();
        for (const chatId of [...new Set(chatIds)]) {
          const result = await client.getMessages({ chatId, startAt: startAt.toISOString(), endAt: endAt.toISOString() });
          const chat = selectableChats.get(chatId);
          messages.push(...result.messages.map((item) => ({ ...item, chatId, chatName: chat.name })));
          evidence.push(...result.messages.map((item) => buildSourceEvidence({
            installationId: ownerInstallationId,
            conversation: chat,
            message: item,
          })));
          sources.push({
            chatId,
            chatName: chat.name,
            conversationKind: chat.conversationKind,
            messageCount: result.messages.length,
            completeness: result.completeness,
          });
        }
        const previous = await store.read("workspace") || {};
        const decisions = formalDecisions(previous);
        const nextSources = mergeBy(previous.sources || [], sources, (item) => item.chatId);
        const nextMessages = mergeBy(
          previous.messages || [],
          messages,
          (item) => `${item.chatId}\0${item.id}`,
        );
        const nextEvidence = reconcileEvidence(previous.evidence || [], evidence);
        await store.write("workspace", {
          ...previous,
          importedAt: endAt.toISOString(),
          range: { startAt: startAt.toISOString(), endAt: endAt.toISOString() },
          chatIds: [...new Set([...(previous.chatIds || []), ...chatIds])],
          sources: nextSources,
          messages: nextMessages,
          evidence: nextEvidence,
          decisions,
          workThreads: previous.workThreads || [],
          workEvents: previous.workEvents || [],
          currentStates: previous.currentStates || [],
          analysis: analysisWithoutFormalState(previous.analysis),
        });
        return {
          messageCount: messages.length,
          complete: sources.every((source) => source.completeness.complete),
          sources,
          range: { startAt: startAt.toISOString(), endAt: endAt.toISOString() },
        };
      });
    },
    async analyzeImportedMessages() {
      return serializeMutation(async () => {
        const workspace = await store.read("workspace");
        if (!workspace?.evidence?.length) throw new Error("请先导入消息");
        if (!workspace.sources?.every((source) => source.completeness?.complete)) {
          throw new Error("当前导入存在截断；请缩短时间范围或减少群聊后重新导入，再进行分析");
        }
        const pipeline = createBcCandidatePipeline({
          analyze: ({ strategy, units }) => inference.analyze({ strategy, units }),
        });
        const result = await pipeline.run(workspace.evidence);
        const previous = workspace.analysis || {};
        const decisions = formalDecisions(workspace);
        const ownershipDrafts = [];
        for (const draft of previous.ownershipDrafts || []) {
          const matches = result.candidates.filter((candidate) => (
            candidateMatchesId(candidate, draft.candidateId, result.candidates)
          ));
          if (matches.length !== 1) continue;
          const normalized = { ...draft, candidateId: matches[0].candidateId };
          const index = ownershipDrafts.findIndex((item) => item.candidateId === normalized.candidateId);
          if (index >= 0) ownershipDrafts[index] = normalized;
          else ownershipDrafts.push(normalized);
        }
        const analysis = {
          schemaVersion: result.schemaVersion,
          extractorVersion: result.extractorVersion,
          summary: result.summary,
          counts: result.counts,
          candidates: result.candidates,
          knownGaps: result.knownGaps,
          provenance: result.provenance,
          generatedAt: now().toISOString(),
          ownershipDrafts,
        };
        await store.write("workspace", { ...workspace, analysis, decisions });
        return analysis;
      });
    },
    async saveOwnership(input) {
      return serializeMutation(async () => {
        const { candidateId, kind, threadId = null, threadTitle = null } = input;
        if (!["existing_work_thread", "new_work_thread", "not_current_work"].includes(kind)) {
          throw new Error("工作归属参数无效");
        }
        const workspace = await store.read("workspace");
        const candidate = analysisCandidate(workspace, candidateId);
        const canonicalCandidateId = candidate.candidateId;
        const candidates = workspace.analysis?.candidates || [];
        const existingDecision = formalDecisions(workspace).find((item) => decisionTargetsCandidate(workspace, item, candidate));
        if (kind === "existing_work_thread" && !(workspace.workThreads || []).some((item) => item.threadId === threadId)) {
          throw new Error("现有工作主线不存在");
        }
        if (kind === "new_work_thread" && (typeof threadTitle !== "string" || !threadTitle.trim())) {
          throw new Error("新工作主线标题不能为空");
        }
        const ownershipDraft = {
          candidateId: canonicalCandidateId,
          kind,
          threadId: kind === "existing_work_thread" ? threadId : null,
          threadTitle: kind === "new_work_thread" ? threadTitle.trim().slice(0, 120) : null,
          recordedAt: now().toISOString(),
        };
        if (existingDecision) {
          if (sameOwnership(existingDecision.ownership, ownershipDraft)) {
            return { saved: true, ownership: existingDecision.ownership };
          }
          throw new Error("纠错、撤销或恢复尚未开放；已确认判断不能隐式重判");
        }
        const existingDraft = (workspace.analysis.ownershipDrafts || []).find((item) => (
          candidateMatchesId(candidate, item.candidateId, candidates)
        ));
        if (existingDraft && sameOwnership(existingDraft, ownershipDraft)) {
          return { saved: true, ownership: existingDraft };
        }
        workspace.analysis.ownershipDrafts = [
          ...(workspace.analysis.ownershipDrafts || []).filter((item) => (
            !candidateMatchesId(candidate, item.candidateId, candidates)
          )),
          ownershipDraft,
        ];
        await store.write("workspace", workspace);
        return { saved: true, ownership: ownershipDraft };
      });
    },
    async saveImportance(input) {
      return serializeMutation(async () => {
        const { candidateId, importance } = input;
        const allowed = new Set(["current_important", "related", "noise", "uncertain"]);
        if (!allowed.has(importance)) throw new Error("重要性参数无效");
        const workspace = await store.read("workspace");
        const candidate = analysisCandidate(workspace, candidateId);
        const canonicalCandidateId = candidate.candidateId;
        const candidates = workspace.analysis?.candidates || [];
        const ownership = (workspace.analysis.ownershipDrafts || []).find((item) => (
          candidateMatchesId(candidate, item.candidateId, candidates)
        ));
        if (importance === "current_important" && !["existing_work_thread", "new_work_thread"].includes(ownership?.kind)) {
          throw new Error("请先确认工作归属，再判断为当前重要");
        }
        const decisions = formalDecisions(workspace);
        const existing = decisions.find((item) => decisionTargetsCandidate(workspace, item, candidate));
        if (existing?.importance === importance && sameOwnership(existing.ownership, ownership)) {
          return decisionReceipt(workspace, existing);
        }
        if (existing) {
          throw new Error("纠错、撤销或恢复尚未开放；已确认判断不能隐式重判");
        }
        const decidedAt = now().toISOString();
        const decisionId = `decision_${randomUUID()}`;
        const ripple = { workEventCreated: false, workThreadChanged: false, currentStateChanged: false };
        if (importance === "current_important") {
          if (!FORMAL_EVENT_TYPES.has(candidate.eventType)) {
            throw new Error("候选变化类型未绑定冻结枚举；未写入正式 WorkEvent");
          }
          let threadId = ownership.threadId;
          if (ownership.kind === "new_work_thread") {
            threadId = `workthread_${randomUUID()}`;
            workspace.workThreads = [
              ...(workspace.workThreads || []),
              { threadId, title: ownership.threadTitle, revision: 1, createdAt: decidedAt },
            ];
            ripple.workThreadChanged = true;
          }
          const workEvent = {
            workEventId: `workevent_${randomUUID()}`,
            candidateId: canonicalCandidateId,
            threadId,
            eventType: candidate.eventType,
            businessStatement: candidate.latestChange,
            occurredAt: candidate.latestOccurredAt,
            evidenceSnapshot: candidate.evidence.map((item) => ({
              evidenceId: item.evidenceId,
              revision: item.revision,
              fingerprint: item.fingerprint,
            })),
            createdByDecisionId: decisionId,
          };
          workspace.workEvents = [
            ...(workspace.workEvents || []).filter((item) => (
              !candidateMatchesId(candidate, item.candidateId, candidates)
            )),
            workEvent,
          ];
          workspace.currentStates = [
            ...(workspace.currentStates || []).filter((item) => item.threadId !== threadId),
            {
              threadId,
              revision: ((workspace.currentStates || []).find((item) => item.threadId === threadId)?.revision || 0) + 1,
              latestChange: candidate.latestChange,
              background: candidate.background,
              nextAction: candidate.userDecision,
              updatedAt: decidedAt,
              sourceWorkEventId: workEvent.workEventId,
            },
          ];
          ripple.workEventCreated = true;
          ripple.currentStateChanged = true;
        }
        const decision = {
          decisionId,
          candidateId: canonicalCandidateId,
          importance,
          ownership: ownership ?? null,
          decidedAt,
          ripple,
        };
        const receipt = decisionReceipt(workspace, decision);
        workspace.decisions = [...decisions, decision];
        workspace.decisionReceipts = [...(workspace.decisionReceipts || []), receipt];
        await store.write("workspace", workspace);
        return receipt;
      });
    },
    async readWorkspace() {
      const workspace = await store.read("workspace");
      if (!workspace) return { range: null, chatIds: [], messageCount: 0, analysis: null };
      return {
        range: workspace.range,
        chatIds: workspace.chatIds,
        messageCount: workspace.messages?.length || 0,
        sources: workspace.sources || [],
        analysis: analysisWithoutFormalState(workspace.analysis),
        decisions: formalDecisions(workspace),
        decisionReceipts: workspace.decisionReceipts || [],
        workThreads: workspace.workThreads || [],
        workEvents: workspace.workEvents || [],
        currentStates: workspace.currentStates || [],
      };
    },
    async readPublicWorkbench() {
      return publicWorkbench.read();
    },
    async confirmPublicConflict(input) {
      return publicWorkbench.confirmConflict(input);
    },
    async createReportDraft(input) {
      return reportService.createDraft(input);
    },
    async readReportDraft(draftId) {
      return reportService.readDraft(draftId);
    },
    async confirmReportDraft(input) {
      return reportService.confirm(input);
    },
  });
}
