import { tKey } from "@/lib/i18n/keys";

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
