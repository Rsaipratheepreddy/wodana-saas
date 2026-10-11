import type { JobLineageLink } from "../../jobs/job-lineage";
import type { DueItem, ReminderSource } from "../engine/engine";
import { encode, idsOf, keysOf } from "./support";

const OPEN_LEADS = "('new', 'attempting_contact', 'connected', 'nurturing', 'paused')";
const UNOWNED_LEADS = "('new', 'attempting_contact', 'connected', 'nurturing')";
const DAY = 86_400_000;

const leadJob = (leadId: string | null, opportunityId: string | null): JobLineageLink | null =>
  opportunityId ? { type: "opportunity", id: opportunityId } : leadId ? { type: "lead", id: leadId } : null;

/**
 * crm.follow_up (new): a follow-up (call, meeting, task) its owner planned, on the day it is due and the day after,
 * then their team lead and the owner. Done when it is no longer pending, or its enquiry or deal closed. "Mark done"
 * and "Reassign" run the follow-up's own commands (bound in my-day/module-commands.ts).
 */
export const followUpSource: ReminderSource = {
  kind: "crm.follow_up", module: "sales", audience: "staff", critical: false, notify: "engine",
  viewPermission: "crm.activities.view", template: { code: "reminders.crm.follow_up" },
  async open(db, workspaceId, { now, limit }) {
    const rows = (await db.query<{ id: string; title: string; dueAt: Date; owner: string; leadId: string | null; opportunityId: string | null; partyId: string | null; client: string }>(
      `SELECT activity.id, activity.title, activity.due_at AS "dueAt", activity.owner_membership_id AS owner, activity.lead_id AS "leadId",
              activity.opportunity_id AS "opportunityId", party.id AS "partyId", coalesce(party.display_name, '') AS client
         FROM crm_activities activity
         JOIN workspace_memberships owner ON owner.workspace_id = activity.workspace_id AND owner.id = activity.owner_membership_id AND owner.status = 'active'
         LEFT JOIN crm_leads lead ON lead.workspace_id = activity.workspace_id AND lead.id = activity.lead_id
         LEFT JOIN crm_opportunities opportunity ON opportunity.workspace_id = activity.workspace_id AND opportunity.id = activity.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id = activity.workspace_id AND party.id = coalesce(activity.party_id, lead.party_id, opportunity.party_id)
        WHERE activity.workspace_id = $1 AND activity.status = 'pending' AND activity.type <> 'note' AND activity.due_at IS NOT NULL
          AND activity.due_at BETWEEN $2::timestamptz AND $3::timestamptz
          AND (activity.lead_id IS NULL OR lead.status IN ${OPEN_LEADS}) AND (activity.opportunity_id IS NULL OR opportunity.status = 'open')
        ORDER BY activity.due_at DESC, activity.id LIMIT $4`,
      [workspaceId, new Date(now.getTime() - 90 * DAY), new Date(now.getTime() + 14 * DAY), limit])).rows;
    return rows.map((row): DueItem => ({
      key: `activity:${row.id}`, sourceType: "crm_activity", sourceId: row.id, jobSource: leadJob(row.leadId, row.opportunityId),
      projectId: null, caseId: null, partyId: row.partyId, ownerMembershipId: row.owner, ccMembershipIds: [], dueAt: new Date(row.dueAt),
      title: row.title, context: row.client, href: `/workspace/crm/follow-ups?record=${encode(row.id)}`, variables: { client: row.client },
    }));
  },
  async stillOpen(db, workspaceId, keys, at) {
    const ids = idsOf(keys, "activity");
    if (!ids.length) return new Set();
    return keysOf("activity", (await db.query<{ id: string }>(
      `SELECT activity.id FROM crm_activities activity
         LEFT JOIN crm_leads lead ON lead.workspace_id = activity.workspace_id AND lead.id = activity.lead_id
         LEFT JOIN crm_opportunities opportunity ON opportunity.workspace_id = activity.workspace_id AND opportunity.id = activity.opportunity_id
        WHERE activity.workspace_id = $1 AND activity.id = ANY($2::uuid[]) AND activity.status = 'pending' AND activity.due_at IS NOT NULL
          AND activity.owner_membership_id IS NOT NULL
          AND (activity.lead_id IS NULL OR lead.status IN ${OPEN_LEADS}) AND (activity.opportunity_id IS NULL OR opportunity.status = 'open')
          AND ($3::timestamptz IS NULL OR activity.due_at <= $3::timestamptz)`,
      [workspaceId, ids, at ? new Date(at.now.getTime() + 14 * DAY) : null])).rows.map((row) => row.id));
  },
};

