import { tKey, type MessageKey } from "@/lib/i18n/keys";

/** What the client is buying on an enquiry that starts from a deal; it decides which stages and quotes apply. */
export const SERVICE_PATHS = [
  { label: tKey("Design + fitout / furniture"), scope: { design: true, mainQuotation: true, materialSelection: true, procurement: true, manufacturing: true, siteWorks: true, installation: true } },
  { label: tKey("Design / moodboards only"), scope: { design: true, mainQuotation: false, materialSelection: false, procurement: false, manufacturing: false, siteWorks: false, installation: false } },
  { label: tKey("Made-to-order furniture"), scope: { design: false, mainQuotation: true, materialSelection: true, procurement: true, manufacturing: true, siteWorks: false, installation: true } },
  { label: tKey("Ready-made furniture"), scope: { design: false, mainQuotation: true, materialSelection: false, procurement: true, manufacturing: false, siteWorks: false, installation: true } },
] as const;

/**
 * The service a case's path already implies (PLM-121/126), as an index into SERVICE_PATHS: design work buys design
 * and the rest; otherwise goods made in production are made-to-order furniture and goods from stock or a supplier are
 * ready-made. Chosen by what each service includes, never by its label. Without a path's own plan: the first one.
 */
export function defaultServicePath(plan?: { source: string; design: boolean; release: "production" | "fulfilment" } | null): number {
  if (!plan || plan.source !== "path") return 0;
  const index = SERVICE_PATHS.findIndex(({ scope }) => plan.design
    ? scope.design && scope.mainQuotation
    : !scope.design && scope.mainQuotation && scope.manufacturing === (plan.release === "production"));
  return Math.max(0, index);
}

/**
 * What a quote is, as its Type reads: a variation, the design fee, or the order itself, named by what the client buys.
 * The service chosen for the deal decides (work on site is a fit-out, goods alone are furniture); without one, the
 * case's path does (goods from stock, a supplier or made to order without a BOQ are furniture). Never by a label.
 */
export function quoteTypeLabel(quote: { kind: string; round?: string | null }, scope?: { siteWorks: boolean } | null,
  plan?: { source: string } | null): MessageKey {
  if (quote.kind === "variation") return tKey("Variation");
  if (quote.round === "design") return tKey("Design fee");
  if (scope) return scope.siteWorks ? tKey("Fit-out") : tKey("Furniture");
  return plan?.source === "path" ? tKey("Furniture") : tKey("Fit-out");
}
