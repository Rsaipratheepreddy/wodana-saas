import { tKey } from "@/lib/i18n/keys";

/** What the client is buying on an enquiry that starts from a deal; it decides which stages and quotes apply. */
export const SERVICE_PATHS = [
  { label: tKey("Design + fitout / furniture"), scope: { design: true, mainQuotation: true, materialSelection: true, procurement: true, manufacturing: true, siteWorks: true, installation: true } },
  { label: tKey("Design / moodboards only"), scope: { design: true, mainQuotation: false, materialSelection: false, procurement: false, manufacturing: false, siteWorks: false, installation: false } },
  { label: tKey("Made-to-order furniture"), scope: { design: false, mainQuotation: true, materialSelection: true, procurement: true, manufacturing: true, siteWorks: false, installation: true } },
  { label: tKey("Ready-made furniture"), scope: { design: false, mainQuotation: true, materialSelection: false, procurement: true, manufacturing: false, siteWorks: false, installation: true } },
] as const;
