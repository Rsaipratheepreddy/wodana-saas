import { HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { PoolClient } from "pg";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import {
  creditNoticeFor, fromUnits, isCreditAmount, lowBalanceThreshold, normalizeCredits, toUnits, usageCredits, wholeCredits,
  type CreditNotice, type ModelRate,
} from "./ai-credits.domain";
import type { AiUsage } from "./ai-provider";

type Db = Pick<PoolClient, "query">;
type Env = Record<string, string | undefined>;

const logger = new Logger("AiCredits");

export type CreditEntryType = "grant" | "top_up" | "usage" | "adjustment" | "refund";
export type CreditLimits = { welcome: string; workspaceDaily: string; platformDaily: string };

const credits = (value: string | undefined, fallback: string) => {
  const trimmed = value?.trim() ?? "";
  return isCreditAmount(trimmed) && !trimmed.startsWith("-") ? normalizeCredits(trimmed) : normalizeCredits(fallback);
};

/**
 * Platform settings: the welcome grant a workspace gets on first use, and two daily safety caps (UTC days)
 * on usage: one per workspace (a runaway loop or script) and one across every workspace.
 */
export function creditLimits(env: Env = process.env): CreditLimits {
  return {
    welcome: credits(env.AI_WELCOME_CREDITS, "1000"),
    workspaceDaily: credits(env.AI_WORKSPACE_DAILY_CREDIT_LIMIT, "1000"),
    platformDaily: credits(env.AI_PLATFORM_DAILY_CREDIT_LIMIT, "5000"),
  };
}

export const CREDITS_EXHAUSTED_MESSAGE = "AI credits are used up. Ask your admin to top up.";

/** A call refused before it reaches the model, with the code the web turns into a calm next step. */
export class AiCreditRefusal extends HttpException {
  constructor(readonly reason: CreditRefusal) {
    super(reason === "exhausted"
      ? { message: CREDITS_EXHAUSTED_MESSAGE, code: "AI_CREDITS_EXHAUSTED" }
      : reason === "workspace_daily"
        ? { message: "Today's AI limit for this workspace is reached. Try again tomorrow.", code: "AI_WORKSPACE_DAILY_LIMIT" }
        : { message: "AI is paused for today. Try again tomorrow.", code: "AI_PLATFORM_DAILY_LIMIT" },
    reason === "exhausted" ? HttpStatus.PAYMENT_REQUIRED : HttpStatus.TOO_MANY_REQUESTS);
  }
}
export type CreditRefusal = "exhausted" | "workspace_daily" | "platform_daily";

type AccountRow = {
  balance: string; lowBalanceThreshold: string | null; lastTopUpCredits: string | null; lastTopUpBalance: string | null;
  lastTopUpAt: Date | null; lowNotifiedAt: Date | null; exhaustedNotifiedAt: Date | null; version: number;
};
const ACCOUNT_COLUMNS = `balance::text AS balance, low_balance_threshold::text AS "lowBalanceThreshold", last_top_up_credits::text AS "lastTopUpCredits",
  last_top_up_balance::text AS "lastTopUpBalance", last_top_up_at AS "lastTopUpAt", low_balance_notified_at AS "lowNotifiedAt",
  exhausted_notified_at AS "exhaustedNotifiedAt", version`;

export type LedgerRow = {
  id: string; entryType: CreditEntryType; credits: string; balanceAfter: string; model: string | null; feature: string | null;
  inputTokens: number | null; outputTokens: number | null; reference: string | null; note: string | null; createdBy: string | null;
  createdByName?: string | null; createdAt: Date;
};
export const LEDGER_COLUMNS = `entry.id, entry.entry_type AS "entryType", entry.credits::text AS credits, entry.balance_after::text AS "balanceAfter",
  entry.model, entry.feature, entry.input_tokens AS "inputTokens", entry.output_tokens AS "outputTokens", entry.reference, entry.note,
  entry.created_by AS "createdBy", entry.created_at AS "createdAt"`;

/**
 * The workspace's credit account, created on first use with the platform's welcome grant (existing
 * workspaces get it the first time too). Idempotent: concurrent first calls create one account.
 */
export async function ensureCreditAccount(db: Db, workspaceId: string, welcome = creditLimits().welcome) {
  const created = await db.query<{ balance: string }>(
    `INSERT INTO ai_credit_accounts (workspace_id, balance, last_top_up_credits, last_top_up_balance, last_top_up_at)
     VALUES ($1, $2::numeric, $2::numeric, $2::numeric, now())
     ON CONFLICT (workspace_id) DO NOTHING RETURNING balance::text AS balance`, [workspaceId, welcome]);
  if (created.rowCount && toUnits(welcome) > 0n) {
    await db.query(
      `INSERT INTO ai_credit_ledger (workspace_id, entry_type, credits, balance_after, note, idempotency_key)
       VALUES ($1, 'grant', $2::numeric, $2::numeric, 'Welcome credits', 'welcome-grant')
       ON CONFLICT (workspace_id, idempotency_key) DO NOTHING`, [workspaceId, welcome]);
  }
}

async function lockAccount(db: Db, workspaceId: string) {
  const row = await db.query<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM ai_credit_accounts WHERE workspace_id = $1 FOR UPDATE`, [workspaceId]);
  return row.rows[0];
}

let platformCapLoggedFor = "";

/**
 * Whether the workspace may start another AI call: a positive balance, today's use under the workspace's
 * daily cap, and today's use across every workspace under the platform cap. When the balance is out and
 * the owners were not told yet, they are told now (inside the caller's transaction).
 */
export async function checkCredits(db: Db, workspaceId: string, limits: CreditLimits = creditLimits()): Promise<CreditRefusal | null> {
  await ensureCreditAccount(db, workspaceId, limits.welcome);
  const account = await lockAccount(db, workspaceId);
  if (toUnits(account.balance) <= 0n) {
    if (!account.exhaustedNotifiedAt) await settleNotices(db, workspaceId, account, account.balance, `refusal:${account.version}`);
    return "exhausted";
  }
  const today = await db.query<{ reached: boolean }>(
    `SELECT COALESCE(-sum(credits), 0) >= $2::numeric AS reached FROM ai_credit_ledger
      WHERE workspace_id = $1 AND entry_type = 'usage' AND created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,
    [workspaceId, limits.workspaceDaily]);
  if (today.rows[0]?.reached) return "workspace_daily";
  const platform = await db.query<{ used: string; reached: boolean }>(
    `SELECT used::text AS used, used >= $1::numeric AS reached FROM ai_platform_usage_today() AS used`, [limits.platformDaily]);
  if (platform.rows[0]?.reached) {
    const day = new Date().toISOString().slice(0, 10);
    if (platformCapLoggedFor !== day) {
      platformCapLoggedFor = day;
      logger.warn(`AI platform daily credit limit reached: ${platform.rows[0].used} of ${limits.platformDaily} credits used today (UTC). New AI calls are refused until tomorrow.`);
    }
    return "platform_daily";
  }
  return null;
}

