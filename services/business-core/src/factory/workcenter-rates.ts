import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { rateOn, readWorkcenterRates } from "../project-core/labour-rates";
import { currencyDecimals } from "../purchasing/orders";

type Db = Pick<PoolClient, "query">;

/** The workspace's currency and today in its time zone: what a rate is kept in, and the day it applies from unless said. */
export async function workspaceDay(db: Db, workspaceId: string) {
  return (await db.query<{ currency: string; today: string }>(
    `SELECT default_currency AS currency, (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
}

/**
 * A workcenter's hourly rate from a date (today unless said). The rate already in force that day changes
 * nothing; a new date adds to its history, so the days before keep their rate; the same date again
 * corrects that rate (checked against its version, 0 when there's none).
 */
export async function setWorkcenterRate(db: Db, workspaceId: string, workcenterId: string, input: { rate: string; from: string | null; version: unknown }, userId: string) {
  const workspace = await workspaceDay(db, workspaceId);
  if (Dec.of(input.rate).round(currencyDecimals(workspace.currency)).cmp(input.rate) !== 0) throw new BadRequestException(`The hourly rate has more decimals than ${workspace.currency} uses.`);
  const from = input.from ?? workspace.today;
  const inForce = rateOn(await readWorkcenterRates(db, workspaceId), workcenterId, from);
  if (inForce && inForce.currency === workspace.currency && Dec.of(inForce.rate).cmp(input.rate) === 0) return null;
  const current = (await db.query<{ id: string; version: number }>(
    `SELECT id, version FROM workcenter_rates WHERE workspace_id = $1 AND workcenter_id = $2 AND effective_from = $3 FOR UPDATE`, [workspaceId, workcenterId, from])).rows[0];
  if ((current?.version ?? 0) !== (input.version ?? 0)) throw new ConflictException("Someone else changed this workcenter's rate. Reload to see their change.");
  if (current)
    await db.query(`UPDATE workcenter_rates SET hourly_rate = $3, currency = $4, updated_by = $5, updated_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, current.id, input.rate, workspace.currency, userId]);
  else
    await db.query(`INSERT INTO workcenter_rates (id, workspace_id, workcenter_id, effective_from, hourly_rate, currency, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), workspaceId, workcenterId, from, input.rate, workspace.currency, userId]);
  return { from, rate: input.rate, before: inForce?.rate ?? null };
}
