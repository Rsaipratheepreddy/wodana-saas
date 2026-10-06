import type { PoolClient } from "pg";
import { effectivePortalBrand } from "../commercial/effective-brand";
import { quotePricingSnapshot } from "../quotation/quotation-builder.service";
import { markupDisclosure, presentForClient, type MarkupDisclosure } from "./markup-disclosure";
import { pdfLetterhead } from "./pdf-letterhead";
import type { ObjectStore } from "./proposal-files";
import type { QuotationPage, TemplatePage } from "./proposal-pdf";
import { quotationEntityId, quotationReference, quotingEntity } from "./quote-issue";

type Db = PoolClient;

/** The tax's own name in the quoting entity's country (its region pack), e.g. VAT or GST; "Tax" when unknown. */
export async function taxLabel(db: Db, workspaceId: string, caseId: string) {
  const entity = await quotingEntity(db, workspaceId, caseId);
  if (!entity) return "Tax";
  const label = (await db.query<{ label: string | null }>(
    `SELECT configuration->'tax'->>'label' AS label FROM tenant_setup_profiles WHERE kind = 'region' AND code = $1 ORDER BY version DESC LIMIT 1`, [entity.countryCode])).rows[0]?.label;
  return label || "Tax";
}

/** The disclosure a quote is shown with: the one recorded when it was sent, else the firm's current setting. */
export async function disclosureFor(db: Db, workspaceId: string, caseId: string, quoteId: string, current: MarkupDisclosure) {
  const issued = (await db.query<{ mode: string }>(`SELECT markup_disclosure AS mode FROM quote_issue_snapshots WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3`,
    [workspaceId, caseId, quoteId])).rows[0];
  return issued ? markupDisclosure(issued.mode) : current;
}

/** A quote as the client reads it, in its disclosure mode (the quote view, the portal and the PDF share this). */
export async function clientPresentation(db: Db, workspaceId: string, caseId: string, quoteId: string) {
  const snapshot = await quotePricingSnapshot(db, workspaceId, caseId, quoteId);
  const mode = await disclosureFor(db, workspaceId, caseId, quoteId, markupDisclosure(snapshot.settings.markupDisclosure));
  const presentation = presentForClient(snapshot.lines.map((line) => ({ ...line, credit: line.changeOp === "omit" })), snapshot.pricing, mode, snapshot.decimals);
  return { snapshot, presentation };
}

