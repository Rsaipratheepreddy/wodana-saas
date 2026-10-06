/** Product sourcing (plan §6.7a batch 3): the product clipper, link cards (Canva) and the fit check. */

import { readWithin } from "./read-within";

export const CLIP_FIELDS = ["name", "brand", "sku", "description", "price", "currency", "width", "depth", "height", "diagonal_depth", "dimension_unit", "finish", "material", "colour", "lead_time_days"] as const;
export type ClipField = (typeof CLIP_FIELDS)[number];
export type ClipSource = "structured_data" | "open_graph" | "page_text" | "ai" | "person";
export type ClipFieldRow = {
  field: ClipField; proposedValue: string | null; source: ClipSource; confidence: number | null; evidence: string | null; model: string | null;
  decision: "pending" | "accepted" | "edited" | "rejected" | "added"; finalValue: string | null; confirmedBy: string | null; confirmedByName: string | null; confirmedAt: string | null;
};
export type ProductClip = {
  id: string; catalogId: string; sourceUrl: string; finalUrl: string; host: string; pageTitle: string | null; aiStatus: "used" | "not_needed" | "off" | "failed"; aiModel: string | null;
  status: "review" | "saved" | "discarded"; catalogItemId: string | null; savedAt: string | null; fetchedAt: string; version: number;
  fields: ClipFieldRow[]; images: Array<{ id: string; position: number; hasPreview: boolean }>; defaults: { unit: string; currency: string | null };
  itemId?: string | null;
};
export type ItemSize = { width: string | null; depth: string | null; height: string | null; diagonalDepth: string | null; unit: string; source?: string; version: number };
export type ItemSource = { size: ItemSize | null; defaultUnit: string; source: ProductClip | null };
export type LinkCard = { id: string; url: string; provider: "canva" | "web"; title: string | null; hasImage: boolean; status: "ok" | "unavailable"; host: string };

export type FitStatus = "fits" | "tight" | "does_not_fit" | "unknown";
export type AccessKind = "door" | "lift" | "stair" | "corridor" | "window" | "other";
export type AccessPoint = {
  id: string; route: string; position: number; kind: AccessKind; label: string; unit: string; width: string | null; height: string | null; turnWidth: string | null;
  cabinWidth: string | null; cabinDepth: string | null; cabinHeight: string | null; siteRecordId: string | null; note: string; version: number;
};
export type PointResult = { pointId: string; label: string; kind: AccessKind; route: string; status: FitStatus; way: string | null; spareMm: number | null; missing: string[] };
export type ItemFit = {
  itemId: string; name: string; size: (ItemSize & { version: number }) | null; inputsHash: string; blocksOrdering: boolean;
  result: { status: FitStatus; reason: "no_access_points" | "item_size_missing" | null; routes: Array<{ route: string; status: FitStatus; points: PointResult[] }>; clearanceMm: number };
  override: { id: string; reason: string; context: string; overriddenBy: string; overriddenByName: string | null; overriddenAt: string } | null;
};

export class SourcingRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "SourcingRequestError"; }
}

export function sourcingUrl(workspaceId: string, path: string, query: Record<string, string> = {}) {
  return `/api/workspace/product-sourcing/${path.replace(/^\/+|\/+$/g, "")}?${new URLSearchParams({ ...query, workspaceId })}`;
}

export async function sourcingApi<T>(workspaceId: string, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const run = async () => {
    const response = await fetch(sourcingUrl(workspaceId, path), init?.body === undefined ? { method: init?.method ?? "GET" } : {
      method: init?.method ?? "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(init.body),
    });
    const payload = await response.json().catch(() => null) as { message?: string | string[] } | null;
    if (!response.ok) throw new SourcingRequestError(Array.isArray(payload?.message) ? payload.message.join(". ") : payload?.message ?? "Something went wrong. Try again.", response.status);
    return payload as T;
  };
  // A read that never answers fails in time, so the panel shows its error and Retry rather than a skeleton forever.
  return init?.body === undefined && (init?.method ?? "GET") === "GET" ? readWithin(run()) : run();
}

export const clipImageUrl = (workspaceId: string, clipId: string, imageId: string) => sourcingUrl(workspaceId, `clips/${clipId}/images/${imageId}`, { preview: "1" });
export const linkCardImageUrl = (workspaceId: string, previewId: string) => sourcingUrl(workspaceId, `link-previews/${previewId}/image`);

/**
 * The browser button: a bookmarklet that opens the catalog with the current page's address ready to read. It only
 * navigates; the page is read by the server after the person presses Read.
 */
export function clipperBookmarklet(origin: string) {
  return `javascript:(()=>{location.href=${JSON.stringify(`${origin}/workspace/catalogs?clip=`)}+encodeURIComponent(location.href)})()`;
}

/** A catalog code from the shop's SKU or the name: upper-case letters, digits and dashes. */
export function suggestedCode(sku: string | null | undefined, name: string | null | undefined) {
  const base = (sku || name || "ITEM").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().toUpperCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 40);
  return base || "ITEM";
}

/** Millimetres in the viewer's unit, for "spare" figures. */
export function fromMm(mm: number, unit: string) {
  const factor: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
  const value = mm / (factor[unit] ?? 1);
  return Math.round(value * 10) / 10;
}
