import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { compareCredits, fromUnits, lowBalanceThreshold, toUnits } from "./ai-credits.domain";
import { creditLimits, ensureCreditAccount, LEDGER_COLUMNS, type LedgerRow } from "./ai-credits";

type Db = Pick<PoolClient, "query">;
export type CreditState = "ok" | "low" | "exhausted";
export type CreditOverview = Awaited<ReturnType<typeof readCreditOverview>>;

/**
 * One workspace's credits: balance and where it stands against the low-balance line, this month's use
 * (UTC month) by feature, today's use against the daily cap, the last top-up and the newest ledger entries.
 * `withOperatorNames` shows who recorded each top-up (the internal portal); the workspace sees its own members only.
 */
export async function readCreditOverview(db: Db, workspaceId: string, options: { withOperatorNames?: boolean; ledgerLimit?: number } = {}) {
  const limits = creditLimits();
  await ensureCreditAccount(db, workspaceId, limits.welcome);
  const account = (await db.query<{ balance: string; lowBalanceThreshold: string | null; lastTopUpCredits: string | null; lastTopUpBalance: string | null; lastTopUpAt: Date | null; version: number }>(
    `SELECT balance::text AS balance, low_balance_threshold::text AS "lowBalanceThreshold", last_top_up_credits::text AS "lastTopUpCredits",
            last_top_up_balance::text AS "lastTopUpBalance", last_top_up_at AS "lastTopUpAt", version
       FROM ai_credit_accounts WHERE workspace_id = $1`, [workspaceId])).rows[0];
  const usage = await db.query<{ feature: string; credits: string; calls: number }>(
    `SELECT feature, (-sum(credits))::numeric(14, 4)::text AS credits, count(*)::int AS calls FROM ai_credit_ledger
      WHERE workspace_id = $1 AND entry_type = 'usage' AND created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
      GROUP BY feature ORDER BY sum(credits), feature`, [workspaceId]);
  const today = await db.query<{ credits: string }>(
    `SELECT COALESCE(-sum(credits), 0)::numeric(14, 4)::text AS credits FROM ai_credit_ledger
      WHERE workspace_id = $1 AND entry_type = 'usage' AND created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`, [workspaceId]);
  const ledger = await db.query<LedgerRow>(
    `SELECT ${LEDGER_COLUMNS}, CASE WHEN $3 OR entry.entry_type = 'usage' THEN app_user.display_name END AS "createdByName"
       FROM ai_credit_ledger entry LEFT JOIN users app_user ON app_user.id = entry.created_by
      WHERE entry.workspace_id = $1 ORDER BY entry.created_at DESC, entry.id DESC LIMIT $2`,
    [workspaceId, options.ledgerLimit ?? 500, Boolean(options.withOperatorNames)]);
  const threshold = lowBalanceThreshold(account);
  const usedThisMonth = fromUnits(usage.rows.reduce((sum, row) => sum + toUnits(row.credits), 0n));
  const state: CreditState = compareCredits(account.balance, "0") <= 0 ? "exhausted" : compareCredits(account.balance, threshold) <= 0 ? "low" : "ok";
  return {
    workspaceId,
    balance: account.balance,
    state,
    threshold,
    customThreshold: account.lowBalanceThreshold,
    version: account.version,
    lastTopUp: account.lastTopUpAt ? { credits: account.lastTopUpCredits, at: account.lastTopUpAt } : null,
    usedThisMonth,
    byFeature: usage.rows,
    usedToday: today.rows[0]?.credits ?? "0.0000",
    dailyLimit: limits.workspaceDaily,
    ledger: ledger.rows,
  };
}

/** Settings → AI credits: owners and administrators (workspace.settings.manage) see the balance, use and ledger. */
@Injectable()
export class AiCreditsService {
  constructor(private readonly access: WorkspaceAccessService) {}

  overview(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "workspace.settings.manage", (client) => readCreditOverview(client, workspaceId));
  }
}