/** The model's rate, or the most expensive active rate when the model has none (never undercharge). */
export async function modelRate(db: Db, model: string): Promise<(ModelRate & { model: string; fallback: boolean }) | null> {
  const rows = await db.query<{ model: string; inputPerMillion: string; outputPerMillion: string; exact: boolean }>(
    `SELECT model, input_credits_per_million::text AS "inputPerMillion", output_credits_per_million::text AS "outputPerMillion", model = $1 AS exact
       FROM ai_model_rates WHERE active ORDER BY model = $1 DESC, output_credits_per_million DESC, input_credits_per_million DESC LIMIT 1`, [model]);
  const row = rows.rows[0];
  if (!row) return null;
  return { model: row.model, inputPerMillion: row.inputPerMillion, outputPerMillion: row.outputPerMillion, fallback: !row.exact };
}

export type CreditEntryInput = {
  workspaceId: string;
  entryType: CreditEntryType;
  /** Signed: positive adds credits, negative takes them. */
  credits: string;
  idempotencyKey: string;
  createdBy?: string | null;
  model?: string | null;
  feature?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reference?: string | null;
  note?: string | null;
};

/**
 * Writes one ledger entry and moves the balance with it, in the caller's tenant transaction (the account
 * row is locked first, so a replayed key returns the entry it made). Grants and top-ups set the level the
 * default low-balance line is measured from; crossings tell owners and administrators once.
 */
