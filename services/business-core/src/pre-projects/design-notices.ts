import type { PoolClient } from "pg";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { caseFacts, salesAdminMembership } from "../design/design-journey.store";
import { roundChargeable, STAGE_LABELS, type JourneyStage } from "../design/design-journey.domain";

type Db = Pick<PoolClient, "query">;

/**
 * Who hears about a design review step: the reviewer when asked, the designer when it comes back
 * (approved or sent back, internally or by the client), the Account Manager when the client decides,
 * and anyone @mentioned. The person who acted is never told about their own step.
 */
export async function noticeDesignStep(db: Db, input: {
  workspaceId: string; caseId: string; designId: string; title: string; action: string; fromStatus: string;
  actorUserId: string | null; reviewerUserId?: string | null; uploaderUserId?: string | null; note?: string; activityId: string;
}) {
  const facts = await caseFacts(db, input.workspaceId, input.caseId);
  const clientName = facts?.clientName ?? "the client";
  const actor = input.actorUserId ? (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [input.actorUserId])).rows[0]?.name ?? "Someone" : clientName;
  const managerUserId = facts?.accountManagerId ? (await db.query<{ userId: string }>(`SELECT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [input.workspaceId, facts.accountManagerId])).rows[0]?.userId ?? null : null;
  const deepLink = `/workspace/pre-projects/cases/${input.caseId}/designs?file=${input.designId}`;
  const variables = { title: input.title, clientName, actor, note: input.note?.trim() || "" };
  const tell = async (recipients: Array<string | null | undefined>, code: string, email = false) => {
    for (const userId of [...new Set(recipients.filter((id): id is string => Boolean(id) && id !== input.actorUserId))]) {
      const message = { workspaceId: input.workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink };
      await notifyUserInApp(db, { ...message, idempotencyKey: `${code}:${input.activityId}:${userId}` });
      if (email) await queueUserEmail(db, { ...message, idempotencyKey: `${code}:${input.activityId}:${userId}:email` });
    }
  };
  if (input.action === "internal_review") await tell([input.reviewerUserId], "design.review_requested", true);
  else if (input.action === "internal_approved") await tell([input.uploaderUserId], "design.review_approved");
  else if (input.action === "changes_requested" && input.fromStatus === "internal_review") await tell([input.uploaderUserId], "design.sent_back");
  else if (input.fromStatus === "client_review" && ["approved", "changes_requested", "rejected"].includes(input.action))
    await tell([input.uploaderUserId, managerUserId], input.action === "approved" ? "design.client_approved" : "design.client_changes", true);
}

/**
 * PLM-049/051: a client round is a revision after the first; a revision beyond the package's included ones is
 * chargeable. The Account Manager and the Sales Admin hear it once per revision (in the app and by email) so the
 * extra-revision fee is agreed before the work.
 */
export async function noticeExtraRevision(db: Db, input: { workspaceId: string; caseId: string; designId: string; title: string; stage: string | null; round: number; included: number | null; actorUserId: string; versionId: string }) {
  if (input.included === null || !roundChargeable(input.round, input.included)) return;
  const facts = await caseFacts(db, input.workspaceId, input.caseId);
  const members = [facts?.accountManagerId, await salesAdminMembership(db, input.workspaceId, input.caseId)].filter((id): id is string => Boolean(id));
  const recipients = (await db.query<{ userId: string }>(`SELECT DISTINCT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`, [input.workspaceId, members])).rows
    .map((row) => row.userId).filter((userId) => userId !== input.actorUserId);
  const variables = { stage: STAGE_LABELS[(input.stage ?? "concepts") as JourneyStage] ?? "Design", clientName: facts?.clientName ?? "the client", round: String(input.round - 1), included: String(input.included), title: input.title };
  for (const recipientUserId of recipients) {
    const message = { workspaceId: input.workspaceId, recipientUserId, code: "design.extra_revision", eventType: "design.extra_revision", variables, deepLink: `/workspace/pre-projects/cases/${input.caseId}/designs?file=${input.designId}` };
    await notifyUserInApp(db, { ...message, idempotencyKey: `design.extra_revision:${input.versionId}:${recipientUserId}` });
    await queueUserEmail(db, { ...message, idempotencyKey: `design.extra_revision:${input.versionId}:${recipientUserId}:email` });
  }
}

export async function noticeDesignMentions(db: Db, input: { workspaceId: string; caseId: string; designId: string; title: string; actorUserId: string; mentions: string[]; body: string; threadId: string }) {
  if (!input.mentions.length) return;
  const actor = (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [input.actorUserId])).rows[0]?.name ?? "Someone";
  const deepLink = `/workspace/pre-projects/cases/${input.caseId}/designs?file=${input.designId}`;
  for (const userId of [...new Set(input.mentions)].filter((id) => id !== input.actorUserId))
    await notifyUserInApp(db, { workspaceId: input.workspaceId, recipientUserId: userId, code: "design.mentioned", eventType: "design.mentioned", variables: { title: input.title, actor, note: input.body.slice(0, 280) }, deepLink, idempotencyKey: `design.mentioned:${input.threadId}:${userId}` });
}

export type DesignQueueItem = {
  designId: string; caseId: string; title: string; stage: string | null; roomName: string | null; clientName: string; caseTitle: string;
  status: string; step: "review" | "record_client" | "present" | "revise"; since: string; dueAt: string | null;
};

/**
 * What's waiting on this person across active planning cases: designs to review (assigned to them, or
 * unassigned if they review designs), client decisions to record, and their own designs that are
 * ready to present or came back for changes. Oldest first.
 */
export async function designQueue(db: Db, workspaceId: string, userId: string, can: { review: boolean; recordClient: boolean }): Promise<DesignQueueItem[]> {
  return (await db.query<DesignQueueItem>(
    `SELECT design.id AS "designId", design.case_id AS "caseId", design.title, design.stage, room.name AS "roomName",
            COALESCE(party.display_name, opportunity.title) AS "clientName", opportunity.title AS "caseTitle", latest.status,
            CASE WHEN latest.status = 'internal_review' THEN 'review' WHEN latest.status = 'client_review' THEN 'record_client'
                 WHEN latest.status = 'internal_approved' THEN 'present' ELSE 'revise' END AS step,
            COALESCE((SELECT max(activity.created_at) FROM pre_project_design_activity activity WHERE activity.workspace_id = design.workspace_id AND activity.version_id = latest.id), latest.created_at) AS since,
            latest.client_review_expires_at AS "dueAt"
       FROM pre_project_designs design
       JOIN LATERAL (SELECT id, status, reviewer_id, created_by, created_at, client_review_expires_at FROM pre_project_design_versions version
                      WHERE version.workspace_id = design.workspace_id AND version.design_id = design.id ORDER BY number DESC LIMIT 1) latest ON true
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = design.workspace_id AND pre_case.id = design.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = design.workspace_id AND room.id = design.room_id
      WHERE design.workspace_id = $1 AND design.archived_at IS NULL AND pre_case.status = 'active' AND (
            (latest.status = 'internal_review' AND (latest.reviewer_id = $2 OR (latest.reviewer_id IS NULL AND $3::boolean)))
         OR (latest.status = 'client_review' AND latest.client_review_expires_at > now() AND $4::boolean)
         OR (latest.status IN ('internal_approved', 'changes_requested', 'rejected') AND latest.created_by = $2))
      ORDER BY since, design.title LIMIT 200`, [workspaceId, userId, can.review, can.recordClient])).rows;
}
