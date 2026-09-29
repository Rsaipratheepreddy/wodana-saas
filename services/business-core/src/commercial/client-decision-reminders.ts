import type { PoolClient } from "pg";
import { tellClients } from "../client-portal/portal-notices";
import { notifyUserInApp } from "../notifications/default-templates";

type Db = Pick<PoolClient, "query">;

/** Days after a quote or design reaches the client when they (and the case owner) are reminded, unless the firm set its own. */
export const DEFAULT_DECISION_REMINDER_DAYS = [2, 5];

/** The firm's reminder days (Settings → Quotations), sorted, each 1–60, at most five. */
export function reminderDays(value: unknown): number[] {
  const days = Array.isArray(value) ? value.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 60) : DEFAULT_DECISION_REMINDER_DAYS;
  return [...new Set(days)].sort((a, b) => a - b).slice(0, 5);
}

/** Which reminder is due after `waited` days: 1 for the first threshold passed, 2 for the second…, 0 for none yet. */
export function reminderRound(waited: number, days: number[]) {
  return days.filter((day) => waited >= day).length;
}

type Waiting = { kind: "quote" | "design"; id: string; caseId: string; title: string; clientName: string; waited: number; due: string | null; userIds: string[] };

/**
 * Every decision waiting on the client, not only the ad-hoc requests: an issued quote or variation, and a design
 * shared for the client's review. On each configured day after it reached them (2 and 5 by default) the client's
 * decision-makers get the "decision waiting" message (WhatsApp once approved, email otherwise, never while the
 * portal is off), and the case owner (and the design's author) hear in the app how long it has waited. Each round
 * goes once per record, so a rerun or a missed day never repeats it.
 */
export async function processClientDecisions(db: Db, workspaceId: string) {
  const settings = (await db.query<{ days: number[] | null; today: string }>(
    `SELECT settings.decision_reminder_days AS days, (now() AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date::text AS today
       FROM workspaces workspace LEFT JOIN workspace_quotation_settings settings ON settings.workspace_id = workspace.id
      WHERE workspace.id = $1`, [workspaceId])).rows[0];
  if (!settings) return { sent: 0, clients: 0 };
  const days = reminderDays(settings.days ?? DEFAULT_DECISION_REMINDER_DAYS);
  if (!days.length) return { sent: 0, clients: 0 };
  const waiting: Waiting[] = [];
  const quotes = (await db.query<{ id: string; caseId: string; title: string; number: number; clientName: string; waited: number; validUntil: string | null; ownerUserId: string | null }>(
    `SELECT quote.id, quote.case_id AS "caseId", quote.title, quote.number, coalesce(party.display_name, '') AS "clientName", quote.valid_until::text AS "validUntil",
            ($2::date - (coalesce(CASE WHEN quote.detail->>'issuedAt' ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN (quote.detail->>'issuedAt')::timestamptz END, quote.updated_at)
               AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date) AS waited,
            owner.user_id AS "ownerUserId"
       FROM commercial_quotes quote
       JOIN workspaces workspace ON workspace.id = quote.workspace_id
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = quote.workspace_id AND pre_case.id = quote.case_id AND pre_case.status = 'active'
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN workspace_memberships owner ON owner.workspace_id = pre_case.workspace_id AND owner.id = pre_case.owner_membership_id AND owner.status = 'active'
      WHERE quote.workspace_id = $1 AND quote.status = 'issued' AND (quote.valid_until IS NULL OR quote.valid_until >= $2::date)
      ORDER BY quote.updated_at LIMIT 200`, [workspaceId, settings.today])).rows;
  for (const quote of quotes) waiting.push({ kind: "quote", id: quote.id, caseId: quote.caseId, title: quote.title || `Quote ${quote.number}`, clientName: quote.clientName,
    waited: Number(quote.waited), due: quote.validUntil, userIds: quote.ownerUserId ? [quote.ownerUserId] : [] });
  const designs = (await db.query<{ id: string; caseId: string; title: string; number: number; clientName: string; waited: number; ownerUserId: string | null; authorUserId: string | null }>(
    `SELECT version.id, design.case_id AS "caseId", design.title, version.number, coalesce(party.display_name, '') AS "clientName",
            ($2::date - (shared.at AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date) AS waited,
            owner.user_id AS "ownerUserId", version.created_by AS "authorUserId"
       FROM pre_project_design_versions version
       JOIN pre_project_designs design ON design.workspace_id = version.workspace_id AND design.id = version.design_id AND design.archived_at IS NULL
       JOIN workspaces workspace ON workspace.id = version.workspace_id
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = design.workspace_id AND pre_case.id = design.case_id AND pre_case.status = 'active'
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN workspace_memberships owner ON owner.workspace_id = pre_case.workspace_id AND owner.id = pre_case.owner_membership_id AND owner.status = 'active'
       CROSS JOIN LATERAL (SELECT max(activity.created_at) AS at FROM pre_project_design_activity activity
                            WHERE activity.workspace_id = version.workspace_id AND activity.version_id = version.id AND activity.action = 'client_review') shared
      WHERE version.workspace_id = $1 AND version.status = 'client_review' AND shared.at IS NOT NULL
        AND (version.client_review_expires_at IS NULL OR version.client_review_expires_at > now())
        AND version.number = (SELECT max(latest.number) FROM pre_project_design_versions latest WHERE latest.workspace_id = version.workspace_id AND latest.design_id = version.design_id)
      ORDER BY shared.at LIMIT 200`, [workspaceId, settings.today])).rows;
  for (const design of designs) waiting.push({ kind: "design", id: design.id, caseId: design.caseId, title: `${design.title} R${design.number}`, clientName: design.clientName,
    waited: Number(design.waited), due: null, userIds: [design.ownerUserId, design.authorUserId].filter((id): id is string => Boolean(id)) });

  let sent = 0, clients = 0;
  for (const item of waiting) {
    const round = reminderRound(item.waited, days);
    if (!round) continue;
    const client = await tellClients(db, { workspaceId, caseId: item.caseId, event: "decision_waiting", recordId: `${item.kind}:${item.id}:reminder:${round}`, title: item.title, due: item.due });
    if (client.queued) clients += 1;
    const note = `With ${item.clientName || "the client"} for ${item.waited} day${item.waited === 1 ? "" : "s"}.`;
    const deepLink = item.kind === "quote"
      ? `/workspace/pre-projects/cases/${item.caseId}/quotations?quote=${encodeURIComponent(item.id)}`
      : `/workspace/pre-projects/cases/${item.caseId}/designs`;
    for (const userId of new Set(item.userIds)) {
      const result = await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "commercial.decision_waiting", eventType: "commercial.decision_waiting",
        variables: { title: item.title, clientName: item.clientName, note }, deepLink,
        idempotencyKey: `commercial.decision_waiting:${item.kind}:${item.id}:${round}:${userId}`.slice(0, 160) });
      if (result.queued) sent += 1;
    }
  }
  return { sent, clients };
}
