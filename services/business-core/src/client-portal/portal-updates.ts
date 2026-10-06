import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { choiceText, isFrequency, type Frequency, type Mode } from "../client-calls/client-calls.domain";
import { readClientCalls, setClientCalls } from "../client-calls/client-calls.store";
import { notifyUserInApp } from "../notifications/default-templates";
import { grantFor, type DecisionContext } from "./portal-decisions";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-046 in the portal: how the client hears how the work goes. A call with their Account Manager, a progress update
 * in the portal instead, or neither; and how often. Null while the job has no updates set up (they start from the
 * design approval, or the accepted estimate).
 */
export async function readUpdatePreference(db: Db, workspaceId: string, caseId: string): Promise<{ mode: Mode; frequency: Frequency; version: number } | null> {
  const row = await readClientCalls(db, workspaceId, caseId);
  return row ? { mode: row.mode, frequency: row.frequency, version: row.version } : null;
}

const CHOICES = ["call", "portal", "off"] as const;

/** The decision-maker changes their updates; the Account Manager hears what they chose. Version-checked; audited by the portal command. */
export async function chooseUpdates(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "progress");
  if (grant.role !== "approver") throw new ForbiddenException("Only the project's decision-maker can change this.");
  const choice = (CHOICES as readonly unknown[]).includes(body.choice) ? body.choice as (typeof CHOICES)[number] : null;
  if (!choice) throw new BadRequestException("Choose how you'd like to hear from us.");
  const frequency = choice === "off" ? "off" : body.frequency;
  if (!isFrequency(frequency) || (choice !== "off" && frequency === "off")) throw new BadRequestException("Choose how often.");
  const current = await readClientCalls(ctx.db, ctx.workspaceId, row.caseId, true);
  if (!current) throw new NotFoundException("Updates aren't set up for this project yet.");
  const mode: Mode = choice === "off" ? current.mode : choice;
  const result = await setClientCalls(ctx.db, ctx.workspaceId, row.caseId, { mode, frequency }, Number(body.version), null, "client");
  if (result.conflict) throw new ConflictException("Your project team changed this. Reload and try again.");
  const after = (await readClientCalls(ctx.db, ctx.workspaceId, row.caseId))!;
  if (result.changed && after.ownerId) {
    const owner = (await ctx.db.query<{ userId: string }>(`SELECT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`,
      [ctx.workspaceId, after.ownerId])).rows[0];
    if (owner) await notifyUserInApp(ctx.db, { workspaceId: ctx.workspaceId, recipientUserId: owner.userId, code: "client_calls.client_changed", eventType: "client_calls.client_changed",
      variables: { clientName: grant.name, choice: choiceText(after.mode, after.frequency) }, deepLink: `/workspace/pre-projects/cases/${row.caseId}/overview`,
      idempotencyKey: `client-calls:${row.caseId}:client-changed:${after.version}` });
  }
  return { ok: true, updates: { mode: after.mode, frequency: after.frequency, version: after.version }, entity: { type: "pre_project_case", id: row.caseId },
    audit: { mode: after.mode, frequency: after.frequency } };
}
