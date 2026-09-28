import type { PoolClient } from "pg";
import { readPortalSettings } from "../../../client-portal/portal-settings";
import { portalUrl } from "../../../client-portal/portal-site";
import { firstName, type TemplateVariableSource } from "./inbox-rules";

type Db = Pick<PoolClient, "query">;
type Config = { get(key: string): unknown };

export type TemplateContext = {
  workspaceId: string;
  partyId: string | null;
  /** The enquiry the chat is linked to; otherwise the client's latest open enquiry is used. */
  leadId: string | null;
  /** Who is sending (for "staff first name"); null for automations. */
  staffUserId: string | null;
  config?: Config;
  now?: Date;
};

/** The client's records behind a chat, read once for every source a template needs. */
const PARTY_CASES = `SELECT pc.id FROM pre_project_cases pc JOIN crm_opportunities opportunity
  ON opportunity.workspace_id=pc.workspace_id AND opportunity.id=pc.opportunity_id
  WHERE pc.workspace_id=$1 AND opportunity.party_id=$2`;

/**
 * Values for each requested source, or null when the record does not have one (the send is then
 * blocked with the field named). Money and dates follow the workspace's region, never constants.
 */
export async function resolveTemplateSources(db: Db, context: TemplateContext, sources: Iterable<TemplateVariableSource>) {
  const wanted = new Set(sources);
  const values: Partial<Record<TemplateVariableSource, string | null>> = {};
  const { workspaceId, partyId } = context;
  const region = (await db.query<{ name: string; locale: string; timeZone: string }>(
    `SELECT coalesce(nullif(btrim(branding.display_name), ''), workspace.name) AS name, workspace.default_locale AS locale,
            workspace.default_timezone AS "timeZone"
       FROM workspaces workspace LEFT JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id
      WHERE workspace.id = $1`, [workspaceId])).rows[0];
  const locale = region?.locale || "en";
  const timeZone = region?.timeZone || "UTC";
  const party = partyId && (wanted.has("contact.first_name") || wanted.has("contact.name"))
    ? (await db.query<{ name: string }>(`SELECT display_name AS name FROM crm_parties WHERE workspace_id=$1 AND id=$2`, [workspaceId, partyId])).rows[0]
    : undefined;
  for (const source of wanted) {
    switch (source) {
      case "contact.first_name": values[source] = firstName(party?.name); break;
      case "contact.name": values[source] = firstName(party?.name) ? party!.name.trim() : null; break;
      case "business.name": values[source] = region?.name ?? null; break;
      case "today.date": values[source] = formatDate(context.now ?? new Date(), locale, timeZone); break;
      case "staff.first_name": {
        const staff = context.staffUserId ? (await db.query<{ name: string | null }>(`SELECT display_name AS name FROM users WHERE id=$1`, [context.staffUserId])).rows[0] : undefined;
        values[source] = firstName(staff?.name);
        break;
      }
      case "enquiry.reference": {
        const row = partyId || context.leadId ? (await db.query<{ reference: string | null }>(
          `SELECT enquiry.reference FROM crm_leads lead
             JOIN crm_enquiries enquiry ON enquiry.workspace_id=lead.workspace_id AND enquiry.id=lead.enquiry_id
            WHERE lead.workspace_id=$1 AND (lead.id=$2::uuid OR lead.party_id=$3::uuid)
            ORDER BY (lead.id IS NOT DISTINCT FROM $2::uuid) DESC,
                     (lead.status NOT IN ('qualified','disqualified','duplicate')) DESC, lead.created_at DESC
            LIMIT 1`, [workspaceId, context.leadId, partyId])).rows[0] : undefined;
        values[source] = row?.reference ?? null;
        break;
      }
      case "opportunity.reference": {
        const row = partyId ? (await db.query<{ reference: string }>(
          `SELECT reference FROM crm_opportunities WHERE workspace_id=$1 AND party_id=$2
            ORDER BY (status='open') DESC, updated_at DESC LIMIT 1`, [workspaceId, partyId])).rows[0] : undefined;
        values[source] = row?.reference ?? null;
        break;
      }
      case "project.name": {
        const row = partyId ? (await db.query<{ name: string }>(
          `SELECT project.name FROM delivery_projects project
            WHERE project.workspace_id=$1 AND project.case_id IN (${PARTY_CASES})
            ORDER BY (project.status='active') DESC, project.created_at DESC LIMIT 1`, [workspaceId, partyId])).rows[0] : undefined;
        values[source] = row?.name ?? null;
        break;
      }
      case "quote.number": {
        const row = partyId ? (await db.query<{ number: number }>(
          `SELECT quote.number FROM commercial_quotes quote
            WHERE quote.workspace_id=$1 AND quote.case_id IN (${PARTY_CASES})
              AND quote.status IN ('issued','accepted','changes_requested')
            ORDER BY quote.updated_at DESC LIMIT 1`, [workspaceId, partyId])).rows[0] : undefined;
        values[source] = row ? `V${row.number}` : null;
        break;
      }
      case "invoice.number":
      case "invoice.total": {
        const row = partyId ? (await db.query<{ number: string; total: string; currency: string }>(
          `SELECT invoice.number, invoice.total::text AS total, invoice.currency FROM client_invoices invoice
            WHERE invoice.workspace_id=$1 AND invoice.status='issued' AND invoice.case_id IN (${PARTY_CASES})
            ORDER BY invoice.issued_at DESC LIMIT 1`, [workspaceId, partyId])).rows[0] : undefined;
        values[source] = !row ? null : source === "invoice.number" ? row.number : formatMoney(row.total, row.currency, locale);
        break;
      }
      case "portal.link": {
        const settings = await readPortalSettings(db, workspaceId);
        values[source] = settings.enabled && context.config ? await portalUrl(db, context.config, workspaceId, settings.slug) : null;
        break;
      }
    }
  }
  return values;
}

function formatDate(value: Date, locale: string, timeZone: string) {
  try { return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(value); }
  catch { return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(value); }
}

/** The decimal string is formatted exactly (no float arithmetic); the currency is the invoice's own. */
function formatMoney(amount: string, currency: string, locale: string) {
  const exact = amount as unknown as number;
  try { return new Intl.NumberFormat(locale, { style: "currency", currency }).format(exact); }
  catch { return `${currency} ${amount}`; }
}