/** crm.first_response (My day only; the SLA and its takeover stay in CRM): an enquiry whose first-response time ran out. */
export const firstResponseSource: ReminderSource = {
  kind: "crm.first_response", module: "sales", audience: "staff", critical: false, notify: "module",
  viewPermission: "crm.leads.view", poolPermission: "crm.leads.assign", template: { code: "" },
  async open(db, workspaceId, { now, limit }) {
    const rows = (await db.query<{ id: string; leadId: string; partyId: string; client: string; enquiry: string; dueAt: Date; owner: string | null }>(
      `SELECT sla.id, lead.id AS "leadId", party.id AS "partyId", party.display_name AS client, coalesce(enquiry.title, '') AS enquiry, sla.due_at AS "dueAt",
              owner.id AS owner
         FROM crm_sla_instances sla
         JOIN crm_leads lead ON lead.workspace_id = sla.workspace_id AND lead.id = sla.lead_id
         JOIN crm_parties party ON party.workspace_id = lead.workspace_id AND party.id = lead.party_id
         LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
         LEFT JOIN workspace_memberships owner ON owner.workspace_id = sla.workspace_id AND owner.id = sla.owner_membership_id AND owner.status = 'active'
        WHERE sla.workspace_id = $1 AND lead.status IN ${OPEN_LEADS} AND (sla.status = 'breached' OR (sla.status = 'active' AND sla.due_at < $2))
        ORDER BY sla.due_at DESC, sla.id LIMIT $3`, [workspaceId, now, limit])).rows;
    return rows.map((row): DueItem => ({
      key: `sla:${row.id}`, sourceType: "crm_sla_instance", sourceId: row.id, jobSource: { type: "lead", id: row.leadId }, projectId: null, caseId: null,
      partyId: row.partyId, ownerMembershipId: row.owner, ccMembershipIds: [], dueAt: new Date(row.dueAt), title: row.client, context: row.enquiry,
      href: `/workspace/crm/leads?lead=${encode(row.leadId)}`, variables: {},
    }));
  },
  async stillOpen(db, workspaceId, keys, at) {
    const ids = idsOf(keys, "sla");
    if (!ids.length) return new Set();
    return keysOf("sla", (await db.query<{ id: string }>(
      `SELECT sla.id FROM crm_sla_instances sla JOIN crm_leads lead ON lead.workspace_id = sla.workspace_id AND lead.id = sla.lead_id
        WHERE sla.workspace_id = $1 AND sla.id = ANY($2::uuid[]) AND lead.status IN ${OPEN_LEADS}
          AND (sla.status = 'breached' OR (sla.status = 'active' AND sla.due_at < $3))`, [workspaceId, ids, at?.now ?? new Date()])).rows.map((row) => row.id));
  },
};

