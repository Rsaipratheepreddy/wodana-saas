import type { MoodboardPlacement, ScopeEntry } from "./content";

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

export const PIN_WIDTH = 240;
const GAP = 24;

/**
 * Where every pin sits. Placed pins keep their saved spot; new ones flow into a grid below the
 * existing pins so nothing ever lands on top of something else.
 */
export function layoutPins(entries: ScopeEntry[], columns = 4): Map<string, MoodboardPlacement> {
  const result = new Map<string, MoodboardPlacement>();
  let maxY = 0; let maxZ = 0;
  for (const entry of entries) {
    if (!entry.board) continue;
    result.set(entry.id, entry.board);
    maxY = Math.max(maxY, entry.board.y + 320);
    maxZ = Math.max(maxZ, entry.board.z);
  }
  const unplaced = entries.filter((entry) => !entry.board);
  unplaced.forEach((entry, index) => {
    const column = index % columns; const row = Math.floor(index / columns);
    result.set(entry.id, { x: column * (PIN_WIDTH + GAP), y: (result.size && maxY ? maxY + GAP : 0) + row * (300 + GAP), width: PIN_WIDTH, z: maxZ + index + 1, sentiment: "love" });
  });
  return result;
}

export const clampZoom = (value: number) => Math.min(2.5, Math.max(0.25, Math.round(value * 100) / 100));

/** Zoom around a point on screen so the spot under the cursor stays put. */
export function zoomAround(view: { x: number; y: number; zoom: number }, point: { x: number; y: number }, nextZoom: number) {
  const zoom = clampZoom(nextZoom);
  const worldX = (point.x - view.x) / view.zoom; const worldY = (point.y - view.y) / view.zoom;
  return { zoom, x: point.x - worldX * zoom, y: point.y - worldY * zoom };
}

/** The view that fits every pin into a viewport with some breathing room. */
export function fitView(placements: MoodboardPlacement[], viewport: { width: number; height: number }) {
  if (!placements.length) return { x: 48, y: 48, zoom: 1 };
  const minX = Math.min(...placements.map((p) => p.x)); const minY = Math.min(...placements.map((p) => p.y));
  const maxX = Math.max(...placements.map((p) => p.x + p.width)); const maxY = Math.max(...placements.map((p) => p.y + p.width * 1.25));
  const zoom = clampZoom(Math.min(1, (viewport.width - 96) / Math.max(1, maxX - minX), (viewport.height - 96) / Math.max(1, maxY - minY)));
  return { zoom, x: 48 - minX * zoom, y: 48 - minY * zoom };
}
