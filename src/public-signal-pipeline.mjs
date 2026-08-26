// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";

const WINDOW_MS = 90 * 60 * 1000;
const MAX_CONTEXT_ITEMS = 5;
const CONVERSATION_KINDS = new Set(["direct", "group"]);

function digest(domain, value) {
  return createHash("sha256").update(`${domain}\0${value}`).digest("hex");
}

function cleanText(value, max) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);
}

function exactIso(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function buildSourceEvidence({ installationId, conversation, message }) {
  const conversationKind = conversation?.conversationKind;
  if (!CONVERSATION_KINDS.has(conversationKind)) {
    throw new TypeError("conversation kind must be direct or group");
  }
  const occurredAt = exactIso(message?.occurredAt);
  const excerpt = cleanText(message?.text, 2_000);
  if (!occurredAt || !excerpt || !conversation?.id || !message?.id || !installationId) {
    throw new TypeError("source Evidence requires stable local input");
  }
  const ownerKey = digest("third-brain/public-owner/v1", installationId);
  const sourceId = digest(
    "third-brain/public-source/v1",
    `${ownerKey}\0${conversationKind}\0${conversation.id}`,
  );
  const itemId = digest(
    "third-brain/public-source-item/v1",
    `${sourceId}\0${message.id}`,
  );
  const fingerprint = digest(
    "third-brain/public-evidence-fingerprint/v1",
    `${sourceId}\0${itemId}\0${occurredAt}\0${excerpt}`,
  );
  const observedSenderRef = cleanText(message.senderRef, 512);
  return Object.freeze({
    schemaVersion: "source-evidence/v1",
    evidenceId: `evidence_${digest("third-brain/public-evidence-id/v1", itemId).slice(0, 24)}`,
    revision: 1,
    fingerprint,
    source: Object.freeze({ sourceType: "wps-chat", sourceId, itemId }),
    scope: Object.freeze({ ownerKey, sourceKey: sourceId }),
    conversationKind,
    modality: "message",
    visibility: conversationKind === "direct" ? "personal-only" : "source-members",
    occurredAt,
    participants: Object.freeze([
      Object.freeze({
        ref: `participant_${digest(
          "third-brain/public-participant/v1",
          `${ownerKey}\0${observedSenderRef || itemId}`,
        ).slice(0, 24)}`,
      }),
    ]),
    excerpt,
    display: Object.freeze({
      sourceName: cleanText(conversation.name, 256),
      senderName: cleanText(message.senderName, 256),
    }),
    coverage: Object.freeze({ kind: "single-item", status: "complete" }),
    identity: Object.freeze({
      status: observedSenderRef ? "observed_source_identifier" : "unresolved",
      reason: observedSenderRef
        ? "source_identifier_not_yet_mapped_to_an_authoritative_contact"
        : "display_name_is_not_a_stable_identity_mapping",
    }),
    learning: Object.freeze({
      eligibility: "eligible",
      reason: conversationKind === "direct" ? "work_private_chat" : "work_chat",
    }),
    opaqueLocator: Object.freeze({
      platform: "wps",
      sourceType: "chat",
      sourceRef: sourceId,
      itemRef: itemId,
    }),
  });
}

function bUnits(evidence) {
  return evidence.map((item) => ({
    unitId: `b_${item.evidenceId}`,
    evidenceIds: [item.evidenceId],
    items: [item],
  }));
}

function cUnits(evidence) {
  const bySource = new Map();
  for (const item of evidence) {
    const values = bySource.get(item.scope.sourceKey) ?? [];
    values.push(item);
    bySource.set(item.scope.sourceKey, values);
  }
  const result = [];
  for (const [sourceKey, values] of bySource) {
    values.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    let current = [];
    for (const item of values) {
      const firstTime = current.length ? Date.parse(current[0].occurredAt) : null;
      if (
        current.length >= MAX_CONTEXT_ITEMS ||
        (firstTime !== null && Date.parse(item.occurredAt) - firstTime > WINDOW_MS)
      ) {
        result.push(current);
        current = [];
      }
      current.push(item);
    }
    if (current.length) result.push(current);
    void sourceKey;
  }
  return result.map((items) => ({
    unitId: `c_${digest(
      "third-brain/public-context-unit/v1",
      items.map((item) => item.evidenceId).join("\0"),
    ).slice(0, 24)}`,
    evidenceIds: items.map((item) => item.evidenceId),
    items,
  }));
}

function normalizedCandidate(candidate, strategy, evidenceById) {
  const evidenceIds = [...new Set(
    (Array.isArray(candidate?.evidenceIds) ? candidate.evidenceIds : [])
      .filter((id) => evidenceById.has(id)),
  )];
  if (evidenceIds.length === 0) return null;
  const title = cleanText(candidate.title || "待判断事项", 120);
  const semanticKey = cleanText(candidate.semanticKey || title.toLowerCase(), 160);
  if (!semanticKey) return null;
  return {
    title,
    latestChange: cleanText(candidate.latestChange || candidate.reason, 500),
    background: cleanText(candidate.background, 1_000),
    uncertainty: cleanText(candidate.uncertainty, 500),
    userDecision: cleanText(candidate.userDecision || candidate.nextQuestion, 500),
    semanticKey,
    evidenceIds,
    strategies: [strategy],
  };
}

function intersects(left, right) {
  const set = new Set(left);
  return right.some((value) => set.has(value));
}

function fuseCandidates(candidates, evidenceById) {
  const fused = [];
  for (const candidate of candidates) {
    const existing = fused.find((item) => (
      intersects(item.evidenceIds, candidate.evidenceIds)
      && item.semanticKey === candidate.semanticKey
    ));
    if (existing) {
      const candidateAddsContext = candidate.evidenceIds.length > existing.evidenceIds.length;
      existing.evidenceIds = [...new Set([...existing.evidenceIds, ...candidate.evidenceIds])];
      existing.strategies = [...new Set([...existing.strategies, ...candidate.strategies])].sort();
      if (candidateAddsContext) {
        existing.title = candidate.title || existing.title;
        existing.latestChange = candidate.latestChange || existing.latestChange;
        existing.background = candidate.background || existing.background;
        existing.uncertainty = candidate.uncertainty || existing.uncertainty;
        existing.userDecision = candidate.userDecision || existing.userDecision;
      } else if (!existing.background && candidate.background) {
        existing.background = candidate.background;
      }
      continue;
    }
    fused.push(structuredClone(candidate));
  }
  return fused.map((candidate) => {
    const evidence = candidate.evidenceIds
      .map((id) => evidenceById.get(id))
      .filter(Boolean)
      .toSorted((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const latest = evidence.at(-1)?.occurredAt ?? "";
    return Object.freeze({
      candidateId: `candidate_${digest(
        "third-brain/public-candidate/v1",
        `${candidate.semanticKey}\0${candidate.evidenceIds.toSorted().join("\0")}`,
      ).slice(0, 24)}`,
      revision: 1,
      title: candidate.title,
      latestChange: candidate.latestChange || "检测到需要用户复核的变化。",
      background: candidate.background || "当前只保留最少必要上下文。",
      uncertainty: candidate.uncertainty || "工作归属与重要性需要用户确认。",
      userDecision: candidate.userDecision || "请先确认工作归属，再判断重要性。",
      semanticKey: candidate.semanticKey,
      strategies: Object.freeze(candidate.strategies),
      evidence: Object.freeze(evidence),
      latestOccurredAt: latest,
      status: "pending_user_decision",
    });
  }).toSorted((left, right) => (
    right.latestOccurredAt.localeCompare(left.latestOccurredAt)
    || left.candidateId.localeCompare(right.candidateId)
  ));
}

export function createBcCandidatePipeline({ analyze }) {
  if (typeof analyze !== "function") throw new TypeError("analyze port is required");
  return Object.freeze({
    async run(evidence) {
      if (!Array.isArray(evidence)) throw new TypeError("Evidence array is required");
      const evidenceById = new Map(evidence.map((item) => [item.evidenceId, item]));
      const outputs = [];
      const summaries = [];
      const runs = [
        { strategy: "B", units: bUnits(evidence) },
        { strategy: "C", units: cUnits(evidence) },
      ];
      const settled = await Promise.allSettled(runs.map(({ strategy, units }) => (
        analyze({ strategy, units })
      )));
      if (settled.every((item) => item.status === "rejected")) {
        throw new Error("B 与 C 策略均分析失败；未生成候选");
      }
      const knownGaps = [];
      const strategyProvenance = [];
      for (let index = 0; index < runs.length; index += 1) {
        const { strategy, units } = runs[index];
        const settledRun = settled[index];
        if (settledRun.status === "rejected") {
          knownGaps.push({
            strategy,
            code: "strategy_failed",
            message: `${strategy} 策略分析失败；当前结果仅包含 ${strategy === "B" ? "C" : "B"} 策略。`,
          });
          strategyProvenance.push({
            strategy,
            status: "failed",
            unitCount: units.length,
            candidateCount: 0,
          });
          continue;
        }
        const result = settledRun.value;
        if (typeof result?.summary === "string" && result.summary.trim()) summaries.push(result.summary.trim());
        let candidateCount = 0;
        for (const candidate of Array.isArray(result?.candidates) ? result.candidates : []) {
          const normalized = normalizedCandidate(candidate, strategy, evidenceById);
          if (normalized) {
            outputs.push(normalized);
            candidateCount += 1;
          }
        }
        strategyProvenance.push({
          strategy,
          status: "complete",
          unitCount: units.length,
          candidateCount,
        });
      }
      return {
        schemaVersion: "public-bc-candidates/v1",
        extractorVersion: "public-bc-dual/v2",
        summary: [...new Set(summaries)].join("\n") || "暂无可靠摘要",
        candidates: fuseCandidates(outputs, evidenceById),
        knownGaps: Object.freeze(knownGaps),
        provenance: Object.freeze({ strategies: Object.freeze(strategyProvenance) }),
        counts: Object.freeze({
          evidence: evidence.length,
          bUnits: runs[0].units.length,
          cUnits: runs[1].units.length,
          rawCandidates: outputs.length,
        }),
      };
    },
  });
}