export async function applyCreditEntry(db: Db, input: CreditEntryInput): Promise<{ entry: LedgerRow; replay: boolean }> {
  await ensureCreditAccount(db, input.workspaceId);
  await lockAccount(db, input.workspaceId);
  const existing = await db.query<LedgerRow>(`SELECT ${LEDGER_COLUMNS} FROM ai_credit_ledger entry WHERE entry.workspace_id = $1 AND entry.idempotency_key = $2`,
    [input.workspaceId, input.idempotencyKey]);
  if (existing.rowCount) return { entry: existing.rows[0], replay: true };
  const amount = normalizeCredits(input.credits);
  const topUp = input.entryType === "grant" || input.entryType === "top_up";
  const updated = await db.query<AccountRow>(
    `UPDATE ai_credit_accounts SET balance = balance + $2::numeric, version = version + 1, updated_at = now(),
            last_top_up_credits = CASE WHEN $3 THEN $2::numeric ELSE last_top_up_credits END,
            last_top_up_balance = CASE WHEN $3 THEN balance + $2::numeric ELSE last_top_up_balance END,
            last_top_up_at = CASE WHEN $3 THEN now() ELSE last_top_up_at END
      WHERE workspace_id = $1 RETURNING ${ACCOUNT_COLUMNS}`, [input.workspaceId, amount, topUp]);
  const after = updated.rows[0];
  const inserted = await db.query<LedgerRow>(
    `INSERT INTO ai_credit_ledger AS entry (workspace_id, entry_type, credits, balance_after, model, feature, input_tokens, output_tokens,
       reference, note, idempotency_key, created_by)
     VALUES ($1, $2, $3::numeric, $4::numeric, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING ${LEDGER_COLUMNS}`,
    [input.workspaceId, input.entryType, amount, after.balance, input.model ?? null, input.feature ?? null, input.inputTokens ?? null,
      input.outputTokens ?? null, input.reference ?? null, input.note ?? null, input.idempotencyKey, input.createdBy ?? null]);
  const entry = inserted.rows[0];
  await settleNotices(db, input.workspaceId, after, after.balance, entry.id);
  return { entry, replay: false };
}

/**
 * Debits one successful model call: its tokens × the model's rate. The balance may go slightly negative on
 * the call that uses the last credits; the next call is refused.
 */
export async function chargeUsage(db: Db, input: { workspaceId: string; callId: string; model: string; feature: string; usage: AiUsage; userId: string | null }) {
  const rate = await modelRate(db, input.model);
  if (!rate) { logger.error(`No active AI model rate; the call ${input.callId} was not charged.`); return null; }
  if (rate.fallback) logger.warn(`No active rate for ${input.model}; charged at ${rate.model}'s rate. Add the model's rate in the internal portal.`);
  const cost = usageCredits(input.usage, rate);
  return applyCreditEntry(db, {
    workspaceId: input.workspaceId, entryType: "usage", credits: fromUnits(-toUnits(cost)), idempotencyKey: `usage:${input.callId}`,
    createdBy: input.userId, model: input.model, feature: input.feature, inputTokens: input.usage.input_tokens, outputTokens: input.usage.output_tokens,
    reference: input.callId,
  });
}

/** Re-arms or sends the low and exhausted notices for the account's new balance. */
async function settleNotices(db: Db, workspaceId: string, account: AccountRow, balance: string, sourceId: string) {
  const threshold = lowBalanceThreshold(account);
  const next = creditNoticeFor(balance, threshold, { lowNotified: Boolean(account.lowNotifiedAt), exhaustedNotified: Boolean(account.exhaustedNotifiedAt) });
  await db.query(
    `UPDATE ai_credit_accounts
        SET low_balance_notified_at = CASE WHEN $2 THEN COALESCE(low_balance_notified_at, now()) ELSE NULL END,
            exhausted_notified_at = CASE WHEN $3 THEN COALESCE(exhausted_notified_at, now()) ELSE NULL END
      WHERE workspace_id = $1`, [workspaceId, next.lowNotified, next.exhaustedNotified]);
  if (next.notice) await notifyAdmins(db, workspaceId, next.notice, balance, sourceId);
}

const NOTICE_CODE: Record<CreditNotice, string> = { low: "ai.credits_low", exhausted: "ai.credits_exhausted" };
export const AI_CREDITS_PAGE = "/workspace/settings/ai-credits";

/** Owners and administrators hear it in the app and by email (in the workspace's brand). */
async function notifyAdmins(db: Db, workspaceId: string, notice: CreditNotice, balance: string, sourceId: string) {
  const recipients = await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId"
       FROM workspace_memberships membership
       JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
       JOIN roles role ON role.id = assigned.role_id AND role.code IN ('owner', 'administrator')
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId]);
  const code = NOTICE_CODE[notice];
  const variables = { balance: wholeCredits(balance) };
  for (const { userId } of recipients.rows) {
    const base = `${code}:${sourceId}:${userId}`;
    await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink: AI_CREDITS_PAGE, idempotencyKey: base });
    await queueUserEmail(db, { workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink: AI_CREDITS_PAGE, idempotencyKey: `${base}:email` });
  }
}