/** crm.unowned (My day only): an open enquiry nobody owns waits on whoever assigns enquiries (unless its first response already ran out). */
export const unownedSource: ReminderSource = {
  kind: "crm.unowned", module: "sales", audience: "staff", critical: false, notify: "module",
  viewPermission: "crm.leads.view", poolPermission: "crm.leads.assign", template: { code: "" },
  async open(db, workspaceId, { now, limit }) {
    const rows = (await db.query<{ id: string; partyId: string; client: string; enquiry: string; dueAt: Date }>(
      `SELECT lead.id, party.id AS "partyId", party.display_name AS client, coalesce(enquiry.title, '') AS enquiry,
              CASE WHEN lead.escalation_due_at < $2 THEN lead.escalation_due_at ELSE lead.created_at END AS "dueAt"
         FROM crm_leads lead
         JOIN crm_parties party ON party.workspace_id = lead.workspace_id AND party.id = lead.party_id
         LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
        WHERE lead.workspace_id = $1 AND lead.owner_membership_id IS NULL AND lead.status IN ${UNOWNED_LEADS}
          AND NOT EXISTS (SELECT 1 FROM crm_sla_instances sla WHERE sla.workspace_id = lead.workspace_id AND sla.lead_id = lead.id
                           AND (sla.status = 'breached' OR (sla.status = 'active' AND sla.due_at < $2)))
        ORDER BY lead.created_at DESC, lead.id LIMIT $3`, [workspaceId, now, limit])).rows;
    return rows.map((row): DueItem => ({
      key: `lead:${row.id}`, sourceType: "crm_lead", sourceId: row.id, jobSource: { type: "lead", id: row.id }, projectId: null, caseId: null, partyId: row.partyId,
      ownerMembershipId: null, ccMembershipIds: [], dueAt: new Date(row.dueAt), title: row.client, context: row.enquiry, href: `/workspace/crm/leads?lead=${encode(row.id)}`, variables: {},
    }));
  },
  async stillOpen(db, workspaceId, keys, at) {
    const ids = idsOf(keys, "lead");
    if (!ids.length) return new Set();
    return keysOf("lead", (await db.query<{ id: string }>(
      `SELECT lead.id FROM crm_leads lead WHERE lead.workspace_id = $1 AND lead.id = ANY($2::uuid[]) AND lead.owner_membership_id IS NULL AND lead.status IN ${UNOWNED_LEADS}
          AND NOT EXISTS (SELECT 1 FROM crm_sla_instances sla WHERE sla.workspace_id = lead.workspace_id AND sla.lead_id = lead.id
                           AND (sla.status = 'breached' OR (sla.status = 'active' AND sla.due_at < $3)))`, [workspaceId, ids, at?.now ?? new Date()])).rows.map((row) => row.id));
  },
};

/** crm.confirm_client (My day only): their enquiry whose client may already be known waits for them to confirm who it is. */
export const confirmClientSource: ReminderSource = {
  kind: "crm.confirm_client", module: "sales", audience: "staff", critical: false, notify: "module",
  viewPermission: "crm.leads.view", template: { code: "" },
  async open(db, workspaceId, { now, limit }) {
    const rows = (await db.query<{ id: string; partyId: string; client: string; enquiry: string; dueAt: Date; owner: string }>(
      `SELECT lead.id, party.id AS "partyId", party.display_name AS client, coalesce(enquiry.title, '') AS enquiry, lead.owner_membership_id AS owner,
              CASE WHEN lead.client_review_due_at < $2 THEN lead.client_review_due_at ELSE lead.created_at END AS "dueAt"
         FROM crm_leads lead
         JOIN crm_parties party ON party.workspace_id = lead.workspace_id AND party.id = lead.party_id
         JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
         JOIN workspace_memberships owner ON owner.workspace_id = lead.workspace_id AND owner.id = lead.owner_membership_id AND owner.status = 'active'
        WHERE lead.workspace_id = $1 AND lead.status IN ${OPEN_LEADS}
          AND EXISTS (SELECT 1 FROM crm_identity_candidates candidate WHERE candidate.workspace_id = lead.workspace_id
                       AND candidate.intake_event_id = enquiry.intake_event_id AND candidate.status = 'pending')
        ORDER BY lead.created_at DESC, lead.id LIMIT $3`, [workspaceId, now, limit])).rows;
    return rows.map((row): DueItem => ({
      key: `lead:${row.id}`, sourceType: "crm_lead", sourceId: row.id, jobSource: { type: "lead", id: row.id }, projectId: null, caseId: null, partyId: row.partyId,
      ownerMembershipId: row.owner, ccMembershipIds: [], dueAt: new Date(row.dueAt), title: row.client, context: row.enquiry, href: `/workspace/crm/leads?lead=${encode(row.id)}`, variables: {},
    }));
  },
  async stillOpen(db, workspaceId, keys) {
    const ids = idsOf(keys, "lead");
    if (!ids.length) return new Set();
    return keysOf("lead", (await db.query<{ id: string }>(
      `SELECT lead.id FROM crm_leads lead JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
        WHERE lead.workspace_id = $1 AND lead.id = ANY($2::uuid[]) AND lead.status IN ${OPEN_LEADS} AND lead.owner_membership_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM crm_identity_candidates candidate WHERE candidate.workspace_id = lead.workspace_id
                       AND candidate.intake_event_id = enquiry.intake_event_id AND candidate.status = 'pending')`, [workspaceId, ids])).rows.map((row) => row.id));
  },
};

