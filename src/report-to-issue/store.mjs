import { immutableCopy } from "./canonical.mjs";

export function createInMemoryReportStore() {
  const records = new Map();
  const receiptToDraft = new Map();
  return Object.freeze({
    load(draftId) {
      const record = records.get(draftId);
      return record === undefined ? null : immutableCopy(record);
    },
    save(record) {
      records.set(record.draftId, immutableCopy(record));
      for (const receipt of record.confirmations ?? []) {
        receiptToDraft.set(receipt.receiptId, record.draftId);
      }
    },
    loadByReceipt(receiptId) {
      const draftId = receiptToDraft.get(receiptId);
      if (draftId === undefined) return null;
      return immutableCopy(records.get(draftId));
    },
  });
}
