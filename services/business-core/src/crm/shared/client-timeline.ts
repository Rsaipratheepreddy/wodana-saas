import type { PoolClient } from "pg";

export type ClientTimelineStatus =
  | "draft"
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "manually_logged";

export type ClientTimelineEvent = {
  id: string;
  kind: "message" | "activity" | "portal";
  channel: "email" | "whatsapp" | "phone" | "sms" | "portal" | "internal" | "other";
  direction: "inbound" | "outbound" | "internal";
  status: ClientTimelineStatus;
  providerStatus: string | null;
  title: string;
  detail: string | null;
  occurredAt: string;
  actor: { id: string; name: string | null } | null;
  failureCode: string | null;
  source: { type: "conversation" | "activity" | "portal_decision"; id: string };
};

type TimelineRow = Omit<ClientTimelineEvent, "occurredAt" | "actor" | "source"> & {
  occurredAt: Date;
  actorId: string | null;
  actorName: string | null;
  sourceType: ClientTimelineEvent["source"]["type"];
  sourceId: string;
};

function normalizedMessageStatus(status: string, direction: string): ClientTimelineStatus {
  if (direction === "internal") return "manually_logged";
  if (status === "read") return "delivered";
  if (["draft", "queued", "sent", "delivered", "failed"].includes(status)) {
    return status as ClientTimelineStatus;
  }
  return "draft";
}

function rowToEvent(row: TimelineRow): ClientTimelineEvent {
  return {
    id: row.id,
    kind: row.kind,
    channel: row.channel,
    direction: row.direction,
    status: row.status,
    providerStatus: row.providerStatus,
    title: row.title,
    detail: row.detail,
    occurredAt: row.occurredAt.toISOString(),
    actor: row.actorId ? { id: row.actorId, name: row.actorName } : null,
    failureCode: row.failureCode,
    source: { type: row.sourceType, id: row.sourceId },
  };
}

