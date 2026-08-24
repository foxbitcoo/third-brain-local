import { createHash } from "node:crypto";
export function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
export function canonicalDigest(domain, value) { return createHash("sha256").update(`${domain}\0`).update(canonicalJson(value)).digest("hex"); }
export function immutableCopy(value) { const copy = structuredClone(value); const freeze = (item) => { if (item && typeof item === "object" && !Object.isFrozen(item)) { Object.values(item).forEach(freeze); Object.freeze(item); } return item; }; return freeze(copy); }
