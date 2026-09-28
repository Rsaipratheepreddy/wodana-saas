import { createHash } from "node:crypto";

/**
 * Stable identifiers for everything the seed creates, so a second run finds what the first made:
 * a UUID v5 of a namespace (the workspace slug) and a key such as "room:living-room".
 */
export function stableId(namespace: string, key: string) {
  const hash = createHash("sha1").update(`wodana-seed:${namespace}:${key}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** A short, filesystem- and log-safe slug for a name. */
export function slugOf(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";
}
