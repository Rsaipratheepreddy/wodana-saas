import { addDays } from "../../booking/booking.domain";
import { deliverClientDefault } from "../delivery/client-router";
import type { Db, DueItem, ReminderSource } from "../engine/engine";
import { dayStart, encode, readCases, UUID } from "./support";

const ISSUED_AT = `coalesce(CASE WHEN quote.detail->>'issuedAt' ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN (quote.detail->>'issuedAt')::timestamptz END, quote.updated_at)`;
const quoteLink = (caseId: string, quoteId: string) => `/workspace/pre-projects/cases/${encode(caseId)}/quotations?quote=${encode(quoteId)}`;

/** A quote's id is scoped to its case (the case's document): the key names both, `quote:<case>:<quote>`. */
const quoteKey = (caseId: string, quoteId: string) => `quote:${caseId}:${quoteId}`;
function quotePairs(keys: readonly string[]) {
  const pairs: Array<{ key: string; caseId: string; quoteId: string }> = [];
  for (const key of keys) {
    const [prefix, caseId, ...rest] = key.split(":");
    const quoteId = rest.join(":");
    if (prefix === "quote" && UUID.test(caseId ?? "") && quoteId) pairs.push({ key, caseId, quoteId });
  }
  return pairs;
}

/** Of these quote keys, the ones whose quote matches `where` (with its case joined as pre_case). */
async function openQuotes(db: Db, workspaceId: string, keys: readonly string[], where: string, params: unknown[]) {
  const pairs = quotePairs(keys);
  if (!pairs.length) return new Set<string>();
  const found = (await db.query<{ caseId: string; id: string }>(
    `SELECT quote.case_id AS "caseId", quote.id FROM commercial_quotes quote
       JOIN unnest($2::uuid[], $3::text[]) AS wanted(case_id, id) ON wanted.case_id = quote.case_id AND wanted.id = quote.id
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = quote.workspace_id AND pre_case.id = quote.case_id
      WHERE quote.workspace_id = $1 AND ${where}`,
    [workspaceId, pairs.map((pair) => pair.caseId), pairs.map((pair) => pair.quoteId), ...params])).rows;
  return new Set(found.map((row) => quoteKey(row.caseId, row.id)));
}

/**
 * client.quote_decision (replaces the quote part of client decision reminders, the quotation follow-up in client
 * follow-ups and the client part of the expiry warning): an issued quote the client hasn't decided on. The client's
 * decision-makers hear 2 and 5 days after it reached them (the firm's decision days and quote follow-up day, copied
 * into its rule) on WhatsApp ("Quotation follow-up", with its approved template) or by branded email, at most one
 * client reminder a day; after two the case owner gets a copy. Done when the quote is no longer issued (accepted,
 * changes asked, declined, expired), its validity passed, or the case stopped.
 */
