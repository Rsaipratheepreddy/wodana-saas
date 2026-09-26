import { BadRequestException } from "@nestjs/common";
import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

export const APPROVALS = ["pending", "approved", "not_approved", "on_hold"] as const;
export const PAYMENT_TERMS = ["upfront", "on_delivery", "split", "credit", "statement"] as const;
export const DEALS = ["none", "discount", "commission", "on_request"] as const;
export type Approval = (typeof APPROVALS)[number];
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];
export type Deal = (typeof DEALS)[number];

export type Supplier = {
  id: string; code: string; name: string; legalName: string | null; categories: string[];
  approval: Approval; preferredFor: string[]; approvalNote: string; approvalAt: string | null; approvalByName: string | null;
  paymentTerms: PaymentTerms; advancePercent: string | null; creditDays: number | null; termsNote: string;
  deal: Deal; dealPercent: string | null; dealNote: string;
  contactName: string | null; phone: string | null; email: string | null; locality: string | null;
  entityIds: string[]; taxRegistrationNumber: string | null; currency: string | null; notes: string;
  status: "draft" | "active" | "archived"; archivedReason: string | null; version: number;
};

const SELECT = `SELECT vendor.id, vendor.code, vendor.display_name AS name, vendor.legal_name AS "legalName", vendor.categories,
  vendor.approval, vendor.preferred_for AS "preferredFor", vendor.approval_note AS "approvalNote", vendor.approval_at AS "approvalAt", approver.display_name AS "approvalByName",
  vendor.payment_terms AS "paymentTerms", vendor.advance_percent::text AS "advancePercent", vendor.credit_days AS "creditDays", vendor.terms_note AS "termsNote",
  vendor.deal, vendor.deal_percent::text AS "dealPercent", vendor.deal_note AS "dealNote",
  site.contact_name AS "contactName", site.phone, site.email, site.locality,
  coalesce((SELECT array_agg(link.legal_entity_id ORDER BY link.created_at) FROM vendor_legal_entities link
             WHERE link.workspace_id = vendor.workspace_id AND link.vendor_id = vendor.id), '{}') AS "entityIds",
  vendor.tax_registration_number AS "taxRegistrationNumber", vendor.default_currency AS currency, vendor.notes, vendor.status,
  vendor.archived_reason AS "archivedReason", vendor.version
  FROM workspace_vendors vendor
  LEFT JOIN users approver ON approver.id = vendor.approval_by
  LEFT JOIN LATERAL (SELECT contact_name, phone, email, locality FROM workspace_vendor_sites
                      WHERE workspace_id = vendor.workspace_id AND vendor_id = vendor.id AND status = 'active' ORDER BY is_primary DESC, created_at LIMIT 1) site ON true`;

export async function readSuppliers(db: Db, workspaceId: string): Promise<Supplier[]> {
  return (await db.query<Supplier>(`${SELECT} WHERE vendor.workspace_id = $1 ORDER BY lower(vendor.display_name)`, [workspaceId])).rows;
}

