import { BadRequestException } from "@nestjs/common";

/** The document styles a quote can use; each is designed in the web app. */
export const DOCUMENT_STYLES = ["atelier", "minimal", "noir", "terrazzo", "nordic", "botanical", "coastal", "monochrome", "heritage", "linen", "studio", "marble"] as const;
export type DocumentStyle = (typeof DOCUMENT_STYLES)[number];
const SECTIONS = ["cover", "intro", "summary", "items", "payments", "terms", "acceptance"] as const;

/** How the client document looks and reads: the style, the texts and which sections show. Items and money come from the quote itself. */
export type QuoteDocument = {
  style: DocumentStyle;
  accent: string | null;
  sections: Record<(typeof SECTIONS)[number], boolean>;
  title: string; subtitle: string; intro: string; terms: string; exclusions: string;
  itemsView: "area" | "trade" | "area_trade"; itemsDetail: "lines" | "totals"; showRates: boolean; showDescriptions: boolean;
  coverAssetId: string | null;
};

export function defaultDocument(input: { terms?: string; exclusions?: string; view?: QuoteDocument["itemsView"] }): QuoteDocument {
  return {
    style: "atelier", accent: null,
    sections: { cover: true, intro: true, summary: true, items: true, payments: true, terms: true, acceptance: true },
    title: "", subtitle: "", intro: "", terms: input.terms ?? "", exclusions: input.exclusions ?? "",
    itemsView: input.view ?? "area", itemsDetail: "lines", showRates: true, showDescriptions: true, coverAssetId: null,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Validates a document change against the current one; unknown keys are ignored. */
export function parseDocument(input: Record<string, unknown>, current: QuoteDocument): QuoteDocument {
  const next: QuoteDocument = { ...current, sections: { ...current.sections } };
  const text = (key: "title" | "subtitle" | "intro" | "terms" | "exclusions", max: number) => {
    if (input[key] === undefined) return;
    if (typeof input[key] !== "string") throw new BadRequestException(`${key} must be text.`);
    const value = (input[key] as string).trim();
    if (value.length > max) throw new BadRequestException(`Keep the ${key} under ${max} characters.`);
    next[key] = value;
  };
  if (input.style !== undefined) {
    if (!(DOCUMENT_STYLES as readonly string[]).includes(String(input.style))) throw new BadRequestException("Choose one of the document styles.");
    next.style = input.style as DocumentStyle;
  }
  if (input.accent !== undefined) {
    if (input.accent !== null && (typeof input.accent !== "string" || !/^#[0-9a-f]{6}$/i.test(input.accent))) throw new BadRequestException("Choose a colour like #1f6f5c.");
    next.accent = input.accent as string | null;
  }
  if (input.sections !== undefined) {
    if (!input.sections || typeof input.sections !== "object") throw new BadRequestException("Choose which sections show.");
    for (const key of SECTIONS) {
      const value = (input.sections as Record<string, unknown>)[key];
      if (value !== undefined) { if (typeof value !== "boolean") throw new BadRequestException("Choose which sections show."); next.sections[key] = value; }
    }
  }
  text("title", 200); text("subtitle", 300); text("intro", 6000); text("terms", 30000); text("exclusions", 12000);
  if (input.itemsView !== undefined) { if (!["area", "trade", "area_trade"].includes(String(input.itemsView))) throw new BadRequestException("Choose how items are grouped."); next.itemsView = input.itemsView as QuoteDocument["itemsView"]; }
  if (input.itemsDetail !== undefined) { if (!["lines", "totals"].includes(String(input.itemsDetail))) throw new BadRequestException("Choose lines or totals."); next.itemsDetail = input.itemsDetail as QuoteDocument["itemsDetail"]; }
  for (const key of ["showRates", "showDescriptions"] as const)
    if (input[key] !== undefined) { if (typeof input[key] !== "boolean") throw new BadRequestException("Expected yes or no."); next[key] = input[key] as boolean; }
  if (input.coverAssetId !== undefined) {
    if (input.coverAssetId !== null && (typeof input.coverAssetId !== "string" || !UUID.test(input.coverAssetId))) throw new BadRequestException("Choose a cover image from this project.");
    next.coverAssetId = input.coverAssetId as string | null;
  }
  return next;
}
