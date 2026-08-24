import { createHash } from "node:crypto";

import { PUBLIC_CANDIDATE_MANIFEST } from "./public-workbench-manifest.mjs";
function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function canonicalDigest(domain, value) { return createHash("sha256").update(`${domain}\0`).update(canonicalJson(value)).digest("hex"); }
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
function exactFields(value, fields) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).every((field) => fields.includes(field));
}

function evidenceSet(candidate) {
  return {
    minimumEvidence: candidate.minimumEvidence,
    items: [candidate.evidence],
    conflictingClaims: candidate.conflictingClaims ?? [],
  };
}

const { manifestDigest: expectedManifestDigest, ...manifestBody } = PUBLIC_CANDIDATE_MANIFEST;
const manifestIntegrityValid = expectedManifestDigest === canonicalDigest(
  "third-brain/public-synthetic-candidate-manifest/v1",
  manifestBody,
);

export function validateCandidateSet(candidates = SYNTHETIC_CANDIDATES) {
  if (!manifestIntegrityValid) return { accepted: false, reason: "candidate_manifest_invalid" };
  const frozenCandidates = PUBLIC_CANDIDATE_MANIFEST.candidates;
  if (
    !Array.isArray(candidates) ||
    candidates.length !== frozenCandidates.length ||
    new Set(candidates.map((item) => item?.id)).size !== frozenCandidates.length
  ) {
    return { accepted: false, reason: "candidate_set_not_exactly_7" };
  }
  const actualSetEntries = [];
  for (const [index, candidate] of candidates.entries()) {
    const frozen = frozenCandidates[index];
    if (candidate?.id !== frozen.id) {
      return { accepted: false, reason: "candidate_order_or_identity_mismatch" };
    }
    const candidateFields = frozen.hasConflictingClaims
      ? [...PUBLIC_CANDIDATE_MANIFEST.candidateFields, "conflictingClaims"]
      : PUBLIC_CANDIDATE_MANIFEST.candidateFields;
    if (!exactFields(candidate, candidateFields)) {
      return { accepted: false, reason: "candidate_business_fields_mismatch" };
    }
    if (!exactFields(candidate.evidence, PUBLIC_CANDIDATE_MANIFEST.evidenceFields)) {
      return { accepted: false, reason: "candidate_evidence_mismatch" };
    }
    if (
      frozen.hasConflictingClaims &&
      (!Array.isArray(candidate.conflictingClaims) ||
        candidate.conflictingClaims.some((claim) =>
          !exactFields(claim, PUBLIC_CANDIDATE_MANIFEST.conflictClaimFields)))
    ) {
      return { accepted: false, reason: "candidate_evidence_mismatch" };
    }
    const candidateDigest = canonicalDigest(
      "third-brain/public-synthetic-candidate/v2",
      candidate,
    );
    const evidenceSetDigest = canonicalDigest(
      "third-brain/public-synthetic-evidence-set/v1",
      evidenceSet(candidate),
    );
    if (
      candidateDigest !== frozen.candidateDigest ||
      evidenceSetDigest !== frozen.evidenceSetDigest
    ) {
      return { accepted: false, reason: "candidate_manifest_digest_mismatch" };
    }
    actualSetEntries.push({ id: candidate.id, candidateDigest, evidenceSetDigest });
  }
  if (
    canonicalDigest("third-brain/public-synthetic-candidate-set/v2", actualSetEntries) !==
    PUBLIC_CANDIDATE_MANIFEST.setDigest
  ) {
    return { accepted: false, reason: "candidate_set_digest_mismatch" };
  }
  return { accepted: true, reason: "synthetic_7_of_7" };
}
export function createPublicCandidateWorkbench({ store, now = () => new Date() } = {}) {
  if (!store) throw new TypeError("local store is required");
  const readState = async () => {
    const state = (await store.read("public-workbench")) || {};
    return {
      conflicts: Array.isArray(state.conflicts) ? state.conflicts : [],
    };
  };
  const getCandidate = (id) => { const valid = validateCandidateSet(); if (!valid.accepted) throw new Error("合成候选集不完整或存在歧义，已拒绝继续操作"); const item = SYNTHETIC_CANDIDATES.find((candidate) => candidate.id === id); if (!item) throw new Error("合成候选不存在"); return item; };
  return Object.freeze({
    async read() { const state = await readState(); const setLineage = validateCandidateSet(); return { mode: "synthetic_local_only", candidateOnly: true, automaticStateChanges: false, setLineage, candidates: SYNTHETIC_CANDIDATES.map((item) => ({ ...item, actor: item.participantLabel, userDecision: item.question, lineage: { expected: 7, accepted: setLineage.accepted ? 7 : 0, status: setLineage.reason }, conflict: state.conflicts.find((record) => record.candidateId === item.id) || null })) }; },
    async confirmConflict({ candidateId, eventType, businessStatement, occurredAt }) { const item = getCandidate(candidateId); if (!item.conflictingClaims) throw new Error("只有合成冲突候选可进行冲突确认"); const type = nonEmpty(eventType, "事件类型"); if (!FROZEN_EVENT_TYPES.has(type)) throw new Error("事件类型不在公开工作台的冻结集合中"); const record = { candidateId, eventType: type, businessStatement: nonEmpty(businessStatement, "业务事实"), occurredAt: isoTime(occurredAt), confirmedAt: now().toISOString() }; const state = await readState(); state.conflicts = [...state.conflicts.filter((value) => value.candidateId !== candidateId), record]; await store.write("public-workbench", state); return { confirmed: true, conflict: structuredClone(record), semantics: "candidate_only" }; },
  });
}
export { SYNTHETIC_CANDIDATES };
