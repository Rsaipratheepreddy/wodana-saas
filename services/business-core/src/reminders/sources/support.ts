import { Dec } from "../../catalog-core/decimal";
import { currencyDecimals } from "../../common/currency";
import { startOfWorkingDay, type Clock } from "../../team-calendars/workspace-clock";
import type { Db } from "../engine/engine";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encode = encodeURIComponent;
export { encode };

/** A date-only due date as the moment its working day starts, in the workspace's zone. */
export const dayStart = (date: string, clock: Pick<Clock, "start" | "timeZone">) => startOfWorkingDay(date.slice(0, 10), clock);

/** The ids in source keys of the form `<prefix>:<uuid>` (anything else is ignored). */
export function idsOf(keys: readonly string[], prefix: string): string[] {
  return [...new Set(keys.filter((key) => key.startsWith(`${prefix}:`)).map((key) => key.slice(prefix.length + 1)).filter((id) => UUID.test(id)))];
}

/** Keys back from the ids still open. */
export const keysOf = (prefix: string, ids: Iterable<string>) => new Set([...ids].map((id) => `${prefix}:${id}`));

/** Each project's named managers (active), by project. */
export async function managersByProject(db: Db, workspaceId: string, projectIds: readonly string[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(projectIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = (await db.query<{ projectId: string; membershipId: string }>(
    `SELECT DISTINCT assignment.project_id AS "projectId", assignment.membership_id AS "membershipId" FROM project_assignments assignment
       JOIN workspace_memberships member ON member.workspace_id = assignment.workspace_id AND member.id = assignment.membership_id AND member.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = ANY($2::uuid[]) AND assignment.active AND assignment.is_manager
      ORDER BY 1, 2`, [workspaceId, ids])).rows;
  const byProject = new Map<string, string[]>();
  for (const row of rows) byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), row.membershipId]);
  return byProject;
}

/** Active memberships among these ids (an owner who left is nobody's owner). */
export async function activeMemberships(db: Db, workspaceId: string, ids: readonly (string | null | undefined)[]): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return new Set();
  return new Set((await db.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
    [workspaceId, wanted])).rows.map((row) => row.id));
}

/** The pre-project behind each case: its client, the client's party, the case owner and the account manager. */
export type CaseFacts = { caseId: string; opportunityId: string; partyId: string | null; leadId: string | null; client: string; title: string; ownerMembershipId: string | null; accountMembershipId: string | null; projectId: string | null };

export async function readCases(db: Db, workspaceId: string, caseIds: readonly string[]): Promise<Map<string, CaseFacts>> {
  const ids = [...new Set(caseIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = (await db.query<CaseFacts>(
    `SELECT pre_case.id AS "caseId", opportunity.id AS "opportunityId", opportunity.party_id AS "partyId", opportunity.lead_id AS "leadId",
            coalesce(party.display_name, opportunity.title, '') AS client, coalesce(opportunity.title, '') AS title,
            owner.id AS "ownerMembershipId", account.id AS "accountMembershipId",
            (SELECT project.id FROM delivery_projects project WHERE project.workspace_id = pre_case.workspace_id AND project.case_id = pre_case.id ORDER BY project.created_at LIMIT 1) AS "projectId"
       FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN workspace_memberships owner ON owner.workspace_id = pre_case.workspace_id AND owner.id = pre_case.owner_membership_id AND owner.status = 'active'
       LEFT JOIN workspace_memberships account ON account.workspace_id = opportunity.workspace_id AND account.id = opportunity.owner_membership_id AND account.status = 'active'
      WHERE pre_case.workspace_id = $1 AND pre_case.id = ANY($2::uuid[])`, [workspaceId, ids])).rows;
  return new Map(rows.map((row) => [row.caseId, row]));
}

/** Money as people read it, from the numeric text the database gives (exact decimals, never a float), in the currency's places. */
export function money(currency: string, amount: string) {
  const fixed = Dec.of(amount).toFixed(currencyDecimals(currency));
  const [whole, fraction] = fixed.replace(/^-/, "").split(".");
  return `${currency} ${fixed.startsWith("-") ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""}`;
}
