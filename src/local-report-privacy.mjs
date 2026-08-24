import { createHash } from "node:crypto";

const RULES = Object.freeze([
  ["credential", /\b(?:gh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}|kso_(?:ac|rt)_[A-Za-z0-9._-]{12,}|(?:oauth[_ -]?code|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|cookie|authorization|bearer)\s*[:=]?\s*[^\s,;]+)/iu],
  ["link", /\b[a-z][a-z0-9+.-]*:\/\/[^\s)\]}>]+/iu],
  ["local_path", /(?:\/(?:Users|home|private|tmp|var)\/[^\s,;]+|[A-Za-z]:\\Users\\[^\s,;]+)/u],
  ["stable_identifier", /\b(?:session|conversation|chat|user|tenant|evidence|source)[_-]?id\s*[:=]\s*[A-Za-z0-9._-]{6,}/iu],
]);

export function createLocalReportPrivacyScanner() {
  return Object.freeze({
    scan(envelope) {
      const content = JSON.stringify(envelope);
      const findingCodes = RULES.filter(([, rule]) => rule.test(content)).map(([code]) => code);
      return {
        status: findingCodes.length === 0 ? "manual_review_required" : "blocked",
        coverage: "generic_patterns_only",
        scannerVersion: "generic-local-rules-v2",
        denylistDigest: createHash("sha256").update("private-denylist-unavailable").digest("hex"),
        findingCodes,
      };
    },
  });
}