export const quoteDecisionSource: ReminderSource = {
  kind: "client.quote_decision", module: "quotations", audience: "client", critical: false, notify: "engine",
  viewPermission: "pre_projects.view", template: { code: "reminders.client.quote_decision" },
  async open(db, workspaceId, { clock, now, limit }) {
    const rows = (await db.query<{ id: string; caseId: string; title: string; number: number; validUntil: string | null; issuedAt: Date }>(
      `SELECT quote.id, quote.case_id AS "caseId", quote.title, quote.number, quote.valid_until::text AS "validUntil", ${ISSUED_AT} AS "issuedAt"
         FROM commercial_quotes quote
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = quote.workspace_id AND pre_case.id = quote.case_id AND pre_case.status = 'active'
        WHERE quote.workspace_id = $1 AND quote.status = 'issued' AND (quote.valid_until IS NULL OR quote.valid_until >= $2::date)
          AND ${ISSUED_AT} >= $3::timestamptz - interval '90 days'
        ORDER BY ${ISSUED_AT} DESC, quote.id LIMIT $4`, [workspaceId, clock.today, now, limit])).rows;
    const cases = await readCases(db, workspaceId, rows.map((row) => row.caseId));
    return rows.flatMap((row): DueItem[] => {
      const facts = cases.get(row.caseId);
      if (!facts) return [];
      const owner = facts.ownerMembershipId ?? facts.accountMembershipId;
      return [{
        key: quoteKey(row.caseId, row.id), sourceType: "commercial_quote", sourceId: row.id, jobSource: { type: "quote", id: row.id, caseId: row.caseId },
        projectId: facts.projectId, caseId: row.caseId, partyId: facts.partyId, ownerMembershipId: owner,
        ccMembershipIds: facts.accountMembershipId && facts.accountMembershipId !== owner ? [facts.accountMembershipId] : [],
        dueAt: new Date(row.issuedAt), title: row.title || `Quote ${row.number}`, context: facts.client, href: quoteLink(row.caseId, row.id),
        variables: { client: facts.client, clientContext: facts.title, validUntil: row.validUntil ?? "" },
      }];
    });
  },
  stillOpen(db, workspaceId, keys, at) {
    return openQuotes(db, workspaceId, keys, `pre_case.status = 'active' AND quote.status = 'issued' AND (quote.valid_until IS NULL OR quote.valid_until >= coalesce($4::date, CURRENT_DATE))`,
      [at?.today ?? null]);
  },
  deliverClient(db, workspaceId, delivery) {
    // The client reads their project's name where the team reads the client's.
    return deliverClientDefault(db, workspaceId, { ...delivery, variables: { ...delivery.variables, context: delivery.variables.clientContext ?? "" } },
      { whatsappEvent: "commercial.quote_follow_up", section: "decisions", approversOnly: true, record: { quoteId: delivery.subject.sourceId } });
  },
};

/**
 * quote.expiring (replaces the warning part of the daily quote expiry): an issued quote's validity ends soon. The case
 * owner and the account manager hear 3 days before (the firm's expiry warning days, copied into its rule) and on the
 * day. Expiring the quote the day after stays in processQuoteExpiry. Done when it is no longer issued; an extended
 * validity moves the due date (a new revision).
 */
export const quoteExpiringSource: ReminderSource = {
  kind: "quote.expiring", module: "quotations", audience: "staff", critical: false, notify: "engine",
  viewPermission: "pre_projects.view", template: { code: "reminders.quote.expiring" },
  async open(db, workspaceId, { clock, limit }) {
    const rows = (await db.query<{ id: string; caseId: string; title: string; number: number; validUntil: string }>(
      `SELECT quote.id, quote.case_id AS "caseId", quote.title, quote.number, quote.valid_until::text AS "validUntil"
         FROM commercial_quotes quote
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = quote.workspace_id AND pre_case.id = quote.case_id AND pre_case.status IN ('active', 'released')
        WHERE quote.workspace_id = $1 AND quote.status = 'issued' AND quote.valid_until BETWEEN $2::date AND $3::date
        ORDER BY quote.valid_until, quote.number LIMIT $4`, [workspaceId, clock.today, addDays(clock.today, 30), limit])).rows;
    const cases = await readCases(db, workspaceId, rows.map((row) => row.caseId));
    return rows.flatMap((row): DueItem[] => {
      const facts = cases.get(row.caseId);
      if (!facts) return [];
      const owner = facts.ownerMembershipId ?? facts.accountMembershipId;
      return [{
        key: quoteKey(row.caseId, row.id), sourceType: "commercial_quote", sourceId: row.id, jobSource: { type: "quote", id: row.id, caseId: row.caseId },
        projectId: facts.projectId, caseId: row.caseId, partyId: facts.partyId, ownerMembershipId: owner,
        ccMembershipIds: facts.accountMembershipId && facts.accountMembershipId !== owner ? [facts.accountMembershipId] : [],
        dueAt: dayStart(row.validUntil, clock), title: `Q-${row.number} · ${row.title}`, context: facts.client, href: quoteLink(row.caseId, row.id),
        variables: { client: facts.client },
      }];
    });
  },
  stillOpen(db, workspaceId, keys, at) {
    return openQuotes(db, workspaceId, keys, `pre_case.status IN ('active', 'released') AND quote.status = 'issued' AND quote.valid_until IS NOT NULL
      AND ($4::date IS NULL OR quote.valid_until BETWEEN $4::date AND $4::date + 30)`, [at?.today ?? null]);
  },
};
