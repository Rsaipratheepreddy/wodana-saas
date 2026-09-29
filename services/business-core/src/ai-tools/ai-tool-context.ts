import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { workspaceClock } from "../crm/leads/sales-attention";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import type { AiToolContext, RecordRef } from "./ai-tool";

export const AI_USE = "ai.suggestions.use";

/** Who is asking, in which workspace: their membership, the permissions the catalogue checks, and the workspace clock. */
export type Asker = { userId: string; membershipId: string; permissions: Set<string>; timeZone: string; locale: string };

/** Read in the person's own tenant transaction; someone without Woddy (ai.suggestions.use) is refused here. */
export async function readAsker(access: WorkspaceAccessService, client: PoolClient, workspaceId: string, userId: string, codes: string[]): Promise<Asker> {
  const membership = await client.query<{ id: string }>(
    `SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, userId]);
  if (!membership.rows[0]) throw new NotFoundException("Workspace not found");
  const permissions = await access.grantedPermissions(client, workspaceId, userId, [...codes, AI_USE]);
  if (!permissions.has(AI_USE)) throw new ForbiddenException(`Permissions required: ${AI_USE}`);
  const clock = await workspaceClock(client, workspaceId);
  return { userId, membershipId: membership.rows[0].id, permissions, timeZone: clock.timeZone, locale: clock.locale };
}

/** A tool context for one run; `cite` numbers the records read, in order, as S1, S2… */
export function toolContext(input: {
  actor: RequestActor; workspaceId: string; runId: string; asker: Asker; now?: Date;
  record?: { type: string; id: string } | null; selection?: { type: string; ids: string[] } | null;
}): { context: AiToolContext; sources: Array<RecordRef & { key: string }> } {
  const sources: Array<RecordRef & { key: string }> = [];
  const context: AiToolContext = {
    actor: input.actor, workspaceId: input.workspaceId, userId: input.asker.userId, membershipId: input.asker.membershipId, runId: input.runId,
    timeZone: input.asker.timeZone, locale: input.asker.locale, now: input.now ?? new Date(), permissions: input.asker.permissions,
    record: input.record ?? null, selection: input.selection ?? null,
    cite(record) {
      const existing = sources.find((source) => source.type === record.type && source.id === record.id);
      if (existing) return existing.key;
      const key = `S${sources.length + 1}`;
      sources.push({ ...record, key });
      return key;
    },
  };
  return { context, sources };
}
