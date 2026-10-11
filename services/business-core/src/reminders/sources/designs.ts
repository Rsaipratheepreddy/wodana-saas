import { STAGE_LABELS, type JourneyStage } from "../../design/design-journey.domain";
import { deliverClientDefault } from "../delivery/client-router";
import { membershipsOfUsers } from "../delivery/people";
import type { DueItem, ReminderSource } from "../engine/engine";
import { encode, idsOf, keysOf, managersByProject, readCases, UUID } from "./support";

const DAY = 86_400_000;

/**
 * client.design_decision (replaces the design part of client decision reminders): a design version shared for the
 * client's review, and project drawings sent for their approval. The client's decision-makers hear 2 and 5 days after
 * it reached them, then the case owner (and the design's author, or the project manager) get a copy. Done when the
 * version is decided or superseded (or its review link ran out), or the drawings are decided.
 */
export const designDecisionSource: ReminderSource = {
  kind: "client.design_decision", module: "design", audience: "client", critical: false, notify: "engine",
  viewPermission: "pre_projects.view", template: { code: "reminders.client.design_decision" },
  async open(db, workspaceId, { now, limit }) {
    const versions = (await db.query<{ id: string; caseId: string; title: string; number: number; sharedAt: Date; authorUserId: string | null }>(
      `SELECT version.id, design.case_id AS "caseId", design.title, version.number, shared.at AS "sharedAt", version.created_by AS "authorUserId"
         FROM pre_project_design_versions version
         JOIN pre_project_designs design ON design.workspace_id = version.workspace_id AND design.id = version.design_id AND design.archived_at IS NULL
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = design.workspace_id AND pre_case.id = design.case_id AND pre_case.status = 'active'
         CROSS JOIN LATERAL (SELECT max(activity.created_at) AS at FROM pre_project_design_activity activity
                              WHERE activity.workspace_id = version.workspace_id AND activity.version_id = version.id AND activity.action = 'client_review') shared
        WHERE version.workspace_id = $1 AND version.status = 'client_review' AND shared.at IS NOT NULL AND shared.at >= $2::timestamptz - interval '90 days'
          AND (version.client_review_expires_at IS NULL OR version.client_review_expires_at > $2)
          AND version.number = (SELECT max(latest.number) FROM pre_project_design_versions latest WHERE latest.workspace_id = version.workspace_id AND latest.design_id = version.design_id)
        ORDER BY shared.at DESC LIMIT $3`, [workspaceId, now, limit])).rows;
    const drawings = (await db.query<{ id: string; projectId: string; caseId: string | null; number: number; sentAt: Date; project: string }>(
      `SELECT revision.id, revision.project_id AS "projectId", project.case_id AS "caseId", revision.number, revision.sent_at AS "sentAt",
              concat_ws(' · ', nullif(project.reference, ''), project.name) AS project
         FROM project_drawing_revisions revision
         JOIN delivery_projects project ON project.workspace_id = revision.workspace_id AND project.id = revision.project_id AND project.status IN ('active', 'on_hold')
        WHERE revision.workspace_id = $1 AND revision.status = 'sent' AND revision.sent_at IS NOT NULL AND revision.sent_at >= $2::timestamptz - interval '90 days'
        ORDER BY revision.sent_at DESC LIMIT $3`, [workspaceId, now, limit])).rows;
    const cases = await readCases(db, workspaceId, [...versions.map((row) => row.caseId), ...drawings.map((row) => row.caseId ?? "")].filter((id) => UUID.test(id)));
    const authors = await membershipsOfUsers(db, workspaceId, versions.map((row) => row.authorUserId));
    const managers = await managersByProject(db, workspaceId, drawings.map((row) => row.projectId));
    const items: DueItem[] = [];
    for (const row of versions) {
      const facts = cases.get(row.caseId);
      if (!facts) continue;
      const owner = facts.ownerMembershipId ?? facts.accountMembershipId;
      const author = row.authorUserId ? authors.get(row.authorUserId) ?? null : null;
      items.push({
        key: `design:${row.id}`, sourceType: "design_version", sourceId: row.id, jobSource: { type: "case", id: row.caseId }, projectId: facts.projectId, caseId: row.caseId,
        partyId: facts.partyId, ownerMembershipId: owner, ccMembershipIds: author && author !== owner ? [author] : [], dueAt: new Date(row.sharedAt),
        title: `${row.title} R${row.number}`, context: facts.client, href: `/workspace/pre-projects/cases/${encode(row.caseId)}/designs`,
        variables: { client: facts.client, clientContext: facts.title },
      });
    }
    for (const row of drawings) {
      const facts = row.caseId ? cases.get(row.caseId) : undefined;
      if (!facts || !row.caseId) continue;
      const pms = managers.get(row.projectId) ?? [];
      const owner = pms[0] ?? facts.ownerMembershipId;
      items.push({
        key: `drawings:${row.id}`, sourceType: "drawing_revision", sourceId: row.id, jobSource: { type: "project", id: row.projectId }, projectId: row.projectId,
        caseId: row.caseId, partyId: facts.partyId, ownerMembershipId: owner, ccMembershipIds: pms.filter((id) => id !== owner), dueAt: new Date(row.sentAt),
        title: `Drawings R${row.number}`, context: facts.client, href: `/workspace/projects/${encode(row.projectId)}/scope?view=drawings`,
        variables: { client: facts.client, clientContext: row.project },
      });
    }
    return items.slice(0, limit);
  },
  async stillOpen(db, workspaceId, keys, at) {
    const now = at?.now ?? new Date();
    const versions = idsOf(keys, "design");
    const drawings = idsOf(keys, "drawings");
    const open = new Set<string>();
    if (versions.length) for (const row of (await db.query<{ id: string }>(
      `SELECT version.id FROM pre_project_design_versions version
         JOIN pre_project_designs design ON design.workspace_id = version.workspace_id AND design.id = version.design_id AND design.archived_at IS NULL
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = design.workspace_id AND pre_case.id = design.case_id AND pre_case.status = 'active'
        WHERE version.workspace_id = $1 AND version.id = ANY($2::uuid[]) AND version.status = 'client_review'
          AND (version.client_review_expires_at IS NULL OR version.client_review_expires_at > $3)
          AND version.number = (SELECT max(latest.number) FROM pre_project_design_versions latest WHERE latest.workspace_id = version.workspace_id AND latest.design_id = version.design_id)`,
      [workspaceId, versions, now])).rows) open.add(`design:${row.id}`);
    if (drawings.length) for (const row of (await db.query<{ id: string }>(
      `SELECT revision.id FROM project_drawing_revisions revision
         JOIN delivery_projects project ON project.workspace_id = revision.workspace_id AND project.id = revision.project_id AND project.status IN ('active', 'on_hold')
        WHERE revision.workspace_id = $1 AND revision.id = ANY($2::uuid[]) AND revision.status = 'sent'`, [workspaceId, drawings])).rows) open.add(`drawings:${row.id}`);
    return open;
  },
  deliverClient(db, workspaceId, delivery) {
    return deliverClientDefault(db, workspaceId, { ...delivery, variables: { ...delivery.variables, context: delivery.variables.clientContext ?? "" } },
      { whatsappEvent: "portal.decision_waiting", section: "decisions", approversOnly: true });
  },
};

