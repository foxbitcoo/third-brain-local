// SPDX-License-Identifier: AGPL-3.0-only

const EMPTY_CANDIDATES = Object.freeze([]);

export function validateCandidateSet(candidates = EMPTY_CANDIDATES) {
  if (!Array.isArray(candidates) || candidates.length !== 0) {
    return { accepted: false, reason: "bundled_business_fixtures_forbidden" };
  }
  return { accepted: true, reason: "installer_data_required" };
}

export function createPublicCandidateWorkbench({ store } = {}) {
  if (!store) throw new TypeError("local store is required");
  return Object.freeze({
    async read() {
      return {
        mode: "installer_data_only",
        candidateOnly: true,
        automaticStateChanges: false,
        setLineage: validateCandidateSet(),
        candidates: [],
      };
    },
    async confirmConflict() {
      throw new Error("公开版不内置人物、项目或群聊示例；请先导入安装者自己的数据");
    },
  });
}

export { EMPTY_CANDIDATES as SYNTHETIC_CANDIDATES };
