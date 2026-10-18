import type { PoolClient } from "pg";
import type { ApprovalKind } from "./approval-sources";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The phone's notification categories: which buttons a push shows (the app registers both). */
export type PushCategory = "approval" | "approval_send";

/**
 * Approval notices a phone can approve from the lock screen (X-2): kinds whose row approves without a note, sent
 * with a link that names the record. "approval_send" is a daily report, whose approval also sends it to the client.
 * Approving still goes through `approvals/decide` as the person, which checks the row and their right again, and that
 * its version is still the one the push named; anything it refuses (a note needed, decided elsewhere, changed since)
 * opens the app instead.
 */
const LOCK_SCREEN: Record<string, { kind: ApprovalKind; param: string; category: PushCategory }> = {
  "purchasing.approval_needed": { kind: "order", param: "order", category: "approval" },
  "payables.run_submitted": { kind: "payment_run", param: "run", category: "approval" },
  "petty_cash.submitted": { kind: "petty_cash", param: "claim", category: "approval" },
  "quotation.review_requested": { kind: "quote_review", param: "quote", category: "approval" },
  "site.report_waiting": { kind: "site_report", param: "report", category: "approval_send" },
};

/** The kinds that can be approved from a push (none needs a note to approve). */
export const LOCK_SCREEN_KINDS: ReadonlySet<ApprovalKind> = new Set(Object.values(LOCK_SCREEN).map((entry) => entry.kind));

/**
 * The version "Waiting for you" shows for a row (the one `approvals/decide` compares), read when the push goes out:
 * a lock-screen Approve names it, so a record changed after the notice opens instead of being approved unseen.
 */
const VERSION_SQL: Partial<Record<ApprovalKind, string>> = {
  order: `SELECT version FROM purchase_orders WHERE workspace_id = $1 AND id = $2`,
  payment_run: `SELECT version FROM payment_runs WHERE workspace_id = $1 AND id = $2`,
  petty_cash: `SELECT version FROM petty_cash_claims WHERE workspace_id = $1 AND id = $2`,
  site_report: `SELECT version FROM site_reports WHERE workspace_id = $1 AND id = $2`,
  quote_review: `SELECT commercial.revision AS version FROM commercial_quotes quote
                   JOIN commercial_cases commercial ON commercial.workspace_id = quote.workspace_id AND commercial.case_id = quote.case_id
                  WHERE quote.workspace_id = $1 AND quote.id = $2`,
};

export async function approvalVersion(db: Pick<PoolClient, "query">, workspaceId: string, kind: ApprovalKind, id: string): Promise<number | null> {
  const sql = VERSION_SQL[kind];
  if (!sql) return null;
  const version = (await db.query<{ version: number | string | null }>(sql, [workspaceId, id])).rows[0]?.version;
  return version === null || version === undefined || !Number.isInteger(Number(version)) ? null : Number(version);
}

/** What a push for this notice carries so the phone can offer Approve: its category and the row to decide, or nothing. */
export function approvalPush(eventType: string, deepLink: string | null | undefined): { pushCategory: PushCategory; approval: { kind: ApprovalKind; id: string } } | null {
  const entry = LOCK_SCREEN[eventType];
  if (!entry || !deepLink) return null;
  let url: URL;
  try { url = new URL(deepLink, "https://app.invalid"); } catch { return null; }
  const id = url.searchParams.get(entry.param);
  return id && UUID.test(id) ? { pushCategory: entry.category, approval: { kind: entry.kind, id } } : null;
}