/**
 * design.stage_due (replaces the overdue notice of design deadlines; the stage's overdue mark and history stay): an
 * active design stage with a due date. Its owner (else the case's designer) hears the day before, on the day and
 * after (−1, 0, +1, +3), with the account manager copied; then their team lead and the owner. Done when the stage is
 * done (or skipped, which also leaves it inactive).
 */
export const designStageSource: ReminderSource = {
  kind: "design.stage_due", module: "design", audience: "staff", critical: false, notify: "engine",
  viewPermission: "pre_projects.view", template: { code: "reminders.design.stage_due" },
  async open(db, workspaceId, { now, limit }) {
    const rows = (await db.query<{ caseId: string; stage: JourneyStage; dueAt: Date; owner: string | null; designer: string | null }>(
      `SELECT stage.case_id AS "caseId", stage.stage, stage.due_at AS "dueAt", owner.id AS owner, designer.membership_id AS designer
         FROM design_journey_stages stage
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = stage.workspace_id AND pre_case.id = stage.case_id AND pre_case.status = 'active'
         LEFT JOIN workspace_memberships owner ON owner.workspace_id = stage.workspace_id AND owner.id = stage.owner_membership_id AND owner.status = 'active'
         LEFT JOIN crm_opportunity_designer designer ON designer.workspace_id = pre_case.workspace_id AND designer.opportunity_id = pre_case.opportunity_id
        WHERE stage.workspace_id = $1 AND stage.status = 'active' AND stage.due_at IS NOT NULL AND stage.stage <> 'inspiration'
          AND stage.due_at BETWEEN $2::timestamptz - interval '90 days' AND $2::timestamptz + interval '14 days'
        ORDER BY stage.due_at DESC LIMIT $3`, [workspaceId, now, limit])).rows;
    const cases = await readCases(db, workspaceId, rows.map((row) => row.caseId));
    return rows.flatMap((row): DueItem[] => {
      const facts = cases.get(row.caseId);
      if (!facts) return [];
      const owner = row.owner ?? row.designer ?? facts.accountMembershipId;
      return [{
        key: `design_stage:${row.caseId}:${row.stage}`, sourceType: "design_stage", sourceId: `${row.caseId}:${row.stage}`, jobSource: { type: "case", id: row.caseId },
        projectId: facts.projectId, caseId: row.caseId, partyId: facts.partyId, ownerMembershipId: owner,
        ccMembershipIds: facts.accountMembershipId && facts.accountMembershipId !== owner ? [facts.accountMembershipId] : [],
        dueAt: new Date(row.dueAt), title: STAGE_LABELS[row.stage] ?? row.stage, context: facts.client,
        href: `/workspace/pre-projects/cases/${encode(row.caseId)}/overview`, variables: { client: facts.client },
      }];
    });
  },
  async stillOpen(db, workspaceId, keys, at) {
    const pairs = keys.map((key) => key.split(":")).filter((parts) => parts[0] === "design_stage" && parts.length === 3 && UUID.test(parts[1]));
    if (!pairs.length) return new Set();
    const horizon = at ? new Date(at.now.getTime() + 14 * DAY) : null;
    return new Set((await db.query<{ key: string }>(
      `SELECT 'design_stage:' || stage.case_id || ':' || stage.stage AS key FROM design_journey_stages stage
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = stage.workspace_id AND pre_case.id = stage.case_id AND pre_case.status = 'active'
        WHERE stage.workspace_id = $1 AND (stage.case_id, stage.stage) IN (SELECT * FROM unnest($2::uuid[], $3::text[]))
          AND stage.status = 'active' AND stage.due_at IS NOT NULL AND ($4::timestamptz IS NULL OR stage.due_at <= $4)`,
      [workspaceId, pairs.map((parts) => parts[1]), pairs.map((parts) => parts[2]), horizon])).rows.map((row) => row.key));
  },
};