export async function queryClientTimeline(
  client: PoolClient,
  input: {
    workspaceId: string;
    partyId: string;
    caseIds?: string[];
    includeMessages: boolean;
    includeActivities: boolean;
    limit?: number;
  },
): Promise<ClientTimelineEvent[]> {
  const rows: TimelineRow[] = [];

  if (input.includeMessages) {
    const messages = await client.query<{
      id: string; channel: string; direction: string; status: string; subject: string | null;
      detail: string | null; occurredAt: Date; actorId: string | null; actorName: string | null;
      failureCode: string | null; conversationId: string;
    }>(
      `SELECT message.id::text,conversation.channel,message.direction,message.status,
              conversation.subject,LEFT(COALESCE(message.body_text,message.body_html,''),500) AS detail,
              COALESCE(message.read_at,message.delivered_at,message.sent_at,message.created_at) AS "occurredAt",
              message.sender_id::text AS "actorId",account.display_name AS "actorName",
              message.failure_code AS "failureCode",conversation.id::text AS "conversationId"
         FROM crm_messages message
         JOIN crm_conversations conversation
           ON conversation.workspace_id=message.workspace_id AND conversation.id=message.conversation_id
         LEFT JOIN users account ON account.id=message.sender_id AND message.sender_type='user'
        WHERE message.workspace_id=$1 AND conversation.party_id=$2
        ORDER BY COALESCE(message.read_at,message.delivered_at,message.sent_at,message.created_at) DESC,message.id DESC
        LIMIT $3`,
      [input.workspaceId, input.partyId, input.limit ?? 100],
    );
    rows.push(...messages.rows.map((row) => ({
      id: `message:${row.id}`,
      kind: "message" as const,
      channel: (["email", "whatsapp", "phone", "sms", "internal"].includes(row.channel) ? row.channel : "other") as TimelineRow["channel"],
      direction: (["inbound", "outbound", "internal"].includes(row.direction) ? row.direction : "internal") as TimelineRow["direction"],
      status: normalizedMessageStatus(row.status, row.direction),
      providerStatus: row.status,
      title: row.subject || (row.direction === "internal" ? "Private note" : `${row.channel} message`),
      detail: row.detail || null,
      occurredAt: row.occurredAt,
      actorId: row.actorId,
      actorName: row.actorName,
      failureCode: row.failureCode,
      sourceType: "conversation" as const,
      sourceId: row.conversationId,
    })));
  }

  if (input.includeActivities) {
    const activities = await client.query<{
      id: string; type: string; direction: string | null; title: string; description: string | null;
      outcome: string | null; occurredAt: Date; actorId: string | null; actorName: string | null;
    }>(
      `SELECT activity.id::text,activity.type,activity.interaction_direction AS direction,
              activity.title,activity.description,activity.completion_outcome AS outcome,
              COALESCE(activity.completed_at,activity.created_at) AS "occurredAt",
              activity.created_by::text AS "actorId",account.display_name AS "actorName"
         FROM crm_activities activity
         LEFT JOIN users account ON account.id=activity.created_by
        WHERE activity.workspace_id=$1 AND activity.party_id=$2
          AND (activity.type='note' OR (activity.type IN ('call','meeting','email','whatsapp','sms','portal','other') AND activity.status='completed'))
        ORDER BY COALESCE(activity.completed_at,activity.created_at) DESC,activity.id DESC
        LIMIT $3`,
      [input.workspaceId, input.partyId, input.limit ?? 100],
    );
    rows.push(...activities.rows.map((row) => ({
      id: `activity:${row.id}`,
      kind: row.type === "portal" ? "portal" as const : "activity" as const,
      channel: row.type === "note" ? "internal" as const
        : row.type === "call" || row.type === "meeting" ? "phone" as const
          : (["email", "whatsapp", "sms", "portal"].includes(row.type) ? row.type : "other") as TimelineRow["channel"],
      direction: (["inbound", "outbound", "internal"].includes(row.direction ?? "") ? row.direction : "internal") as TimelineRow["direction"],
      status: "manually_logged" as const,
      providerStatus: null,
      title: row.title,
      detail: row.outcome || row.description,
      occurredAt: row.occurredAt,
      actorId: row.actorId,
      actorName: row.actorName,
      failureCode: null,
      sourceType: "activity" as const,
      sourceId: row.id,
    })));
  }

  const caseIds = input.caseIds ?? [];
  if (caseIds.length) {
    const portal = await client.query<{
      id: string; action: string; note: string | null; decisionBy: string | null; occurredAt: Date; caseId: string;
    }>(
      `SELECT activity.id::text,activity.action,activity.note,
              activity.decision_by AS "decisionBy",COALESCE(activity.decision_at,activity.created_at) AS "occurredAt",
              activity.case_id::text AS "caseId"
         FROM pre_project_design_activity activity
        WHERE activity.workspace_id=$1 AND activity.case_id=ANY($2::uuid[])
          AND activity.decision_source='client_portal'
        ORDER BY COALESCE(activity.decision_at,activity.created_at) DESC,activity.id DESC
        LIMIT $3`,
      [input.workspaceId, caseIds, input.limit ?? 100],
    );
    rows.push(...portal.rows.map((row) => ({
      id: `portal:${row.id}`,
      kind: "portal" as const,
      channel: "portal" as const,
      direction: "inbound" as const,
      status: "delivered" as const,
      providerStatus: "recorded",
      title: `Client ${row.action.replaceAll("_", " ")}`,
      detail: row.note,
      occurredAt: row.occurredAt,
      actorId: null,
      actorName: row.decisionBy,
      failureCode: null,
      sourceType: "portal_decision" as const,
      sourceId: row.id,
    })));
  }

  return rows
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime() || right.id.localeCompare(left.id))
    .slice(0, input.limit ?? 100)
    .map(rowToEvent);
}

export const clientTimelineStatus = normalizedMessageStatus;
