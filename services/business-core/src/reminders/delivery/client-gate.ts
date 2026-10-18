import { CLIENT_REMINDER_PRIORITY } from "../reminders-contract";
import { localDate, type Db } from "../engine/engine";

/**
 * The one-a-day client gate (plan §6.24a, check 7): at most one reminder per client (party) per local day, across
 * the engine, the automatic client follow-ups (`sendClientEvent`) and the module chasers (`tellClients` with a gate).
 * The first claim of a day wins; claiming again with the same key is the same send (idempotent). Within one sweep
 * the engine claims in priority order (payment, then decision, then other), so a payment beats a decision due the
 * same moment. Transactional notices (a quote issued, a receipt) never claim.
 */
export type GateClaim = {
  partyId: string;
  /** CLIENT_REMINDER_PRIORITY: payment 1, decision 2, other 3. */
  priority: number;
  /** A stable key for this send (`rem:{stepId}` for the engine, `{event}:{record}` for a module). */
  key: string;
  /** The client's local day; defaults to the workspace's day for `at`. */
  localDate?: string;
  at?: Date;
  timeZone?: string;
};

export type GateResult = { allowed: true; replay: boolean } | { allowed: false; heldBy: { key: string; priority: number } };

export const GATE_PRIORITY = CLIENT_REMINDER_PRIORITY;

async function workspaceZone(db: Db, workspaceId: string) {
  return (await db.query<{ zone: string | null }>(`SELECT nullif(default_timezone, '') AS zone FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.zone ?? "UTC";
}

export async function clientDailyGate(db: Db, workspaceId: string, claim: GateClaim): Promise<GateResult> {
  const day = claim.localDate ?? localDate(claim.at ?? new Date(), claim.timeZone ?? await workspaceZone(db, workspaceId));
  const priority = Math.min(3, Math.max(1, Math.trunc(claim.priority) || 3));
  const inserted = await db.query(
    `INSERT INTO reminder_client_days (workspace_id, party_id, local_date, priority, gate_key) VALUES ($1, $2, $3::date, $4, $5)
     ON CONFLICT (workspace_id, party_id, local_date) DO NOTHING`,
    [workspaceId, claim.partyId, day, priority, claim.key.slice(0, 200)]);
  if (inserted.rowCount) return { allowed: true, replay: false };
  const held = (await db.query<{ key: string; priority: number }>(
    `SELECT gate_key AS key, priority FROM reminder_client_days WHERE workspace_id = $1 AND party_id = $2 AND local_date = $3::date`,
    [workspaceId, claim.partyId, day])).rows[0];
  if (held && held.key === claim.key.slice(0, 200)) return { allowed: true, replay: true };
  return { allowed: false, heldBy: held ? { key: held.key, priority: Number(held.priority) } : { key: "", priority: 0 } };
}

/** Gives the day back when the claimed send didn't go (nothing reached the client), so another reminder may. */
export async function releaseClientDay(db: Db, workspaceId: string, partyId: string, key: string, day: string) {
  await db.query(`DELETE FROM reminder_client_days WHERE workspace_id = $1 AND party_id = $2 AND local_date = $3::date AND gate_key = $4`,
    [workspaceId, partyId, day, key.slice(0, 200)]);
}
