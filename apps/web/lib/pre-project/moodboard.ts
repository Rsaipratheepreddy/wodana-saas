import type { ScopeEntry } from "./content";

export type PinKind = "image" | "link" | "note";
export type Platform = { id: string; label: string };

const PLATFORMS: Array<[RegExp, Platform]> = [
  [/(^|\.)instagram\.com$/, { id: "instagram", label: "Instagram" }],
  [/(^|\.)pinterest\.[a-z.]+$|(^|\.)pin\.it$/, { id: "pinterest", label: "Pinterest" }],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, { id: "youtube", label: "YouTube" }],
  [/(^|\.)tiktok\.com$/, { id: "tiktok", label: "TikTok" }],
  [/(^|\.)houzz\.[a-z.]+$/, { id: "houzz", label: "Houzz" }],
  [/(^|\.)behance\.net$/, { id: "behance", label: "Behance" }],
];

/** Which kind of pin an inspiration record is: photos win, then a link, else a note. */
export function pinKind(entry: Pick<ScopeEntry, "assets" | "referenceUrl">): PinKind {
  if (entry.assets.some((asset) => asset.mimeType.startsWith("image/"))) return "image";
  if (entry.referenceUrl) return "link";
  return "note";
}

export function linkPlatform(url: string): Platform & { host: string } {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const match = PLATFORMS.find(([pattern]) => pattern.test(host));
    return { ...(match?.[1] ?? { id: "web", label: host }), host };
  } catch {
    return { id: "web", label: url, host: url };
  }
}
