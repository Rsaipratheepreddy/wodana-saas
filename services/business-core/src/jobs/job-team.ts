import type { PoolClient } from "pg";
import { DEFAULT_APPROVAL_POLICIES, OWNER_ROLE } from "../approvals/approval-policy";
import { designTeamConfig } from "../design/design-journey.store";
import { boqTechnicalRoleOf } from "../project-core/project-boq-state";
import { DEFAULT_ROLES, LEAD_ROLE, type ProjectRole } from "../project-core/project-checks";
import { INSTALLATION_ROLE } from "../project-core/project-installation";

type Db = Pick<PoolClient, "query">;

/** Someone on the job: by name to show, by membership to match (two people may share a name). */
export type Person = { name: string | null; membershipId: string };
/** Who owns a step, and the role it waits on in the firm's words (said when nobody holds it). */
export type StepOwner = { owner: string | null; ownerId: string | null; ownerRole: string };

export type JobTeam = {
  accountManager: StepOwner; leadDesigner: StepOwner; visualiser: StepOwner; reviewer: StepOwner; materialCoordinator: StepOwner;
  salesAdmin: StepOwner; qs: StepOwner; pricingApprover: StepOwner; finance: StepOwner;
  projectManager: StepOwner; technical: StepOwner; margin: StepOwner; procurement: StepOwner; factory: StepOwner; installation: StepOwner; siteReports: StepOwner;
  /** A firm's own project stage: whoever holds its owner role, else the project manager. */
  stage(ownerRole: string | null): StepOwner;
  /** Someone the journey already knows (the enquiry's owner), in a role's words. */
  as(person: Person | null, role: string): StepOwner;
};

type Member = Person & { project: boolean; manager: boolean; roles: string[]; purchasing: boolean };

const humanise = (key: string) => key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
const FINANCE_APPROVER = "Finance approver";

/**
 * §0.3: the job's team, stage by stage, read once per job: the people allocated on the Planning case and on the project
 * (project_assignments, the design team's slots from the firm's configuration), the QS the quotation was sent to, the
 * package's reviewer and whoever holds the Deal File's approval step. Each step of the journey takes its owner from here;
 * a role nobody holds stays empty, named in the firm's words.
 */
