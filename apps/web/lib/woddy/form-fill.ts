import { tKey } from "@/lib/i18n/keys";

/**
 * Fill with Woddy: a pasted WhatsApp message, email text or a business card photo read into a create form's
 * fields. Woddy only proposes values; the person reviews them in the form before anything is saved.
 */
export type FillFormKind = "enquiry" | "client" | "supplier" | "catalog_item";
export type FillFieldKind = "text" | "email" | "phone" | "url" | "list";
export type FillFieldSpec = { key: string; hint: string; max: number; kind?: FillFieldKind };
/** What was read: the field keys the form knows, each with a proposed value. */
export type FillProposal = Record<string, string>;
export type FillInput = { text?: string; image?: { mimeType: string; data: string } };

export const FILL_FIELDS: Record<FillFormKind, FillFieldSpec[]> = {
  enquiry: [
    { key: "customerName", hint: "the customer's full name", max: 240 },
    { key: "mobile", hint: "their mobile number, with the country code when given", max: 40, kind: "phone" },
    { key: "phone", hint: "another (landline) number", max: 40, kind: "phone" },
    { key: "email", hint: "their email address", max: 320, kind: "email" },
    { key: "company", hint: "their company or organisation", max: 240 },
    { key: "jobPosition", hint: "their job title", max: 160 },
    { key: "website", hint: "their website", max: 255, kind: "url" },
    { key: "address", hint: "a street address", max: 500 },
    { key: "area", hint: "the area, community or city of the property", max: 240 },
    { key: "summary", hint: "what they want done, in one or two sentences close to their own words", max: 2000 },
  ],
  client: [
    { key: "name", hint: "the person's or company's name", max: 240 },
    { key: "email", hint: "their email address", max: 320, kind: "email" },
    { key: "phone", hint: "their phone number, with the country code when given", max: 40, kind: "phone" },
  ],
  supplier: [
    { key: "name", hint: "the supplier's trading name", max: 240 },
    { key: "legalName", hint: "the registered company name, when different", max: 240 },
    { key: "categories", hint: "what they supply (materials or trades), as short category names", max: 400, kind: "list" },
    { key: "contactName", hint: "the contact person's name", max: 180 },
    { key: "phone", hint: "their phone number, with the country code when given", max: 40, kind: "phone" },
    { key: "email", hint: "their email address", max: 320, kind: "email" },
    { key: "locality", hint: "their city or area", max: 160 },
    { key: "taxRegistrationNumber", hint: "a tax registration number (VAT, GST, TRN)", max: 120 },
    { key: "notes", hint: "anything else useful to a buyer, briefly", max: 2000 },
  ],
  catalog_item: [
    { key: "name", hint: "the item's name as a buyer would search for it", max: 200 },
    { key: "code", hint: "a model, SKU or item code", max: 80 },
    { key: "unit", hint: "the unit it is sold in (for example pcs, sqm, m, kg, sheet)", max: 16 },
    { key: "description", hint: "a short description: material, finish, size", max: 2000 },
  ],
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Keeps only the fields this form knows, as trimmed text within their limits; anything doubtful is left out. */
export function cleanProposal(form: FillFormKind, raw: unknown): FillProposal {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const values = raw as Record<string, unknown>;
  const out: FillProposal = {};
  for (const field of FILL_FIELDS[form]) {
    const value = values[field.key];
    let text = Array.isArray(value) ? value.filter((item) => typeof item === "string").join(", ") : typeof value === "string" || typeof value === "number" ? String(value) : "";
    text = text.replace(/\s+/g, " ").trim();
    if (!text || text.length > field.max) continue;
    if (field.kind === "email" && !EMAIL.test(text)) continue;
    if (field.kind === "phone" && !/^\+?[\d\s().-]{6,}$/.test(text)) continue;
    out[field.key] = text;
  }
  return out;
}

/** Asks Woddy (through the workspace's AI gateway) to read the input into the form's fields. */
export async function fillWithWoddy(workspaceId: string, form: FillFormKind, input: FillInput, signal?: AbortSignal): Promise<FillProposal> {
  const response = await fetch("/api/workspace/form-fill", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, form, ...input }), signal,
  });
  const payload = await response.json().catch(() => null) as { fields?: FillProposal; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message || tKey("Woddy couldn't read that. Try again, or fill it in yourself."));
  return payload?.fields ?? {};
}

/** A picked image as the base64 the gateway takes (photos of cards and screenshots). */
export async function imageForWoddy(file: File): Promise<FillInput["image"]> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < buffer.length; index += 0x8000) binary += String.fromCharCode(...buffer.subarray(index, index + 0x8000));
  return { mimeType: file.type, data: btoa(binary) };
}
