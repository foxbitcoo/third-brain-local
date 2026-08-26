import { buildWpsAuthorizationUrl, exchangeWpsAuthorizationCode } from "./wps-oauth.mjs";
import { createWpsMessageClient } from "./wps-message-client.mjs";
import { createPublicCandidateWorkbench } from "./public-workbench.mjs";
import { buildSourceEvidence, createBcCandidatePipeline } from "./public-signal-pipeline.mjs";
import { createLocalReportService } from "./report-to-issue.mjs";
import { randomUUID } from "node:crypto";

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

  function analysisCandidate(workspace, candidateId) {
    const candidate = workspace?.analysis?.candidates?.find((item) => item.candidateId === candidateId);
    if (!candidate) throw new Error("候选不存在");
    return candidate;
  }

  return Object.freeze({
    async status() {
      const credential = await store.read("credentials");
      const workspace = await store.read("workspace");
      return {
        configured: config.ready,
        wpsAuthorized: Boolean(credential?.accessToken),
        importedMessages: workspace?.messages?.length || 0,
        importComplete: workspace?.sources?.every((source) => source.completeness?.complete) ?? false,
        analyzedAt: workspace?.analysis?.generatedAt || null,
        pendingDecisions: workspace?.analysis?.candidates?.filter((candidate) => (
          !(workspace?.analysis?.decisions || []).some((decision) => decision.candidateId === candidate.candidateId)
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
    async importMessages({ chatIds, days }) {
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
      await store.write("workspace", {
        importedAt: endAt.toISOString(),
        range: { startAt: startAt.toISOString(), endAt: endAt.toISOString() },
        chatIds: [...new Set(chatIds)],
        sources,
        messages,
        evidence,
        workThreads: [],
        workEvents: [],
        currentStates: [],
      });
      return {
        messageCount: messages.length,
        complete: sources.every((source) => source.completeness.complete),
        sources,
        range: { startAt: startAt.toISOString(), endAt: endAt.toISOString() },
      };
    },
    async analyzeImportedMessages() {
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
      const candidateIds = new Set(result.candidates.map((candidate) => candidate.candidateId));
      const analysis = {
        schemaVersion: result.schemaVersion,
        extractorVersion: result.extractorVersion,
        summary: result.summary,
        counts: result.counts,
        candidates: result.candidates,
        generatedAt: now().toISOString(),
        ownershipDrafts: (previous.ownershipDrafts || []).filter((item) => candidateIds.has(item.candidateId)),
        decisions: (previous.decisions || []).filter((item) => candidateIds.has(item.candidateId)),
      };
      await store.write("workspace", { ...workspace, analysis });
      return analysis;
    },
    async saveOwnership({ candidateId, kind, threadId = null, threadTitle = null }) {
      if (!["existing_work_thread", "new_work_thread", "not_current_work"].includes(kind)) {
        throw new Error("工作归属参数无效");
      }
      const workspace = await store.read("workspace");
      analysisCandidate(workspace, candidateId);
      if (kind === "existing_work_thread" && !(workspace.workThreads || []).some((item) => item.threadId === threadId)) {
        throw new Error("现有工作主线不存在");
      }
      if (kind === "new_work_thread" && (typeof threadTitle !== "string" || !threadTitle.trim())) {
        throw new Error("新工作主线标题不能为空");
      }
      const ownershipDraft = {
        candidateId,
        kind,
        threadId: kind === "existing_work_thread" ? threadId : null,
        threadTitle: kind === "new_work_thread" ? threadTitle.trim().slice(0, 120) : null,
        recordedAt: now().toISOString(),
      };
      workspace.analysis.ownershipDrafts = [
        ...(workspace.analysis.ownershipDrafts || []).filter((item) => item.candidateId !== candidateId),
        ownershipDraft,
      ];
      await store.write("workspace", workspace);
      return { saved: true, ownership: ownershipDraft };
    },
    async saveImportance({ candidateId, importance }) {
      const allowed = new Set(["current_important", "related", "noise", "uncertain"]);
      if (!allowed.has(importance)) throw new Error("重要性参数无效");
      const workspace = await store.read("workspace");
      const candidate = analysisCandidate(workspace, candidateId);
      const ownership = (workspace.analysis.ownershipDrafts || []).find((item) => item.candidateId === candidateId);
      if (importance === "current_important" && !["existing_work_thread", "new_work_thread"].includes(ownership?.kind)) {
        throw new Error("请先确认工作归属，再判断为当前重要");
      }
      const existing = (workspace.analysis.decisions || []).find((item) => item.candidateId === candidateId);
      if (existing?.importance === importance && JSON.stringify(existing.ownership) === JSON.stringify(ownership ?? null)) {
        return { saved: true, replayed: true, decision: existing, ripple: existing.ripple };
      }
      const decidedAt = now().toISOString();
      const decisionId = `decision_${randomUUID()}`;
      const ripple = { workEventCreated: false, workThreadChanged: false, currentStateChanged: false };
      if (importance === "current_important") {
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
          candidateId,
          threadId,
          eventType: "user_confirmed_change",
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
          ...(workspace.workEvents || []).filter((item) => item.candidateId !== candidateId),
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
        candidateId,
        importance,
        ownership: ownership ?? null,
        decidedAt,
        ripple,
      };
      workspace.analysis.decisions = [
        ...(workspace.analysis.decisions || []).filter((item) => item.candidateId !== candidateId),
        decision,
      ];
      await store.write("workspace", workspace);
      return { saved: true, decision, ripple };
    },
    async readWorkspace() {
      const workspace = await store.read("workspace");
      if (!workspace) return { range: null, chatIds: [], messageCount: 0, analysis: null };
      return {
        range: workspace.range,
        chatIds: workspace.chatIds,
        messageCount: workspace.messages?.length || 0,
        sources: workspace.sources || [],
        analysis: workspace.analysis || null,
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