/**
 * crm.reply_waiting (My day only): a client's message nobody has answered. The chat's owner sees it; an unassigned
 * chat waits on the inbox team (crm.inbox.team), and the team view needs the inbox manager's reach (crm.inbox.manage),
 * so My day never shows a chat outside the person's inbox reach.
 */
export const replyWaitingSource: ReminderSource = {
  kind: "crm.reply_waiting", module: "sales", audience: "staff", critical: false, notify: "module",
  viewPermission: "crm.inbox.manage", poolPermission: "crm.inbox.team", template: { code: "" },
  async open(db, workspaceId, { limit }) {
    const rows = (await db.query<{ id: string; partyId: string; client: string; subject: string; dueAt: Date; owner: string | null; leadId: string | null }>(
      `SELECT conversation.id, party.id AS "partyId", party.display_name AS client, coalesce(conversation.subject, '') AS subject, conversation.last_inbound_at AS "dueAt",
              owner.id AS owner, conversation.lead_id AS "leadId"
         FROM crm_conversations conversation
         JOIN crm_parties party ON party.workspace_id = conversation.workspace_id AND party.id = conversation.party_id
         LEFT JOIN workspace_memberships owner ON owner.workspace_id = conversation.workspace_id AND owner.id = conversation.owner_membership_id AND owner.status = 'active'
        WHERE conversation.workspace_id = $1 AND conversation.status = 'open' AND conversation.last_inbound_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM crm_messages outbound WHERE outbound.workspace_id = conversation.workspace_id AND outbound.conversation_id = conversation.id
                           AND outbound.direction = 'outbound' AND outbound.status IN ('sent', 'delivered', 'read') AND outbound.created_at >= conversation.last_inbound_at)
        ORDER BY conversation.last_inbound_at DESC, conversation.id LIMIT $2`, [workspaceId, limit])).rows;
    return rows.map((row): DueItem => ({
      key: `conversation:${row.id}`, sourceType: "crm_conversation", sourceId: row.id, jobSource: row.leadId ? { type: "lead", id: row.leadId } : null,
      projectId: null, caseId: null, partyId: row.partyId, ownerMembershipId: row.owner, ccMembershipIds: [], dueAt: new Date(row.dueAt), title: row.client,
      context: row.subject, href: `/workspace/crm/conversations?record=${encode(row.id)}`, variables: {},
    }));
  },
  async stillOpen(db, workspaceId, keys) {
    const ids = idsOf(keys, "conversation");
    if (!ids.length) return new Set();
    return keysOf("conversation", (await db.query<{ id: string }>(
      `SELECT conversation.id FROM crm_conversations conversation
        WHERE conversation.workspace_id = $1 AND conversation.id = ANY($2::uuid[]) AND conversation.status = 'open' AND conversation.last_inbound_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM crm_messages outbound WHERE outbound.workspace_id = conversation.workspace_id AND outbound.conversation_id = conversation.id
                           AND outbound.direction = 'outbound' AND outbound.status IN ('sent', 'delivered', 'read') AND outbound.created_at >= conversation.last_inbound_at)`,
      [workspaceId, ids])).rows.map((row) => row.id));
  },
};
