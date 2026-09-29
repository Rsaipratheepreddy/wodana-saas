import type { TemplateVariableSource } from "./inbox-rules";

/**
 * The starter pack: one utility template per client event, in each language we ship, with every {{n}} already
 * mapped to a record field. Meta's rules hold for all of them: a body never starts or ends with a variable,
 * variables are numbered 1…n in order, and there is enough fixed text around them.
 */
export type StarterEvent =
  | "crm.enquiry.created" | "portal.quote_issued" | "portal.invoice_issued" | "receivables.payment_received"
  | "portal.decision_waiting" | "portal.update_published" | "project.stage_started" | "payments.reminder";

export type StarterTemplate = {
  key: string;
  event: StarterEvent;
  /** Meta's template name (lowercase, underscores). */
  name: string;
  sources: TemplateVariableSource[];
  bodies: Record<StarterLanguage, string>;
};

export const STARTER_LANGUAGES = ["en", "ar"] as const;
export type StarterLanguage = (typeof STARTER_LANGUAGES)[number];

export const STARTER_PACK: StarterTemplate[] = [
  {
    key: "enquiry_welcome", event: "crm.enquiry.created", name: "wd_enquiry_welcome",
    sources: ["contact.first_name", "business.name", "enquiry.reference"],
    bodies: {
      en: "Hello {{1}}, thank you for contacting {{2}}. We have received your enquiry {{3}} and will be in touch shortly.",
      ar: "مرحبًا {{1}}، شكرًا لتواصلك مع {{2}}. لقد استلمنا طلبك {{3}} وسنتواصل معك قريبًا.",
    },
  },
  {
    key: "quote_ready", event: "portal.quote_issued", name: "wd_quote_ready",
    sources: ["contact.first_name", "quote.number", "portal.link"],
    bodies: {
      en: "Hello {{1}}, your quotation {{2}} is ready. You can review and approve it here: {{3}} Thank you.",
      ar: "مرحبًا {{1}}، عرض السعر {{2}} جاهز. يمكنك مراجعته والموافقة عليه هنا: {{3}} شكرًا لك.",
    },
  },
  {
    key: "invoice_issued", event: "portal.invoice_issued", name: "wd_invoice_issued",
    sources: ["contact.first_name", "invoice.number", "invoice.total", "portal.link"],
    bodies: {
      en: "Hello {{1}}, invoice {{2}} for {{3}} has been issued. You can view and pay it here: {{4}} Thank you.",
      ar: "مرحبًا {{1}}، تم إصدار الفاتورة {{2}} بقيمة {{3}}. يمكنك عرضها ودفعها هنا: {{4}} شكرًا لك.",
    },
  },
  {
    key: "payment_received", event: "receivables.payment_received", name: "wd_payment_received",
    sources: ["contact.first_name", "payment.amount", "business.name"],
    bodies: {
      en: "Hello {{1}}, we have received your payment of {{2}}. Thank you for choosing {{3}}.",
      ar: "مرحبًا {{1}}، لقد استلمنا دفعتك بقيمة {{2}}. شكرًا لاختيارك {{3}}.",
    },
  },
  {
    key: "decision_waiting", event: "portal.decision_waiting", name: "wd_decision_waiting",
    sources: ["contact.first_name", "project.name", "portal.link"],
    bodies: {
      en: "Hello {{1}}, a decision on {{2}} is waiting for you. Please review it here: {{3}} Thank you.",
      ar: "مرحبًا {{1}}، هناك قرار بخصوص {{2}} بانتظارك. يرجى مراجعته هنا: {{3}} شكرًا لك.",
    },
  },
  {
    key: "update_published", event: "portal.update_published", name: "wd_update_published",
    sources: ["contact.first_name", "project.name", "portal.link"],
    bodies: {
      en: "Hello {{1}}, there is a new update on {{2}}. See the latest progress here: {{3}} Thank you.",
      ar: "مرحبًا {{1}}، يوجد تحديث جديد على {{2}}. شاهد آخر التقدم هنا: {{3}} شكرًا لك.",
    },
  },
  {
    key: "stage_started", event: "project.stage_started", name: "wd_stage_started",
    sources: ["contact.first_name", "project.name", "project.stage", "portal.link"],
    bodies: {
      en: "Hello {{1}}, {{2}} has moved to a new stage: {{3}}. Follow the progress here: {{4}} Thank you.",
      ar: "مرحبًا {{1}}، انتقل {{2}} إلى مرحلة جديدة: {{3}}. تابع التقدم هنا: {{4}} شكرًا لك.",
    },
  },
  {
    key: "payment_due", event: "payments.reminder", name: "wd_payment_due",
    sources: ["contact.first_name", "payment.amount", "invoice.due_date", "portal.link"],
    bodies: {
      en: "Hello {{1}}, this is a reminder that {{2}} is due on {{3}}. You can pay here: {{4}} Thank you.",
      ar: "مرحبًا {{1}}، نذكّرك بأن مبلغ {{2}} مستحق في {{3}}. يمكنك الدفع هنا: {{4}} شكرًا لك.",
    },
  },
];

/** The starter template a stored template came from, by its Meta name. */
export const starterByName = (name: string) => STARTER_PACK.find((template) => template.name === name) ?? null;
export const starterForEvent = (event: string) => STARTER_PACK.find((template) => template.event === event) ?? null;

/** Sample values Meta reviews with the template, in the workspace's own currency, locale and name. */
export function sampleValues(template: StarterTemplate, region: { businessName: string; currency: string; locale: string; webOrigin: string }) {
  const money = (amount: number) => { try { return new Intl.NumberFormat(region.locale, { style: "currency", currency: region.currency }).format(amount); } catch { return `${region.currency} ${amount}`; } };
  const date = (() => { try { return new Intl.DateTimeFormat(region.locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 9, 15, 12))); } catch { return "15 Oct 2026"; } })();
  const samples: Record<TemplateVariableSource, string> = {
    "contact.first_name": "Noura", "contact.name": "Noura Haddad", "enquiry.reference": "E-0101", "opportunity.reference": "O-0101",
    "project.name": "Villa renovation", "project.stage": "Joinery", "quote.number": "V2", "invoice.number": "INV-0101",
    "invoice.total": money(12500), "invoice.due_date": date, "payment.amount": money(12500), "portal.link": `${region.webOrigin.replace(/\/$/, "")}/portal`,
    "staff.first_name": "Sara", "business.name": region.businessName, "today.date": date,
  };
  return template.sources.map((source) => samples[source]);
}

/** Meta's rules for a body, so a bad template is refused before it is submitted. Null when it is fine. */
export function metaBodyProblem(body: string, variables: number) {
  const trimmed = body.trim();
  if (/^\{\{\s*\d+\s*\}\}/.test(trimmed) || /\{\{\s*\d+\s*\}\}$/.test(trimmed)) return "A template can't start or end with a variable";
  const positions = [...trimmed.matchAll(/\{\{\s*(\d{1,2})\s*\}\}/g)].map((match) => Number(match[1]));
  const distinct = [...new Set(positions)].sort((a, b) => a - b);
  if (distinct.length !== variables || distinct.some((position, index) => position !== index + 1)) return "Variables must be numbered 1, 2, 3…";
  const fixed = trimmed.replace(/\{\{\s*\d+\s*\}\}/g, "").replace(/\s+/g, " ").trim();
  if (fixed.split(" ").length < variables * 2 + 1) return "Add more fixed text around the variables";
  if (trimmed.length > 1024) return "A template body is at most 1,024 characters";
  return null;
}
