import { leadDesigner } from "../../design/design-journey.store";
import { idleSince } from "../../value-engineering/value-engineering.domain";
import { KEPT_PRICE_SQL, NEW_VERSION_SQL } from "../../value-engineering/value-engineering.store";
import type { DueItem, ReminderSource } from "../engine/engine";
import { activeMemberships, encode, idsOf, keysOf, readCases } from "./support";

/** An open round on a job that is still being planned, whose client hasn't decided (the round's done-check, value-engineering.store). */
const OPEN = `round.status = 'open' AND NOT ${KEPT_PRICE_SQL} AND ${NEW_VERSION_SQL} IS NULL
  AND EXISTS (SELECT 1 FROM pre_project_cases pre_case WHERE pre_case.workspace_id = round.workspace_id AND pre_case.id = round.case_id AND pre_case.status IN ('draft', 'active'))`;

/**
 * quote.value_engineering_idle (PLM-147): a value engineering round that hasn't moved since it started, the savings
 * were agreed or its meeting ended. Its lead (the job's lead designer, else the Account Manager who leads it) hears
 * after the firm's working days (by default 3 and 7), then their team lead and the owner. Done when the client decides
 * (a new version sent, or the price kept) or the round is withdrawn; each move starts the count again.
 */
export const valueEngineeringIdleSource: ReminderSource = {
  kind: "quote.value_engineering_idle", module: "quotations", audience: "staff", critical: false, notify: "engine",
  viewPermission: "pre_projects.view", template: { code: "reminders.quote.value_engineering_idle" },
  async open(db, workspaceId, { limit }) {
    const rows = (await db.query<{ id: string; caseId: string; quoteId: string; round: number; lead: string | null; lastMovedAt: Date; meetingEndsAt: Date | null }>(
      `SELECT round.id, round.case_id AS "caseId", round.quote_id AS "quoteId", round.round, round.lead_membership_id AS lead, round.last_moved_at AS "lastMovedAt",
              (SELECT appointment.ends_at FROM crm_appointments appointment WHERE appointment.workspace_id = round.workspace_id AND appointment.activity_id = round.meeting_activity_id) AS "meetingEndsAt"
         FROM quote_value_engineering round
        WHERE round.workspace_id = $1 AND ${OPEN}
        ORDER BY round.last_moved_at, round.id LIMIT $2`, [workspaceId, limit])).rows;
    const cases = await readCases(db, workspaceId, rows.map((row) => row.caseId));
    const leads = new Map<string, string | null>();
    for (const row of rows) leads.set(row.id, (await leadDesigner(db, workspaceId, row.caseId)) ?? row.lead);
    const active = await activeMemberships(db, workspaceId, [...leads.values()]);
    const items: DueItem[] = [];
    for (const row of rows) {
      const facts = cases.get(row.caseId);
      if (!facts) continue;
      const lead = leads.get(row.id) ?? null;
      items.push({
        key: `ve:${row.id}`, sourceType: "value_engineering", sourceId: row.id, jobSource: { type: "case", id: row.caseId }, projectId: facts.projectId, caseId: row.caseId,
        partyId: facts.partyId, ownerMembershipId: lead && active.has(lead) ? lead : facts.accountMembershipId, ccMembershipIds: [],
        dueAt: idleSince(new Date(row.lastMovedAt), row.meetingEndsAt ? new Date(row.meetingEndsAt) : null),
        title: `Value engineering · round ${row.round}`, context: facts.client,
        href: `/workspace/pre-projects/cases/${encode(row.caseId)}/quotations?quote=${encode(row.quoteId)}`, variables: { client: facts.client },
      });
    }
    return items;
  },
  async stillOpen(db, workspaceId, keys) {
    const ids = idsOf(keys, "ve");
    if (!ids.length) return new Set();
    return keysOf("ve", (await db.query<{ id: string }>(
      `SELECT round.id FROM quote_value_engineering round WHERE round.workspace_id = $1 AND round.id = ANY($2::uuid[]) AND ${OPEN}`, [workspaceId, ids])).rows.map((row) => row.id));
  },
};
