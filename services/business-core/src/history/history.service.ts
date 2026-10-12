import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { describeAction } from "./history-actions";
import { toHistoryItem, type AuditRow, type HistoryItem } from "./history-items";
import { HISTORY_RECORD_TYPES, RECORD_SPECS, type HistoryRecordType } from "./history-records";

export const HISTORY_FILTERS = ["all", "changes", "messages", "approvals"] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];
const CATEGORY: Record<Exclude<HistoryFilter, "all">, string> = { changes: "change", messages: "message", approvals: "approval" };
const PAGE = 50;

export type HistoryPage = { items: HistoryItem[]; next: string | null; timeZone: string };

/**
 * A record's history (plan E5, the go-live "who did what, when"): its audit events and those of what hangs off it,
 * newest first, 50 at a time, filtered to changes, messages or approvals. A member reads it only when they may read
 * the record: the record's module permission, and for records a role sees only when they are theirs, that scope too.
 */
@Injectable()
export class HistoryService {
  constructor(private readonly access: WorkspaceAccessService) {}

  async read(actor: RequestActor, workspaceId: string, type: string, recordId: string, query: { filter?: unknown; before?: unknown }): Promise<HistoryPage> {
    const recordType = this.type(type);
    const filter = this.filter(query.filter);
    const before = this.cursor(query.before);
    const spec = RECORD_SPECS[recordType];
    return this.access.withAnyPermission(actor, workspaceId, spec.permissions, async (client, user) => {
      const granted = await this.access.grantedPermissions(client, workspaceId, user.userId, spec.permissions);
      const facts = await spec.record(client, workspaceId, recordId, { userId: user.userId, granted });
      if (!facts) throw new NotFoundException("Record not found");
      return readHistory(client, workspaceId, recordType, recordId, facts, filter, before);
    });
  }

  private type(value: string): HistoryRecordType {
    if (!(HISTORY_RECORD_TYPES as readonly string[]).includes(value)) throw new NotFoundException("This record has no history.");
    return value as HistoryRecordType;
  }

  private filter(value: unknown): HistoryFilter {
    if (value === undefined || value === null || value === "") return "all";
    if (!(HISTORY_FILTERS as readonly string[]).includes(String(value))) throw new BadRequestException("Choose all, changes, messages or approvals.");
    return value as HistoryFilter;
  }

  /** The page cursor: the time and id of the last event already shown. */
  private cursor(value: unknown) {
    if (value === undefined || value === null || value === "") return null;
    const [at, id] = String(value).split("|");
    if (!at || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/i.test(id ?? "")) throw new BadRequestException("That page of history can't be read.");
    return { at, id };
  }
}

/** The history page itself, in the caller's tenant transaction (the record already found and allowed). */
export async function readHistory(client: Pick<PoolClient, "query">, workspaceId: string, recordType: HistoryRecordType, recordId: string,
  facts: Awaited<ReturnType<(typeof RECORD_SPECS)[HistoryRecordType]["record"]>> & object, filter: HistoryFilter, before: { at: string; id: string } | null): Promise<HistoryPage> {
  const spec = RECORD_SPECS[recordType];
  const rows = (await client.query<AuditRow>(
    `SELECT e.id, e.action, e.entity_type AS "entityType", e.entity_id AS "entityId", e.source, e.occurred_at AS "occurredAt", e.before, e.after,
            e.actor_user_id AS "actorId", actor.display_name AS "actorName", profile.avatar_preset AS "actorPreset",
            (SELECT array_agg(DISTINCT role.code ORDER BY role.code) FROM workspace_memberships membership
               JOIN effective_member_roles assigned ON assigned.membership_id = membership.id JOIN roles role ON role.id = assigned.role_id
              WHERE membership.workspace_id = e.workspace_id AND membership.user_id = e.actor_user_id) AS "actorRoles"
       FROM audit_events e
       LEFT JOIN users actor ON actor.id = e.actor_user_id
       LEFT JOIN workspace_member_profiles profile ON profile.workspace_id = e.workspace_id AND profile.user_id = e.actor_user_id
      WHERE e.workspace_id = $1 AND ${spec.where}
        AND ($3::timestamptz IS NULL OR (e.occurred_at, e.id) < ($3::timestamptz, $4::uuid))
      ORDER BY e.occurred_at DESC, e.id DESC
      LIMIT ${filter === "all" ? PAGE + 1 : 500}`,
    [workspaceId, recordId, before?.at ?? null, before?.id ?? null])).rows;
  // The filter is the action's meaning, decided here (the same rule the web reads), so it is applied after the read.
  const matching = filter === "all" ? rows : rows.filter((row) => describeAction(row.action).category === CATEGORY[filter]);
  const page = matching.slice(0, PAGE);
  const last = page.at(-1);
  const more = matching.length > PAGE || (filter !== "all" && rows.length === 500);
  const zone = (await client.query<{ zone: string | null }>(`SELECT default_timezone AS zone FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.zone;
  return {
    items: page.map((row) => toHistoryItem({ ...row, occurredAt: new Date(row.occurredAt).toISOString() }, recordType, recordId, facts, spec.own)),
    next: more && last ? `${new Date(last.occurredAt).toISOString()}|${last.id}` : null,
    timeZone: zone || "UTC",
  };
}
