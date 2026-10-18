import { notifyUserInApp } from "../../notifications/default-templates";
import { BOOKS_PERMISSIONS, type BooksSourceType, type PostingIssueCode } from "../books-contract";
import type { Db, PendingEvent } from "../ledger/ledger";

/**
 * Posting issues: one row per source event that could not post yet (books_posting_issues). Every failed attempt
 * counts; posting it later (or finding it before the start date) resolves it. People who manage the Ledger hear once
 * when an issue is new (again only if it reopens or its reason changes).
 */

export const NOTICE_CODE = "books.posting_blocked";
const ATTENTION_LINK = "/workspace/ledger/attention";

export type PostingIssueRow = {
  id: string;
  legalEntityId: string | null;
  companyName: string | null;
  sourceType: BooksSourceType;
  sourceId: string;
  sourceEvent: string;
  sourceLabel: string;
  sourceHref: string;
  eventDate: string | null;
  code: PostingIssueCode;
  detail: string;
  attempts: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

/** Records (or counts again) why an event couldn't post, and tells the Ledger's managers when it's new. */
export async function recordIssue(db: Db, workspaceId: string, event: PendingEvent, code: PostingIssueCode, detail: string) {
  const row = (await db.query<{ id: string; notify: boolean }>(
    `INSERT INTO books_posting_issues (workspace_id, legal_entity_id, source_type, source_id, source_event, source_label, source_href, event_date, code, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT ON CONSTRAINT books_posting_issues_source_key DO UPDATE SET
       legal_entity_id = excluded.legal_entity_id, source_label = excluded.source_label, source_href = excluded.source_href, event_date = excluded.event_date,
       attempts = CASE WHEN books_posting_issues.resolved_at IS NULL THEN books_posting_issues.attempts + 1 ELSE 1 END,
       first_seen_at = CASE WHEN books_posting_issues.resolved_at IS NULL THEN books_posting_issues.first_seen_at ELSE now() END,
       notified_at = CASE WHEN books_posting_issues.resolved_at IS NULL AND books_posting_issues.code = excluded.code THEN books_posting_issues.notified_at END,
       code = excluded.code, detail = excluded.detail, last_seen_at = now(), resolved_at = NULL
     RETURNING id, notified_at IS NULL AS notify`,
    [workspaceId, event.legalEntityId, event.sourceType, event.sourceId, event.sourceEvent, (event.label ?? "").slice(0, 240),
      event.href?.startsWith("/") ? event.href.slice(0, 500) : "", event.eventDate ?? null, code, detail.slice(0, 1000)])).rows[0];
  if (row.notify) await tellManagers(db, workspaceId, row.id, event.label || event.sourceType, detail);
  return row.id;
}

/** The event posted (or never will: it falls before the start date): its open issue is resolved. */
export async function resolveIssue(db: Db, workspaceId: string, event: Pick<PendingEvent, "sourceType" | "sourceId" | "sourceEvent">) {
  await db.query(
    `UPDATE books_posting_issues SET resolved_at = now() WHERE workspace_id = $1 AND source_type = $2 AND source_id = $3 AND source_event = $4 AND resolved_at IS NULL`,
    [workspaceId, event.sourceType, event.sourceId, event.sourceEvent]);
}

/** Open issues, oldest first. */
export async function listIssues(db: Db, workspaceId: string): Promise<PostingIssueRow[]> {
  return (await db.query<PostingIssueRow>(
    `SELECT issue.id, issue.legal_entity_id AS "legalEntityId", entity.display_name AS "companyName", issue.source_type AS "sourceType", issue.source_id AS "sourceId",
            issue.source_event AS "sourceEvent", issue.source_label AS "sourceLabel", issue.source_href AS "sourceHref", issue.event_date::text AS "eventDate",
            issue.code, issue.detail, issue.attempts, issue.first_seen_at AS "firstSeenAt", issue.last_seen_at AS "lastSeenAt"
       FROM books_posting_issues issue
       LEFT JOIN legal_entities entity ON entity.workspace_id = issue.workspace_id AND entity.id = issue.legal_entity_id
      WHERE issue.workspace_id = $1 AND issue.resolved_at IS NULL
      ORDER BY issue.event_date NULLS LAST, issue.first_seen_at, issue.id LIMIT 1000`, [workspaceId])).rows;
}

/** An open issue is tried at the next sweep instead of waiting for its retry time. */
export async function retryIssue(db: Db, workspaceId: string, issueId: string) {
  return Boolean((await db.query(
    `UPDATE books_posting_issues SET last_seen_at = now() - interval '1 day' WHERE workspace_id = $1 AND id = $2 AND resolved_at IS NULL`,
    [workspaceId, issueId])).rowCount);
}

/** Everyone who manages the Ledger hears once, in the app. */
async function tellManagers(db: Db, workspaceId: string, issueId: string, source: string, note: string) {
  const people = (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = $2
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId, BOOKS_PERMISSIONS.manage])).rows.map((row) => row.userId);
  const opened = (await db.query<{ key: string }>(
    `SELECT code || ':' || (extract(epoch FROM first_seen_at) * 1000)::bigint::text AS key FROM books_posting_issues WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, issueId])).rows[0]?.key ?? "";
  for (const userId of people) {
    await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: NOTICE_CODE, eventType: NOTICE_CODE,
      variables: { source: source.slice(0, 200), note: note.slice(0, 480) }, deepLink: ATTENTION_LINK,
      idempotencyKey: `${NOTICE_CODE}:${issueId}:${opened}:${userId}` });
  }
  await db.query(`UPDATE books_posting_issues SET notified_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, issueId]);
}
