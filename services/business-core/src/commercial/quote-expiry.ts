import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { tellClients } from "../client-portal/portal-notices";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { freezeHash } from "./commercial.domain";
import { commercialRepository } from "./commercial-repository";
import type { CommercialData, Quote } from "./commercial.types";
import { qsEstimateCurrent, qsEstimateHash } from "./qs-estimate";

type Db = Pick<PoolClient, "query">;

/** Days before a quote's validity ends when Sales and the client hear it, unless the firm set its own. */
export const DEFAULT_EXPIRY_WARNING_DAYS = 3;
const DAY = 86_400_000;

const plusDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/**
 * Extend a sent (or expired) quote's validity without a new review round (Q-7): the content stays exactly as
 * the client has it, only the date moves, the quote is awaiting the client again and its snapshot (and a QS
 * estimate that was current) is re-sealed with the new date. Returns the dates for the audit.
 */
export function extendQuoteValidity(q: Quote, validUntil: string, today: string) {
  if (!["issued", "expired"].includes(q.status)) throw new ConflictException("Only a sent or expired quote's validity can be extended.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || Number.isNaN(Date.parse(`${validUntil}T00:00:00Z`))) throw new ConflictException("Choose a valid date.");
  if (validUntil <= today) throw new ConflictException("Choose a date after today.");
  if (validUntil > plusDays(today, 365)) throw new ConflictException("A quote can be valid for up to a year.");
  const from = q.validUntil;
  const estimateWasCurrent = Boolean(q.qsEstimate) && qsEstimateCurrent(q);
  q.validUntil = validUntil;
  q.status = "issued";
  if (q.hash) q.hash = freezeHash(q);
  if (estimateWasCurrent && q.qsEstimate) q.qsEstimate.quoteHash = qsEstimateHash(q);
  return { from, to: validUntil };
}

type Due = { caseId: string; id: string; number: number; title: string; validUntil: string; clientName: string; userIds: string[] };

async function dueQuotes(db: Db, workspaceId: string, where: string, params: unknown[]): Promise<Due[]> {
  return (await db.query<Due & { ownerUserId: string | null; accountUserId: string | null }>(
    `SELECT quote.case_id AS "caseId", quote.id, quote.number, quote.title, quote.valid_until::text AS "validUntil",
            coalesce(party.display_name, opportunity.title) AS "clientName", owner.user_id AS "ownerUserId", account.user_id AS "accountUserId"
       FROM commercial_quotes quote
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = quote.workspace_id AND pre_case.id = quote.case_id AND pre_case.status IN ('active', 'released')
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN workspace_memberships owner ON owner.workspace_id = pre_case.workspace_id AND owner.id = pre_case.owner_membership_id AND owner.status = 'active'
       LEFT JOIN workspace_memberships account ON account.workspace_id = opportunity.workspace_id AND account.id = opportunity.owner_membership_id AND account.status = 'active'
      WHERE quote.workspace_id = $1 AND quote.status = 'issued' AND quote.valid_until IS NOT NULL AND ${where}
      ORDER BY quote.valid_until, quote.number LIMIT 200`, [workspaceId, ...params])).rows
    .map(({ ownerUserId, accountUserId, ...row }) => ({ ...row, userIds: [...new Set([ownerUserId, accountUserId].filter((id): id is string => Boolean(id)))] }));
}

/**
 * Quotes that run out (Q-6), in the daily run. Before the end (3 days by default, Settings → Quotations) the
 * case owner and account manager are told in the app and the client's decision-makers are reminded when it
 * ends. The day after it ends the quote is Expired: the case is saved through the repository, the change is
 * audited, and Sales hears it by app and email with "Extend validity" one tap away. Once per quote and date.
 */
export async function processQuoteExpiry(db: Db, workspaceId: string) {
  const settings = (await db.query<{ today: string; warningDays: number | null; locale: string | null }>(
    `SELECT (now() AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date::text AS today, settings.expiry_warning_days AS "warningDays",
            workspace.default_locale AS locale
       FROM workspaces workspace LEFT JOIN workspace_quotation_settings settings ON settings.workspace_id = workspace.id WHERE workspace.id = $1`, [workspaceId])).rows[0];
  if (!settings) return { warned: 0, expired: 0 };
  const warningDays = settings.warningDays ?? DEFAULT_EXPIRY_WARNING_DAYS;
  let warned = 0, expired = 0;
  const day = (value: string) => { try { return new Intl.DateTimeFormat(settings.locale ?? "en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); } catch { return value; } };
  const deepLink = (quote: Due) => `/workspace/pre-projects/cases/${quote.caseId}/quotations?quote=${encodeURIComponent(quote.id)}`;

  if (warningDays > 0) {
    for (const quote of await dueQuotes(db, workspaceId, `quote.valid_until >= $2::date AND quote.valid_until <= $3::date`, [settings.today, plusDays(settings.today, warningDays)])) {
      const title = `Q-${quote.number} · ${quote.title}`;
      await tellClients(db, { workspaceId, caseId: quote.caseId, event: "decision_waiting", recordId: `quote:${quote.id}:expiring:${quote.validUntil}`, title: quote.title, due: quote.validUntil });
      for (const userId of quote.userIds) {
        const result = await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "quotation.expiring", eventType: "quotation.expiring",
          variables: { title, clientName: quote.clientName, due: day(quote.validUntil) }, deepLink: deepLink(quote),
          idempotencyKey: `quotation.expiring:${quote.id}:${quote.validUntil}:${userId}`.slice(0, 160) });
        if (result.queued) warned += 1;
      }
    }
  }

  for (const quote of await dueQuotes(db, workspaceId, `quote.valid_until < $2::date`, [settings.today])) {
    const stored = await commercialRepository.load(db, workspaceId, quote.caseId, { forUpdate: true });
    if (!stored) continue;
    const data = stored.content as CommercialData;
    const target = data.quotes?.find((item) => item.id === quote.id);
    // Someone decided, revised or extended it since the list was read.
    if (!target || target.status !== "issued" || !target.validUntil || target.validUntil >= settings.today) continue;
    target.status = "expired";
    data.revision += 1;
    data.audit = [...(data.audit ?? []), { id: randomUUID(), at: new Date().toISOString(), actor: "Wodana", action: "expire", quoteId: target.id, note: `Valid until ${target.validUntil}` }];
    await commercialRepository.save(db, workspaceId, quote.caseId, data);
    await recordAudit(db, { workspaceId, actorUserId: null, source: "internal", action: "commercial.quote_expired.v1", entityType: "pre_project_case", entityId: quote.caseId,
      before: { quoteId: target.id, status: "issued", validUntil: target.validUntil }, after: { quoteId: target.id, status: "expired" } });
    expired += 1;
    const title = `Q-${quote.number} · ${quote.title}`;
    for (const userId of quote.userIds) {
      const message = { workspaceId, recipientUserId: userId, code: "quotation.expired", eventType: "quotation.expired",
        variables: { title, clientName: quote.clientName, due: day(quote.validUntil) }, deepLink: deepLink(quote) };
      await notifyUserInApp(db, { ...message, idempotencyKey: `quotation.expired:${quote.id}:${quote.validUntil}:${userId}`.slice(0, 160) });
      await queueUserEmail(db, { ...message, idempotencyKey: `quotation.expired:${quote.id}:${quote.validUntil}:${userId}:email`.slice(0, 160) });
    }
  }
  return { warned, expired };
}
