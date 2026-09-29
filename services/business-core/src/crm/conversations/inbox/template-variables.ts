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
  /** An event's own record (the invoice issued, the payment due or received, the stage that started) wins over "latest". */
  record?: {
    invoiceId?: string | null; paymentId?: string | null; quoteId?: string | null; projectId?: string | null; stageName?: string | null;
    /** What is still owed (a reminder), exact decimal and currency; wins over the milestone's full amount. */
    amountDue?: { amount: string; currency: string } | null;
  };
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
        const row = context.record?.projectId ? (await db.query<{ name: string }>(`SELECT name FROM delivery_projects WHERE workspace_id=$1 AND id=$2`, [workspaceId, context.record.projectId])).rows[0]
          : partyId ? (await db.query<{ name: string }>(
          `SELECT project.name FROM delivery_projects project
            WHERE project.workspace_id=$1 AND project.case_id IN (${PARTY_CASES})
            ORDER BY (project.status='active') DESC, project.created_at DESC LIMIT 1`, [workspaceId, partyId])).rows[0] : undefined;
        values[source] = row?.name ?? null;
        break;
      }
      case "project.stage": values[source] = context.record?.stageName?.trim() || null; break;
      case "quote.number": {
        const row = context.record?.quoteId ? (await db.query<{ number: number }>(`SELECT number FROM commercial_quotes WHERE workspace_id=$1 AND id::text=$2`, [workspaceId, context.record.quoteId])).rows[0]
          : partyId ? (await db.query<{ number: number }>(
          `SELECT quote.number FROM commercial_quotes quote
            WHERE quote.workspace_id=$1 AND quote.case_id IN (${PARTY_CASES})
              AND quote.status IN ('issued','accepted','changes_requested')
            ORDER BY quote.updated_at DESC LIMIT 1`, [workspaceId, partyId])).rows[0] : undefined;
        values[source] = row ? `V${row.number}` : null;
        break;
      }
      case "payment.amount": {
        if (context.record?.amountDue) { values[source] = formatMoney(context.record.amountDue.amount, context.record.amountDue.currency, locale); break; }
        const row = context.record?.paymentId ? (await db.query<{ amount: string; currency: string }>(
          `SELECT amount::text AS amount, currency FROM commercial_payments WHERE workspace_id=$1 AND id=$2`, [workspaceId, context.record.paymentId])).rows[0] : undefined;
        values[source] = row ? formatMoney(row.amount, row.currency, locale) : null;
        break;
      }
      case "invoice.number":
      case "invoice.total":
      case "invoice.due_date": {
        const row = context.record?.invoiceId
          ? (await db.query<{ number: string; total: string; currency: string; dueDate: string | null }>(
            `SELECT number, total::text AS total, currency, due_date::text AS "dueDate" FROM client_invoices WHERE workspace_id=$1 AND id=$2`, [workspaceId, context.record.invoiceId])).rows[0]
          : context.record?.paymentId
            // A payment milestone that has no invoice yet: its own amount and due date.
            ? (await db.query<{ number: string | null; total: string; currency: string; dueDate: string | null }>(
              `SELECT (SELECT invoice.number FROM client_invoices invoice WHERE invoice.workspace_id=payment.workspace_id AND invoice.payment_id=payment.id AND invoice.status='issued' ORDER BY invoice.issued_at DESC LIMIT 1) AS number,
                      payment.amount::text AS total, payment.currency, payment.due_date::text AS "dueDate"
                 FROM commercial_payments payment WHERE payment.workspace_id=$1 AND payment.id=$2`, [workspaceId, context.record.paymentId])).rows[0]
            : partyId ? (await db.query<{ number: string; total: string; currency: string; dueDate: string | null }>(
              `SELECT invoice.number, invoice.total::text AS total, invoice.currency, invoice.due_date::text AS "dueDate" FROM client_invoices invoice
                WHERE invoice.workspace_id=$1 AND invoice.status='issued' AND invoice.case_id IN (${PARTY_CASES})
                ORDER BY invoice.issued_at DESC LIMIT 1`, [workspaceId, partyId])).rows[0] : undefined;
        values[source] = !row ? null
          : source === "invoice.number" ? row.number ?? null
          : source === "invoice.total" ? formatMoney(row.total, row.currency, locale)
          : row.dueDate ? formatDate(new Date(`${row.dueDate}T12:00:00Z`), locale, "UTC") : null;
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