export async function readSupplier(db: Db, workspaceId: string, id: string, lock = false): Promise<Supplier | undefined> {
  if (lock) await db.query(`SELECT 1 FROM workspace_vendors WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, id]);
  return (await db.query<Supplier>(`${SELECT} WHERE vendor.workspace_id = $1 AND vendor.id = $2`, [workspaceId, id])).rows[0];
}

/** Trimmed, de-duplicated (ignoring case) categories, keeping the spelling the workspace already uses. */
export function cleanCategories(value: unknown, known: string[] = []): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) throw new BadRequestException("A supplier has up to 20 categories.");
  const byKey = new Map(known.map((item) => [item.toLocaleLowerCase(), item]));
  const seen = new Map<string, string>();
  for (const raw of value) {
    const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
    if (!text) continue;
    if (text.length > 60) throw new BadRequestException("Keep each category under 60 characters.");
    const key = text.toLocaleLowerCase();
    if (!seen.has(key)) seen.set(key, byKey.get(key) ?? text);
  }
  return [...seen.values()];
}

/** A percentage above 0 and below 100 with up to two decimals, as an exact string. */
export function percent(value: unknown, label: string): string {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim().replace(/%$/, "").trim() : "";
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text) || Number(text) <= 0) throw new BadRequestException(`${label} is a percentage between 0 and 100.`);
  return text;
}

// ---------- reading a supplier list someone already keeps ----------
const normalName = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
export { normalName };

/** Payment terms written in words ("Payment upfront", "50 / 50", "SOA end of month", "30 days after delivery"). */
export function readTerms(text: string): { paymentTerms: PaymentTerms; advancePercent: string | null; creditDays: number | null; termsNote: string } {
  const raw = text.replace(/\s+/g, " ").trim();
  const lower = raw.toLocaleLowerCase();
  const note = (canonical: RegExp) => (canonical.test(lower) ? "" : raw.slice(0, 500));
  const split = lower.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (split && Number(split[1]) + Number(split[2]) === 100 && Number(split[1]) > 0 && Number(split[1]) < 100)
    return { paymentTerms: "split", advancePercent: split[1], creditDays: null, termsNote: note(/^\d{1,2}\s*\/\s*\d{1,2}$/) };
  const days = lower.match(/(\d{1,3})\s*days?/);
  if (days && Number(days[1]) >= 1 && Number(days[1]) <= 365) return { paymentTerms: "credit", advancePercent: null, creditDays: Number(days[1]), termsNote: note(/^\d{1,3}\s*days?$/) };
  if (/\bsoa\b|statement|end of (the )?month|month[- ]end|monthly/.test(lower)) return { paymentTerms: "statement", advancePercent: null, creditDays: null, termsNote: note(/^(soa|month end - soa)$/) };
  if (/after delivery|on delivery|upon delivery|\bcod\b|cash on delivery/.test(lower)) return { paymentTerms: "on_delivery", advancePercent: null, creditDays: null, termsNote: note(/^payment after delivery$/) };
  return { paymentTerms: "upfront", advancePercent: null, creditDays: null, termsNote: raw && !/^(payment upfront|upfront|direct payment|n\/a|none|-)$/.test(lower) ? raw.slice(0, 500) : "" };
}

/** A discount or commission written in words ("10%", "0.1", "Discount as requested", "15% discount reflected on invoice"). */
export function readDeal(text: string): { deal: Deal; dealPercent: string | null; dealNote: string } {
  const raw = text.replace(/\s+/g, " ").trim();
  const lower = raw.toLocaleLowerCase();
  if (!raw || /^(n\/a|na|none|no|nil|-|0)$/.test(lower)) return { deal: "none", dealPercent: null, dealNote: "" };
  const kind: Deal = /commission|\bcomm\b/.test(lower) && !/discount/.test(lower) ? "commission" : "discount";
  const numeric = lower.match(/^(0?\.\d+|\d{1,2}(\.\d{1,2})?)\s*%?$/);
  const inText = lower.match(/(\d{1,2}(\.\d{1,2})?)\s*%/);
  const value = numeric ? (Number(numeric[1]) < 1 ? Math.round(Number(numeric[1]) * 10000) / 100 : Number(numeric[1])) : inText ? Number(inText[1]) : null;
  if (value && value > 0 && value < 100) return { deal: kind, dealPercent: String(value), dealNote: numeric ? "" : raw.slice(0, 500) };
  return { deal: "on_request", dealPercent: null, dealNote: raw.slice(0, 500) };
}

/**
 * What an approval column says: "Not approved"; nothing (not reviewed yet); "Nominated …" or "Preferred …"
 * (approved and the preferred supplier for its category); anything else names what it's approved for.
 */
export function readApproval(text: string): { approval: Approval; preferred: boolean } {
  const lower = text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  if (/not\s+approved|rejected|blacklist/.test(lower)) return { approval: "not_approved", preferred: false };
  if (!lower || /^(n\/a|na|none|no|nil|-|pending|not reviewed)$/.test(lower)) return { approval: "pending", preferred: false };
  if (/nominated|preferred/.test(lower)) return { approval: "approved", preferred: true };
  return { approval: "approved", preferred: false };
}

/** A short, unique supplier code from its name (SIOM-MARBLE-GRANITE, SIOM-MARBLE-GRANITE-2…). */
export async function supplierCode(db: Db, workspaceId: string, name: string) {
  const base = name.normalize("NFKD").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-(LLC|L-L-C|FZE|FZCO|FZ|CO|TR|TRADING|LTD|INC)$/g, "").slice(0, 40) || "SUPPLIER";
  const taken = new Set((await db.query<{ code: string }>(`SELECT lower(code) AS code FROM workspace_vendors WHERE workspace_id = $1 AND lower(code) LIKE lower($2) || '%'`, [workspaceId, base])).rows.map((row) => row.code));
  if (!taken.has(base.toLowerCase())) return base;
  for (let index = 2; ; index++) if (!taken.has(`${base}-${index}`.toLowerCase())) return `${base}-${index}`;
}