export async function loadJobTeam(db: Db, workspaceId: string, job: {
  caseId: string | null; projectId: string | null; opportunityId: string | null; accountManager: Person | null; designer: Person | null;
}): Promise<JobTeam> {
  const config = await designTeamConfig(db, workspaceId);
  const settings = (await db.query<{ roles: ProjectRole[] | null; boqTechnicalRole: string | null }>(
    `SELECT roles, boq_technical_role AS "boqTechnicalRole" FROM workspace_project_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
  const roles = settings?.roles?.length ? settings.roles : DEFAULT_ROLES;
  const members = job.caseId || job.projectId ? (await db.query<Member>(
    `SELECT assignment.membership_id::text AS "membershipId", coalesce(nullif(btrim(person.display_name), ''), person.primary_email) AS name,
            assignment.project_id IS NOT NULL AS project, assignment.is_manager AS manager, assignment.role_keys::text[] AS roles,
            EXISTS (SELECT 1 FROM effective_member_roles assigned JOIN role_permissions granted ON granted.role_id = assigned.role_id
                      JOIN permissions permission ON permission.id = granted.permission_id
                     WHERE assigned.workspace_id = assignment.workspace_id AND assigned.membership_id = assignment.membership_id AND permission.code = 'purchasing.manage') AS purchasing
       FROM project_assignments assignment
       JOIN workspace_memberships member ON member.workspace_id = assignment.workspace_id AND member.id = assignment.membership_id AND member.status = 'active'
       JOIN users person ON person.id = member.user_id
      WHERE assignment.workspace_id = $1 AND assignment.active AND (assignment.case_id = $2 OR assignment.project_id = $3)
      ORDER BY assignment.id`, [workspaceId, job.caseId, job.projectId])).rows : [];
  // The package's reviewer (frozen on the design journey) and who holds that role; the QS the main quotation was last sent to.
  const facts = (await db.query<{ reviewRole: string | null; reviewRoleName: string | null; reviewer: Person | null; qsReviewer: Person | null }>(
    `WITH review AS (
       SELECT coalesce(journey.reviewer_role_code, package.review_role_code) AS code
         FROM (SELECT 1) one
         LEFT JOIN design_journeys journey ON journey.workspace_id = $1 AND journey.case_id = $2
         LEFT JOIN crm_opportunity_discovery discovery ON discovery.workspace_id = $1 AND discovery.opportunity_id = $3
         LEFT JOIN design_packages package ON package.workspace_id = $1 AND package.id = discovery.design_package_id)
     SELECT review.code AS "reviewRole",
            (SELECT role.name FROM roles role WHERE role.workspace_id = $1 AND lower(role.code) = lower(review.code) LIMIT 1) AS "reviewRoleName",
            (SELECT json_build_object('membershipId', member.id, 'name', coalesce(nullif(btrim(person.display_name), ''), person.primary_email))
               FROM workspace_memberships member JOIN users person ON person.id = member.user_id
              WHERE member.workspace_id = $1 AND member.status = 'active'
                AND (EXISTS (SELECT 1 FROM effective_member_roles assigned JOIN roles role ON role.id = assigned.role_id AND role.workspace_id = assigned.workspace_id
                              WHERE assigned.workspace_id = member.workspace_id AND assigned.membership_id = member.id AND lower(role.code) = lower(review.code))
                  OR EXISTS (SELECT 1 FROM workspace_team_members held JOIN workspace_teams team ON team.id = held.team_id AND team.workspace_id = held.workspace_id AND team.status = 'active'
                              WHERE held.workspace_id = member.workspace_id AND held.membership_id = member.id AND lower(team.code) = lower(review.code)))
              ORDER BY member.id LIMIT 1) AS reviewer,
            (SELECT json_build_object('membershipId', member.id, 'name', coalesce(nullif(btrim(person.display_name), ''), person.primary_email))
               FROM quote_qs_reviews qs
               JOIN commercial_quotes quote ON quote.workspace_id = qs.workspace_id AND quote.case_id = qs.case_id AND quote.id = qs.quote_id AND coalesce(quote.round, 'main') = 'main'
               JOIN workspace_memberships member ON member.workspace_id = qs.workspace_id AND member.user_id = qs.assignee_user_id AND member.status = 'active'
               JOIN users person ON person.id = member.user_id
              WHERE qs.workspace_id = $1 AND qs.case_id = $2 ORDER BY qs.requested_at DESC LIMIT 1) AS "qsReviewer"
       FROM review`, [workspaceId, job.caseId, job.opportunityId])).rows[0];
  // The Deal File's approval step: the one its open request waits on (the Owner past the policy's steps), else the policy's
  // first step, else the product's. Among the people who hold it, the one whose role is narrowest (Finance before an admin).
  const finance = (await db.query<Person>(
    `WITH pending AS (
       SELECT coalesce(step.approver_kind, 'role')::text AS kind, step.permission_code::text AS permission,
              (CASE WHEN step.id IS NULL THEN $4 ELSE step.role_code END)::text AS role, step.user_id AS "userId", 1 AS rank
         FROM approval_requests request
         JOIN commercial_cases_view commercial ON commercial.workspace_id = request.workspace_id AND commercial.case_id = $2
              AND request.subject_id::text = commercial.content->'ownerReview'->>'id'
         LEFT JOIN approval_policy_steps step ON step.workspace_id = request.workspace_id AND step.policy_version_id = request.policy_version_id AND step.position = request.current_step
        WHERE request.workspace_id = $1 AND request.subject_kind = 'deal_file' AND request.status = 'pending'),
     configured AS (
       SELECT step.approver_kind::text, step.permission_code::text, step.role_code::text, step.user_id, 2
         FROM approval_policies policy
         JOIN approval_policy_versions version ON version.workspace_id = policy.workspace_id AND version.policy_id = policy.id AND version.version_number = policy.current_version
         JOIN approval_policy_steps step ON step.workspace_id = version.workspace_id AND step.policy_version_id = version.id AND step.position = 1
        WHERE policy.workspace_id = $1 AND policy.subject_kind = 'deal_file' AND policy.status = 'active' AND policy.is_default),
     chosen AS (
       SELECT * FROM (SELECT * FROM pending UNION ALL SELECT * FROM configured UNION ALL SELECT 'permission', $3::text, NULL, NULL::uuid, 3) steps ORDER BY rank LIMIT 1)
     SELECT member.id::text AS "membershipId", coalesce(nullif(btrim(person.display_name), ''), person.primary_email) AS name
       FROM chosen CROSS JOIN workspace_memberships member
       JOIN users person ON person.id = member.user_id AND person.status = 'active'
       LEFT JOIN effective_member_roles assigned ON assigned.workspace_id = member.workspace_id AND assigned.membership_id = member.id
       LEFT JOIN roles role ON role.id = assigned.role_id
       LEFT JOIN role_permissions granted ON granted.role_id = assigned.role_id
       LEFT JOIN permissions permission ON permission.id = granted.permission_id
       LEFT JOIN LATERAL (SELECT count(*) AS size FROM role_permissions breadth WHERE breadth.role_id = role.id) breadth ON true
      WHERE member.workspace_id = $1 AND member.status = 'active'
        AND ((chosen.kind = 'permission' AND permission.code = chosen.permission) OR (chosen.kind = 'role' AND role.code = chosen.role)
          OR (chosen.kind = 'person' AND member.user_id = chosen."userId"))
      GROUP BY member.id, person.display_name, person.primary_email
      ORDER BY min(breadth.size) NULLS FIRST, 2, 1 LIMIT 1`,
    [workspaceId, job.caseId, DEFAULT_APPROVAL_POLICIES.deal_file.steps[0].permissionCode, OWNER_ROLE])).rows[0] ?? null;

  const label = (role: string) => roles.find((item) => item.key === role)?.label ?? DEFAULT_ROLES.find((item) => item.key === role)?.label ?? humanise(role);
  const as = (person: Person | null, role: string): StepOwner => ({ owner: person?.name ?? null, ownerId: person?.membershipId ?? null, ownerRole: role });
  // A role's holder: on the project first (its team carries the case's), else on the case; design work looks at the case first.
  const holder = (role: string | null | undefined, first: "case" | "project" = "project"): Person | null => {
    if (!role) return null;
    const order = first === "project" ? [true, false] : [false, true];
    for (const project of order) {
      const member = members.find((item) => item.project === project && item.roles.includes(role));
      if (member) return { name: member.name, membershipId: member.membershipId };
    }
    return null;
  };
  const manager = members.find((item) => item.project && item.manager) ?? holder(LEAD_ROLE);
  const accountManager = job.accountManager ?? holder("account_manager", "case");
  const lead = holder(config.lead_designer, "case") ?? job.designer;
  const leadRole = label(config.lead_designer!);
  const reviewer = holder(facts?.reviewRole, "case") ?? facts?.reviewer ?? null;
  const reviewRole = facts?.reviewRoleName ?? (facts?.reviewRole ? label(facts.reviewRole) : "Reviewer");
  // A design slot the firm doesn't use is the lead designer's work.
  const slot = (key: string | null) => key ? as(holder(key, "case"), label(key)) : as(lead, leadRole);
  const technicalRole = boqTechnicalRoleOf({ boqTechnicalRole: settings?.boqTechnicalRole ?? null, roles }) ?? "technical_designer";
  const qsRole = label("quantity_surveyor");
  const purchaser = holder("procurement") ?? members.find((item) => item.project && item.purchasing) ?? members.find((item) => item.purchasing) ?? manager;
  const managerRole = label(LEAD_ROLE);
  return {
    accountManager: as(accountManager, label("account_manager")),
    leadDesigner: as(lead, leadRole),
    visualiser: slot(config.visualiser),
    reviewer: as(reviewer, reviewRole),
    materialCoordinator: slot(config.material_coordinator),
    salesAdmin: as((config.sales_admin ? holder(config.sales_admin, "case") : null) ?? accountManager, config.sales_admin ? label(config.sales_admin) : label("account_manager")),
    qs: as(facts?.qsReviewer ?? holder("quantity_surveyor", "case"), qsRole),
    pricingApprover: as(lead ?? reviewer ?? accountManager, leadRole),
    finance: as(finance, FINANCE_APPROVER),
    projectManager: as(manager, managerRole),
    technical: as(holder(technicalRole), label(technicalRole)),
    margin: as(holder("quantity_surveyor") ?? facts?.qsReviewer ?? null, qsRole),
    procurement: as(purchaser, label("procurement")),
    factory: as(holder("factory_lead"), label("factory_lead")),
    installation: as(holder(INSTALLATION_ROLE), label(INSTALLATION_ROLE)),
    siteReports: as(holder("site_supervisor") ?? manager, label("site_supervisor")),
    stage: (ownerRole) => as(holder(ownerRole) ?? manager, label(ownerRole ?? LEAD_ROLE)),
    as,
  };
}