/** Page 4's content: the quote's own data, never the template's; with `store`, the issuing business's letterhead images too. */
export async function quotationPageData(db: Db, workspaceId: string, caseId: string, quoteId: string, store?: ObjectStore): Promise<QuotationPage & { quoteHash: string | null }> {
  const { snapshot, presentation } = await clientPresentation(db, workspaceId, caseId, quoteId);
  const { quote } = snapshot;
  const brand = await effectivePortalBrand(db, workspaceId);
  const reference = await quotationReference(db, workspaceId, caseId, quote.familyId ?? quote.id);
  const family = (await db.query<{ position: number }>(
    `SELECT count(*)::int AS position FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND kind = $3 AND coalesce(family_id, id) = $4 AND number <= $5`,
    [workspaceId, caseId, quote.kind, quote.familyId ?? quote.id, quote.number])).rows[0]?.position ?? 1;
  const client = (await db.query<{ name: string; project: string; address: string | null; zone: string }>(
    `SELECT coalesce(party.display_name, opportunity.title) AS name, opportunity.title AS project, workspace.default_timezone AS zone,
            (SELECT concat_ws(', ', NULLIF(address.line1, ''), NULLIF(address.locality, ''), NULLIF(address.region, '')) FROM crm_addresses address
              WHERE address.workspace_id = party.workspace_id AND address.party_id = party.id ORDER BY address.is_primary DESC, address.created_at LIMIT 1) AS address
       FROM pre_project_cases pre_case
       JOIN workspaces workspace ON workspace.id = pre_case.workspace_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0] ?? { name: "", project: "", address: null, zone: "UTC" };
  const issuedAt = typeof quote.detail.issuedAt === "string" ? new Date(quote.detail.issuedAt) : new Date();
  const issuedOn = new Intl.DateTimeFormat("en-CA", { timeZone: client.zone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(issuedAt);
  // Lines grouped by area, in the order they appear; lines without an area last, as "General".
  const groups = new Map<string, string[]>();
  for (const line of snapshot.lines) {
    const name = line.areaName || "General";
    groups.set(name, [...(groups.get(name) ?? []), line.id]);
  }
  const ordered = [...groups.entries()].sort(([left], [right]) => Number(left === "General") - Number(right === "General"));
  return {
    brand: { name: brand.name, accent: brand.primaryColor ?? null },
    letterhead: store ? await pdfLetterhead(db, store, workspaceId, await quotationEntityId(db, workspaceId, caseId, quote.familyId ?? quote.id)) : null,
    title: quote.title,
    reference: reference?.reference ?? `Q-${quote.number}`,
    revision: family,
    issuedOn,
    validUntil: quote.validUntil,
    client: { name: client.name, project: client.project, address: client.address },
    currency: quote.currency,
    decimals: snapshot.decimals,
    taxLabel: await taxLabel(db, workspaceId, caseId),
    presentation,
    groups: ordered.map(([name, lineIds]) => ({ name, lineIds })),
    paymentTerms: ((quote.detail.paymentTerms as Array<{ title: string; percent: number | string; trigger: string }> | undefined) ?? [])
      .map((term) => ({ title: String(term.title ?? ""), percent: term.percent, trigger: String(term.trigger ?? "") })),
    quoteHash: (await db.query<{ hash: string | null }>(`SELECT hash FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, quoteId])).rows[0]?.hash ?? null,
  };
}

/** The firm's current proposal template: its version and the pages it holds (bytes loaded by the caller). */
export async function currentTemplate(db: Db, workspaceId: string) {
  const version = (await db.query<{ version: number }>(`SELECT version FROM proposal_templates WHERE workspace_id = $1`, [workspaceId])).rows[0]?.version ?? 0;
  const pages = version ? (await db.query<{ slot: TemplatePage["slot"]; objectKey: string; fileName: string; mimeType: string; byteSize: number; sha256: string; pageCount: number; createdAt: string }>(
    `SELECT slot, object_key AS "objectKey", file_name AS "fileName", mime_type AS "mimeType", byte_size AS "byteSize", sha256, page_count AS "pageCount", created_at AS "createdAt"
       FROM proposal_template_pages WHERE workspace_id = $1 AND template_version = $2 ORDER BY slot`, [workspaceId, version])).rows : [];
  return { version, pages };
}

/**
 * What the portal adds to each sent quote: its quotation number and, when the firm discloses its markup or works on a
 * fee (R3), the quote as the client reads it in that mode (all-inclusive quotes read as they always did).
 */
export async function portalQuoteExtras(reader: Pick<Db, "query">, workspaceId: string, caseId: string, quotes: Array<{ id: string; familyId?: string | null }>) {
  // The portal reads with its tenant transaction's client; the pricing snapshot needs only its query method.
  const db = reader as Db;
  const extras = new Map<string, { reference: string | null; disclosure: Awaited<ReturnType<typeof clientPresentation>>["presentation"] | null }>();
  for (const quote of quotes) {
    const reference = (await quotationReference(db, workspaceId, caseId, quote.familyId ?? quote.id))?.reference ?? null;
    const issued = (await db.query<{ mode: string }>(`SELECT markup_disclosure AS mode FROM quote_issue_snapshots WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3`,
      [workspaceId, caseId, quote.id])).rows[0];
    const disclosure = issued && markupDisclosure(issued.mode) !== "all_inclusive"
      ? (await clientPresentation(db, workspaceId, caseId, quote.id).catch(() => null))?.presentation ?? null : null;
    extras.set(quote.id, { reference, disclosure });
  }
  return extras;
}
