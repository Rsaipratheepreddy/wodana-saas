import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { tellClients } from "../client-portal/portal-notices";
import { readPortalSettings } from "../client-portal/portal-settings";
import { portalUrl } from "../client-portal/portal-site";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";

type Db = Pick<PoolClient, "query">;
const VIEW = "pre_projects.view", EDIT = "pre_projects.edit";

export type QuoteShare = {
  /** The client's portal, opened on their decisions; null while the portal is off. */
  portalUrl: string | null;
  /** The case's client contacts with a mobile number, deciders first: each becomes a WhatsApp link. */
  contacts: Array<{ id: string; name: string; phone: string; decides: boolean }>;
  /** The prefilled message for WhatsApp (editable there before it's sent). */
  message: string;
  canResend: boolean;
};

/** The digits wa.me takes: the international number without "+" or spaces. */
export function whatsappNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function shareMessage(input: { firstName: string; company: string; title: string; url: string | null; validUntil: string | null }) {
  return [
    `Hello ${input.firstName}, ${input.company} has sent you ${input.title}.`,
    input.validUntil ? `It is valid until ${input.validUntil}.` : "",
    input.url ? `Open it here to review and decide: ${input.url}` : "",
  ].filter(Boolean).join(" ");
}

/**
 * Sharing a sent quote (Q-9): its portal link to copy, a WhatsApp link per client contact with the message
 * already written (the phone's own WhatsApp, for clients who never read email), and "Send again", which re-runs
 * the quote_issued notice — the approved WhatsApp template through the inbox when the firm has one, email
 * otherwise — at most once an hour, audited.
 */
@Injectable()
export class QuoteShareService {
  constructor(private readonly access: WorkspaceAccessService, private readonly config: ConfigService) {}

  share(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      const quote = await this.quote(client, workspaceId, caseId, quoteId);
      const settings = await readPortalSettings(client, workspaceId);
      const url = settings.enabled ? await portalUrl(client, this.config, workspaceId, settings.slug, `?project=${caseId}&open=decisions`) : null;
      const contacts = (await client.query<{ id: string; name: string; phone: string | null; decides: boolean }>(
        `SELECT id, coalesce(confirmed_name, name) AS name, phone, role = 'approver' AS decides FROM client_portal_grants
          WHERE workspace_id = $1 AND case_id = $2 AND active AND NOT test_contact ORDER BY role = 'approver' DESC, created_at`, [workspaceId, caseId])).rows
        .flatMap((row) => { const phone = row.phone ? whatsappNumber(row.phone) : null; return phone ? [{ id: row.id, name: row.name, phone, decides: row.decides }] : []; });
      const workspace = (await client.query<{ name: string; locale: string | null }>(
        `SELECT coalesce(branding.display_name, workspace.name) AS name, workspace.default_locale AS locale
           FROM workspaces workspace LEFT JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id WHERE workspace.id = $1`,
        [workspaceId])).rows[0];
      const company = workspace?.name ?? "";
      let validUntil = quote.validUntil;
      if (validUntil) try { validUntil = new Intl.DateTimeFormat(workspace?.locale ?? "en", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${validUntil}T00:00:00Z`)); } catch { /* keep the ISO date */ }
      const firstName = (contacts[0]?.name ?? quote.clientName ?? "").split(/\s+/)[0] ?? "";
      const result: QuoteShare = {
        portalUrl: url, contacts,
        message: shareMessage({ firstName, company, title: `${quote.title} (Q-${quote.number})`, url, validUntil }),
        canResend: await this.access.hasPermission(client, workspaceId, user.userId, EDIT),
      };
      return result;
    });
  }

  resend(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string) {
    return this.access.withPermission(actor, workspaceId, EDIT, async (client, user) => {
      const quote = await this.quote(client, workspaceId, caseId, quoteId);
      const hour = new Date().toISOString().slice(0, 13);
      const told = await tellClients(client, { workspaceId, caseId, event: "quote_issued", recordId: `${quote.id}:${quote.hash ?? ""}:resent:${hour}`,
        title: `${quote.title} (V${quote.number})`, due: quote.validUntil });
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "commercial.quote_resent.v1", entityType: "pre_project_case", entityId: caseId,
        after: { quoteId: quote.id, channel: "channel" in told ? told.channel ?? null : null, reason: told.reason } });
      return { channel: "channel" in told ? told.channel ?? null : null, emailed: "names" in told ? told.names ?? [] : [], reason: told.reason };
    });
  }

  private async quote(db: Db, workspaceId: string, caseId: string, quoteId: string) {
    const row = (await db.query<{ id: string; number: number; title: string; status: string; hash: string | null; validUntil: string | null; clientName: string | null }>(
      `SELECT quote.id, quote.number, quote.title, quote.status, quote.hash, quote.valid_until::text AS "validUntil", party.display_name AS "clientName"
         FROM commercial_quotes quote
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = quote.workspace_id AND pre_case.id = quote.case_id
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
        WHERE quote.workspace_id = $1 AND quote.case_id = $2 AND quote.id = $3`, [workspaceId, caseId, quoteId])).rows[0];
    if (!row) throw new NotFoundException("Quotation not found.");
    if (row.status !== "issued") throw new ConflictException("Only a quote waiting for the client's decision can be shared.");
    return row;
  }
}
