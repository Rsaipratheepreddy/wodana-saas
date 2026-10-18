import { UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { FlowDefinition, FlowStepDefinition } from "../flows/flow-definition";
import { notifyUserInApp, queueUserEmail } from "../../notifications/default-templates";

type Db = Pick<PoolClient, "query">;

/**
 * The team roles an enquiry can tag (PLM-100), product role codes. Sales is the enquiry's owner, so it is not here.
 * More roles join here, once, for every firm.
 */
export const LEAD_TEAM_ROLES = ["designer", "project_manager", "quantity_surveyor", "factory_lead"] as const;
export type LeadTeamRole = (typeof LEAD_TEAM_ROLES)[number];

/** Each role tagged on the enquiry: a member, or "not applicable" for this enquiry type. */
export type LeadTeamInput = { role: string; membershipId?: string | null; notApplicable?: boolean };
export type LeadTeamEntry = {
  role: LeadTeamRole; membershipId: string | null; name: string | null; notApplicable: boolean;
  setAt: string; setByName: string | null; version: number;
};

/** Steps a designer takes part in although Sales runs them: an intro meeting, a design round or a measured site visit. */
const DESIGNER_CHECKS = new Set(["intro_meeting_completed", "package_chosen", "discovery_complete", "site_visit_recorded", "design_stage_done", "material_list_signed_off"]);

/**
 * Which team roles an enquiry type asks for, read from its own steps (branches included): a role a step is given to
 * (the QS who prices, the factory lead who confirms feasibility), and a designer when the steps hold design work.
 * A type without them (a showroom sale) shows no team fields.
 */
export function teamRolesForDefinition(definition: Pick<FlowDefinition, "steps"> & Partial<Pick<FlowDefinition, "branches">> | null | undefined): LeadTeamRole[] {
  const steps: FlowStepDefinition[] = [...(definition?.steps ?? []), ...(definition?.branches ?? []).flatMap((branch) => branch.answers.flatMap((answer) => answer.steps))];
  const roles = new Set<string>(steps.map((step) => step.role));
  if (steps.some((step) => DESIGNER_CHECKS.has(step.check))) roles.add("designer");
  return LEAD_TEAM_ROLES.filter((role) => roles.has(role));
}

/** The permissions of the people who do design work: who can be an enquiry's designer and book an intro with a client. */
export const DESIGNER_PERMISSIONS = ["pre_projects.edit", "pre_projects.record_client_design_decisions"] as const;

export type TeamRoleMember = { id: string; displayName: string };

/**
 * Who each team role can be tagged with (PLM-100), names only, for whoever enters enquiries (no member directory):
 * the designer is one of the people who do design work, as the intro meeting's designer picker lists them
 * (DESIGNER_PERMISSIONS); another role, a member who holds that role or is in its team. Active members only.
 */
export async function teamMembersByRole(db: Db, workspaceId: string): Promise<Record<LeadTeamRole, TeamRoleMember[]>> {
  const rows = (await db.query<TeamRoleMember & { role: LeadTeamRole }>(
    `SELECT wanted.role, membership.id, coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS "displayName"
       FROM unnest($2::text[]) AS wanted(role)
       JOIN workspace_memberships membership ON membership.workspace_id = $1 AND membership.status = 'active'
       JOIN users account ON account.id = membership.user_id AND account.status = 'active'
      WHERE CASE WHEN wanted.role = 'designer'
        THEN (SELECT count(DISTINCT permission.code) FROM effective_member_roles assigned
                JOIN role_permissions granted ON granted.role_id = assigned.role_id
                JOIN permissions permission ON permission.id = granted.permission_id
               WHERE assigned.workspace_id = membership.workspace_id AND assigned.membership_id = membership.id
                 AND permission.code = ANY($3::text[])) = cardinality($3::text[])
        ELSE EXISTS (SELECT 1 FROM effective_member_roles assigned JOIN roles held ON held.id = assigned.role_id
                      WHERE assigned.workspace_id = membership.workspace_id AND assigned.membership_id = membership.id
                        AND lower(held.code) IN (wanted.role, 'team_' || wanted.role))
          OR EXISTS (SELECT 1 FROM workspace_team_members member
                       JOIN workspace_teams team ON team.workspace_id = member.workspace_id AND team.id = member.team_id AND team.status = 'active'
                      WHERE member.workspace_id = membership.workspace_id AND member.membership_id = membership.id
                        AND lower(team.code) IN (wanted.role, 'team_' || wanted.role))
      END
      ORDER BY wanted.role, lower(coalesce(nullif(btrim(account.display_name), ''), account.primary_email)), membership.id`,
    [workspaceId, LEAD_TEAM_ROLES, DESIGNER_PERMISSIONS])).rows;
  return Object.fromEntries(LEAD_TEAM_ROLES.map((role) => [role, rows.filter((row) => row.role === role).map(({ id, displayName }) => ({ id, displayName }))])) as Record<LeadTeamRole, TeamRoleMember[]>;
}

/** The roles each enquiry type asks for, by enquiry type id, from the latest version of the type's steps. */
export async function teamRolesByEnquiryType(db: Db, workspaceId: string, enquiryTypes: Array<{ id: string; flow?: string | null }>) {
  const codes = [...new Set(enquiryTypes.map((type) => type.flow).filter((code): code is string => Boolean(code)))];
  if (!codes.length) return Object.fromEntries(enquiryTypes.map((type) => [type.id, []])) as Record<string, LeadTeamRole[]>;
  const rows = (await db.query<{ code: string; definition: FlowDefinition }>(
    `SELECT flow.code, version.definition FROM crm_flows flow
       JOIN LATERAL (SELECT definition FROM crm_flow_versions candidate WHERE candidate.workspace_id = flow.workspace_id AND candidate.flow_id = flow.id
                      ORDER BY candidate.version DESC LIMIT 1) version ON true
      WHERE flow.workspace_id = $1 AND flow.status = 'active' AND flow.code = ANY($2::text[])`, [workspaceId, codes])).rows;
  const byCode = new Map(rows.map((row) => [row.code, teamRolesForDefinition(row.definition)]));
  return Object.fromEntries(enquiryTypes.map((type) => [type.id, (type.flow && byCode.get(type.flow)) || []])) as Record<string, LeadTeamRole[]>;
}

/** The roles one enquiry type asks for. */
export async function teamRolesForType(db: Db, workspaceId: string, serviceType: string | null) {
  if (!serviceType) return [];
  const type = (await db.query<{ flow: string | null }>(
    `SELECT choice.flow FROM crm_taxonomy_options choice JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = choice.workspace_id
       AND taxonomy.id = choice.taxonomy_id AND taxonomy.code = 'enquiry_type'
      WHERE choice.workspace_id = $1 AND choice.code = $2 AND choice.status = 'active' LIMIT 1`, [workspaceId, serviceType])).rows[0];
  return (await teamRolesByEnquiryType(db, workspaceId, [{ id: serviceType, flow: type?.flow ?? null }]))[serviceType] ?? [];
}

/**
 * One row per role; a member must be active in the workspace. Idempotent: an unchanged choice writes nothing.
 * Returns the roles that changed, for the audit record.
 */
export async function writeLeadTeam(db: Db, workspaceId: string, leadId: string, team: LeadTeamInput[] | undefined, actorUserId: string | null) {
  const changed: string[] = [];
  if (!team?.length) return changed;
  for (const entry of team) {
    if (!(LEAD_TEAM_ROLES as readonly string[]).includes(entry.role)) throw new UnprocessableEntityException(`Unknown team role: ${entry.role}`);
    const membershipId = entry.membershipId?.trim() || null;
    const notApplicable = Boolean(entry.notApplicable) && !membershipId;
    if (!membershipId && !notApplicable) {
      // Cleared: the role is open again.
      const removed = await db.query(`DELETE FROM crm_lead_team WHERE workspace_id = $1 AND lead_id = $2 AND role_code = $3`, [workspaceId, leadId, entry.role]);
      if (removed.rowCount) changed.push(entry.role);
      continue;
    }
    if (membershipId) {
      const member = await db.query(`SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, membershipId]);
      if (!member.rowCount) throw new UnprocessableEntityException(`Choose an active team member as the ${entry.role.replace(/_/g, " ")}`);
    }
    const saved = await db.query(
      `INSERT INTO crm_lead_team (workspace_id, lead_id, role_code, membership_id, not_applicable, set_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, lead_id, role_code) DO UPDATE
         SET membership_id = EXCLUDED.membership_id, not_applicable = EXCLUDED.not_applicable, set_by = EXCLUDED.set_by, set_at = now(), version = crm_lead_team.version + 1
         WHERE crm_lead_team.membership_id IS DISTINCT FROM EXCLUDED.membership_id OR crm_lead_team.not_applicable <> EXCLUDED.not_applicable`,
      [workspaceId, leadId, entry.role, membershipId, notApplicable, actorUserId]);
    if (saved.rowCount) changed.push(entry.role);
  }
  return changed;
}

const ROLE_WORDS: Record<string, string> = { designer: "Designer", project_manager: "Project manager", quantity_surveyor: "Quantity surveyor", factory_lead: "Factory lead" };

/**
 * §0.3 P0: whoever was just tagged on an enquiry's team (the designer, for one) is told in the app and by email, once
 * per tagging; someone who tags themselves is not.
 */
export async function tellTaggedTeam(db: Db, workspaceId: string, leadId: string, roles: string[], actorUserId: string | null) {
  if (!roles.length) return;
  const tagged = (await db.query<{ role: string; userId: string; version: number; clientName: string; reference: string; actor: string | null }>(
    `SELECT team.role_code AS role, membership.user_id AS "userId", team.version, party.display_name AS "clientName", enquiry.reference,
            (SELECT account.display_name FROM users account WHERE account.id = $4) AS actor
       FROM crm_lead_team team
       JOIN workspace_memberships membership ON membership.workspace_id = team.workspace_id AND membership.id = team.membership_id AND membership.status = 'active'
       JOIN crm_leads lead ON lead.workspace_id = team.workspace_id AND lead.id = team.lead_id
       JOIN crm_parties party ON party.workspace_id = lead.workspace_id AND party.id = lead.party_id
       JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
      WHERE team.workspace_id = $1 AND team.lead_id = $2 AND team.role_code = ANY($3::text[])`, [workspaceId, leadId, roles, actorUserId])).rows;
  for (const entry of tagged) {
    if (entry.userId === actorUserId) continue;
    const variables = { role: ROLE_WORDS[entry.role] ?? entry.role.replace(/_/g, " "), reference: entry.reference, clientName: entry.clientName, actor: entry.actor ?? "Someone" };
    const key = `crm:team:${leadId}:${entry.role}:${entry.version}:${entry.userId}`;
    const deepLink = `/workspace/crm/leads?lead=${leadId}`;
    await notifyUserInApp(db, { workspaceId, recipientUserId: entry.userId, code: "crm.enquiry_team_tagged", eventType: "crm.team.tagged", variables, deepLink, idempotencyKey: key });
    await queueUserEmail(db, { workspaceId, recipientUserId: entry.userId, code: "crm.enquiry_team_tagged", eventType: "crm.team.tagged", variables, deepLink, idempotencyKey: `${key}:email` });
  }
}

export async function readLeadTeam(db: Db, workspaceId: string, leadId: string): Promise<LeadTeamEntry[]> {
  return (await db.query<LeadTeamEntry>(
    `SELECT team.role_code AS role, team.membership_id AS "membershipId", person.display_name AS name, team.not_applicable AS "notApplicable",
            team.set_at AS "setAt", setter.display_name AS "setByName", team.version
       FROM crm_lead_team team
       LEFT JOIN workspace_memberships membership ON membership.workspace_id = team.workspace_id AND membership.id = team.membership_id
       LEFT JOIN users person ON person.id = membership.user_id
       LEFT JOIN users setter ON setter.id = team.set_by
      WHERE team.workspace_id = $1 AND team.lead_id = $2 ORDER BY team.role_code`, [workspaceId, leadId])).rows;
}

/**
 * On conversion the enquiry's team joins the opportunity's team, and its designer becomes the opportunity's dedicated
 * designer (PLM-088), so the intro booking, Design & Planning and production already know who works on the job.
 * An opportunity that already has a designer keeps it. Returns the designer carried, if any.
 */
export async function carryTeamToOpportunity(db: Db, workspaceId: string, leadId: string, opportunityId: string, actorUserId: string | null) {
  await db.query(
    `INSERT INTO crm_opportunity_team (workspace_id, opportunity_id, membership_id, role)
     SELECT team.workspace_id, $3, team.membership_id, team.role_code FROM crm_lead_team team
      WHERE team.workspace_id = $1 AND team.lead_id = $2 AND team.membership_id IS NOT NULL
     ON CONFLICT DO NOTHING`, [workspaceId, leadId, opportunityId]);
  const carried = await db.query<{ membershipId: string }>(
    `INSERT INTO crm_opportunity_designer (workspace_id, opportunity_id, membership_id, assigned_by)
     SELECT team.workspace_id, $3, team.membership_id, $4 FROM crm_lead_team team
      WHERE team.workspace_id = $1 AND team.lead_id = $2 AND team.role_code = 'designer' AND team.membership_id IS NOT NULL
     ON CONFLICT (workspace_id, opportunity_id) DO NOTHING RETURNING membership_id AS "membershipId"`,
    [workspaceId, leadId, opportunityId, actorUserId]);
  const designer = carried.rows[0]?.membershipId;
  if (designer) {
    await db.query(`INSERT INTO crm_opportunity_designer_history (workspace_id, opportunity_id, from_membership_id, to_membership_id, reason, changed_by)
      VALUES ($1, $2, NULL, $3, 'Tagged on the enquiry', $4)`, [workspaceId, opportunityId, designer, actorUserId]);
  }
  return designer ?? null;
}
