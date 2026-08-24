import {
  canonicalDigest,
  createReportToIssueService,
  ReportToIssueError,
} from "./report-to-issue/index.mjs";
const ref = (index) => Object.freeze({ id: `synthetic-evidence-0${index}`, revision: "synthetic-r1", fingerprint: `${index}`.repeat(64) });
const DETAILS = Object.freeze([
  ["范围变化", "范围被明确增加或缩减，且仍需决定是否保留。", "是否保留为后续候选？", "synthetic_source_alpha", "synthetic_participant_alpha", "决策变化"],
  ["时间承诺", "出现明确时点，但交付条件尚未闭合。", "是否继续跟进这个时点？", "synthetic_source_beta", "synthetic_participant_beta", "时间点／截止期限变化"],
  ["资源约束", "可用资源出现限制，可能影响下一步。", "是否需要人工确认影响？", "synthetic_source_gamma", "synthetic_participant_gamma", "责任归属变化"],
  ["依赖变化", "一个外部依赖的状态改变，但结果未定。", "该依赖是否值得保留？", "synthetic_source_delta", "synthetic_participant_delta", "下一步变化"],
  ["风险信号", "出现可描述的风险，但尚不足以断言结果。", "是否将它保留为待判断项？", "synthetic_source_epsilon", "synthetic_participant_epsilon", "阻塞／风险变化"],
  ["冲突信号", "两种中性说法不能自动归并，需要人工裁决。", "是否填写冲突裁决？", "synthetic_source_zeta", "synthetic_participant_zeta", "决策变化"],
  ["复核请求", "候选缺少最终判断，需要明确下一步。", "是否继续复核此候选？", "synthetic_source_eta", "synthetic_participant_eta", "进展／完成变化"],
]);
const SYNTHETIC_CANDIDATES = Object.freeze(DETAILS.map(([kind, rule, question, sourceLabel, participantLabel, eventType], index) => Object.freeze({
  id: `synthetic-candidate-0${index + 1}`, title: `合成候选 ${index + 1} · ${kind}`,
  businessChange: `检测到合成${kind}，不是业务事实。`, rule, question, sourceLabel, participantLabel, eventType,
  occurredAt: `2026-01-0${index + 1}T09:00:00.000Z`, minimumEvidence: `最小合成依据 ${index + 1}`, evidence: ref(index + 1),
  recommendation: "保留为候选，等待人工判断。",
  ...(index === 5 ? { conflictingClaims: [{ statement: "合成说法 A：状态仍待判断。", sourceLabel: "synthetic_source_zeta_a" }, { statement: "合成说法 B：状态已可继续。", sourceLabel: "synthetic_source_zeta_b" }] } : {}),
})));
const FROZEN_EVENT_TYPES = new Set(["决策变化", "责任归属变化", "下一步变化", "进展／完成变化", "阻塞／风险变化", "时间点／截止期限变化"]);
function nonEmpty(value, label) { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须明确填写`); return value.trim(); }
function isoTime(value) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("发生时间必须是 ISO UTC 时间"); return value; }
function publicSource(candidate) {
  const fingerprint = canonicalDigest("third-brain/public-synthetic-candidate/v1", candidate);
  return {
    branch: "public-local-workbench",
    commit: canonicalDigest("third-brain/public-workbench-source/v1", { candidateId: candidate.id }),
    files: [{
      path: `public/synthetic-candidates/${candidate.id}.json`,
      contentDigest: fingerprint,
      diffDigest: canonicalDigest("third-brain/public-workbench-diff/v1", { candidateId: candidate.id }),
    }],
  };
}

function publicReportInput(candidate, title, body) {
  return {
    edition: "public",
    report: {
      title,
      reproductionSteps: [candidate.minimumEvidence],
      expectedResult: "The synthetic local report remains a preview-only record.",
      actualResult: body,
      diagnostics: {
        version: "public-local-workbench",
        operatingSystem: "local installation",
        installMethod: "local-only public workbench",
        failedStage: "candidate review",
        errorCode: candidate.id,
      },
    },
    source: publicSource(candidate),
    attachments: [],
    classification: {
      containsOfficeText: false,
      containsInternalInformation: false,
      isSecurityOrPrivacyIssue: false,
    },
  };
}

function reportRecordStore(records) {
  const data = new Map(records.map((record) => [record.draftId, structuredClone(record)]));
  const receiptToDraft = new Map();
  const index = (record) => (record.confirmations || []).forEach((receipt) => receiptToDraft.set(receipt.receiptId, record.draftId));
  data.forEach(index);
  return {
    load(draftId) { return data.has(draftId) ? structuredClone(data.get(draftId)) : null; },
    save(record) { const copy = structuredClone(record); data.set(copy.draftId, copy); index(copy); },
    loadByReceipt(receiptId) { const draftId = receiptToDraft.get(receiptId); return draftId ? structuredClone(data.get(draftId)) : null; },
    values() { return [...data.values()].map((record) => structuredClone(record)); },
  };
}

function publicDraftView(draft) {
  return { ...draft, id: draft.draftId };
}
export function validateCandidateSet(candidates = SYNTHETIC_CANDIDATES) {
  if (!Array.isArray(candidates) || candidates.length !== 7 || new Set(candidates.map((item) => item?.id)).size !== 7) return { accepted: false, reason: "candidate_set_not_exactly_7" };
  for (const [index, item] of candidates.entries()) { const expected = SYNTHETIC_CANDIDATES[index]; const actual = item?.evidence; if (!item || item.id !== expected.id || item.eventType !== expected.eventType) return { accepted: false, reason: "candidate_identity_or_type_mismatch" }; if (!actual || actual.id !== expected.evidence.id || actual.revision !== expected.evidence.revision || actual.fingerprint !== expected.evidence.fingerprint || !/^[a-f0-9]{64}$/u.test(actual.fingerprint)) return { accepted: false, reason: "candidate_evidence_mismatch" }; }
  return { accepted: true, reason: "synthetic_7_of_7" };
}
export function createPublicCandidateWorkbench({ store, now = () => new Date(), localPrivacyScanner } = {}) {
  if (!store) throw new TypeError("local store is required");
  const readState = async () => {
    const state = (await store.read("public-workbench")) || {};
    return {
      conflicts: Array.isArray(state.conflicts) ? state.conflicts : [],
      reportRecords: Array.isArray(state.reportRecords) ? state.reportRecords : [],
      reportLinks: Array.isArray(state.reportLinks) ? state.reportLinks : [],
    };
  };
  const getCandidate = (id) => { const valid = validateCandidateSet(); if (!valid.accepted) throw new Error("合成候选集不完整或存在歧义，已拒绝继续操作"); const item = SYNTHETIC_CANDIDATES.find((candidate) => candidate.id === id); if (!item) throw new Error("合成候选不存在"); return item; };
  const reportService = (state) => {
    const records = reportRecordStore(state.reportRecords);
    return {
      core: createReportToIssueService({
        store: records,
        localPrivacyScanner,
        now: () => now().toISOString(),
      }),
      records,
    };
  };
  const saveReports = async (state, records) => {
    state.reportRecords = records.values();
    await store.write("public-workbench", state);
  };
  return Object.freeze({
    async read() { const state = await readState(); const setLineage = validateCandidateSet(); return { mode: "synthetic_local_only", candidateOnly: true, automaticStateChanges: false, setLineage, reportSubmission: "NOT_IMPLEMENTED", candidates: SYNTHETIC_CANDIDATES.map((item) => ({ ...item, actor: item.participantLabel, userDecision: item.question, lineage: { expected: 7, accepted: setLineage.accepted ? 7 : 0, status: setLineage.reason }, conflict: state.conflicts.find((record) => record.candidateId === item.id) || null })) }; },
    async confirmConflict({ candidateId, eventType, businessStatement, occurredAt }) { const item = getCandidate(candidateId); if (!item.conflictingClaims) throw new Error("只有合成冲突候选可进行冲突确认"); const type = nonEmpty(eventType, "事件类型"); if (!FROZEN_EVENT_TYPES.has(type)) throw new Error("事件类型不在公开工作台的冻结集合中"); const record = { candidateId, eventType: type, businessStatement: nonEmpty(businessStatement, "业务事实"), occurredAt: isoTime(occurredAt), confirmedAt: now().toISOString() }; const state = await readState(); state.conflicts = [...state.conflicts.filter((value) => value.candidateId !== candidateId), record]; await store.write("public-workbench", state); return { confirmed: true, conflict: structuredClone(record), semantics: "candidate_only" }; },
    async draftReport({ candidateId, title, body }) {
      const candidate = getCandidate(candidateId);
      const state = await readState();
      const { core, records } = reportService(state);
      const draft = core.createDraft(publicReportInput(candidate, nonEmpty(title, "报告标题"), nonEmpty(body, "报告正文")));
      state.reportLinks.push({ draftId: draft.draftId, candidateId });
      await saveReports(state, records);
      return { draft: publicDraftView(draft), preview: draft.issue, submission: "NOT_IMPLEMENTED" };
    },
    async readReport({ draftId }) {
      const state = await readState();
      const { core } = reportService(state);
      return { draft: publicDraftView(core.readDraft(draftId)), submission: "NOT_IMPLEMENTED" };
    },
    async readLatestReport({ candidateId }) {
      getCandidate(candidateId);
      const state = await readState();
      const link = state.reportLinks.filter((item) => item.candidateId === candidateId).at(-1);
      if (!link) throw new ReportToIssueError("draft_not_found", "no local report exists for this synthetic candidate");
      const { core } = reportService(state);
      return { draft: publicDraftView(core.readDraft(link.draftId)), submission: "NOT_IMPLEMENTED" };
    },
    async confirmReport({ draftId, previewDigest, acknowledgement, githubLogin = "local-preview-user" }) {
      if (acknowledgement !== "CONFIRM_LOCAL_DRAFT") throw new Error("必须明确确认已完整检查本地报告");
      const state = await readState();
      const { core, records } = reportService(state);
      const receipt = core.confirmDraft({ draftId, previewDigest, githubIdentity: { login: githubLogin } });
      await saveReports(state, records);
      return { confirmed: true, receipt, submission: "NOT_IMPLEMENTED" };
    },
    async correctReport({ draftId, expectedRevision, candidateId, title, body }) {
      const candidate = getCandidate(candidateId);
      const state = await readState();
      const link = state.reportLinks.find((item) => item.draftId === draftId);
      if (!link || link.candidateId !== candidateId) throw new ReportToIssueError("draft_not_found", "local report does not belong to this synthetic candidate");
      const { core, records } = reportService(state);
      const draft = core.correctDraft({ draftId, expectedRevision, replacement: publicReportInput(candidate, nonEmpty(title, "报告标题"), nonEmpty(body, "报告正文")), reason: "user_correction" });
      await saveReports(state, records);
      return { draft: publicDraftView(draft), submission: "NOT_IMPLEMENTED" };
    },
    async revokeReportConfirmation({ receiptId }) {
      const state = await readState();
      const { core, records } = reportService(state);
      const revocation = core.revokeConfirmation({ receiptId, reason: "user_revoked" });
      await saveReports(state, records);
      return { revocation, submission: "NOT_IMPLEMENTED" };
    },
    async readReportHistory({ draftId }) {
      const state = await readState();
      const { core } = reportService(state);
      return { history: core.readConfirmationHistory(draftId), submission: "NOT_IMPLEMENTED" };
    },
  });
}
export { SYNTHETIC_CANDIDATES };
