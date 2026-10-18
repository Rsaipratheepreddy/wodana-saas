import type { PoolClient } from "pg";
import { EMAIL_MAX_ATTEMPTS, nextEmailRetry, tooOldToRetry } from "../email/email-retry";
import type { EmailDeliveryResult } from "../email/transactional-email.service";

/**
 * What the platform mailer's dispatchers (staff and client-portal emails, email conversation replies) do with one
 * claimed email after trying it. A throttled or transiently failed send stays scheduled for a retry (an attempt
 * `retry` with its code and time); only a refusal, or a retryable failure that ran out of attempts or age, fails.
 * A send the local limit couldn't fit before the dispatch deadline goes back to the queue without counting.
 */
export type EmailDisposition =
  | { kind: "delivered" }
  | { kind: "suppressed"; reason: string }
  | { kind: "deferred"; until: Date }
  | { kind: "retry"; retryAt: Date; errorCode: string }
  | { kind: "failed"; errorCode: string; gaveUp: boolean };

/** One dispatch call sends for at most this long, then puts the rest back: under the worker's 10-second call timeout. */
export const EMAIL_DISPATCH_BUDGET_MS = 8_000;

/** The claimed notice's next attempt number and when it was raised (for the retry limits). */
export type ClaimedEmail = { attempt: number; createdAt: Date };

/** Delivered, suppressed (email not set up / not allowlisted), deferred, retried later, or failed for good. */
export function emailDisposition(outcome: EmailDeliveryResult, claimed: ClaimedEmail, now = new Date(), random: () => number = Math.random): EmailDisposition {
  if (outcome.status === "sent") return { kind: "delivered" };
  if (outcome.status === "not_configured") return { kind: "suppressed", reason: outcome.suppressedReason ?? "email_not_configured" };
  if (outcome.deferred) return { kind: "deferred", until: new Date(now.getTime() + Math.max(1_000, outcome.retryAfterMs ?? 1_000)) };
  const errorCode = outcome.errorCode ?? "EMAIL_SEND_FAILED";
  if (!outcome.retryable) return { kind: "failed", errorCode, gaveUp: false };
  const retryAt = nextEmailRetry({ attempt: claimed.attempt, createdAt: claimed.createdAt, retryAfterMs: outcome.retryAfterMs, now, random });
  return retryAt ? { kind: "retry", retryAt, errorCode } : { kind: "failed", errorCode, gaveUp: true };
}

/** A retry found more than a day after the notice was raised is not sent again: it fails as expired. */
export function expiredRetry(claimed: ClaimedEmail, now = new Date()): EmailDisposition | null {
  return claimed.attempt > 1 && tooOldToRetry(claimed.createdAt, now) ? { kind: "failed", errorCode: "EMAIL_RETRY_EXPIRED", gaveUp: true } : null;
}

/** The SQL fragment of a claim that returns the next attempt number and the raised time (`notification` alias). */
export const CLAIMED_EMAIL_COLUMNS = `(SELECT COALESCE(max(attempt.attempt), 0) + 1 FROM notification_delivery_attempts attempt
    WHERE attempt.workspace_id = notification.workspace_id AND attempt.notification_id = notification.id)::int AS attempt,
  notification.created_at AS "createdAt"`;

/** Puts claimed emails back in the queue, untouched, for `until` (the dispatch ran out of time or slots). */
export async function releaseClaimedEmails(client: Pick<PoolClient, "query">, workspaceId: string, ids: readonly string[], until: Date) {
  if (!ids.length) return;
  await client.query(
    `UPDATE notifications SET status = 'scheduled', scheduled_for = GREATEST(scheduled_for, $3), processing_started_at = NULL, version = version + 1
      WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'processing'`, [workspaceId, ids, until]);
}

/**
 * Writes one tried email's outcome: the notice's status (delivered, suppressed, scheduled for its retry, failed) and,
 * for a send that reached the provider, its delivery attempt (delivered, retry with its time, permanent_failure).
 */
export async function recordEmailDisposition(client: Pick<PoolClient, "query">, input: {
  workspaceId: string; notificationId: string; disposition: EmailDisposition; provider: string | null; messageId: string | null;
  /** The send reached the provider (or failed trying): it is recorded as an attempt. */
  attempted: boolean;
  /** No address to send to (recorded on the notice as destination_missing). */
  destinationMissing?: boolean;
}) {
  const { workspaceId, notificationId, disposition } = input;
  if (disposition.kind === "deferred") return releaseClaimedEmails(client, workspaceId, [notificationId], disposition.until);
  const status = disposition.kind === "delivered" ? "delivered" : disposition.kind === "suppressed" ? "suppressed" : disposition.kind === "retry" ? "scheduled" : "failed";
  await client.query(
    `UPDATE notifications SET status = $1::notification_status, delivered_at = CASE WHEN $1 = 'delivered' THEN now() ELSE delivered_at END,
       scheduled_for = COALESCE($6::timestamptz, scheduled_for),
       suppressed_reason = CASE WHEN $1 = 'suppressed' THEN $5 WHEN $2::boolean THEN 'destination_missing' ELSE suppressed_reason END,
       processing_started_at = NULL, version = version + 1
     WHERE workspace_id = $3 AND id = $4`,
    [status, Boolean(input.destinationMissing), workspaceId, notificationId, disposition.kind === "suppressed" ? disposition.reason : null,
      disposition.kind === "retry" ? disposition.retryAt : null]);
  if (!input.attempted || disposition.kind === "suppressed") return;
  const attemptStatus = disposition.kind === "delivered" ? "delivered" : disposition.kind === "retry" ? "retry" : "permanent_failure";
  const errorCode = disposition.kind === "delivered" ? null : disposition.errorCode;
  const errorMessage = disposition.kind === "failed" && disposition.gaveUp
    ? (disposition.errorCode === "EMAIL_RETRY_EXPIRED" ? "Not retried: the notice is more than a day old" : `Gave up after ${EMAIL_MAX_ATTEMPTS} attempts or a day`) : null;
  await client.query(
    `INSERT INTO notification_delivery_attempts (workspace_id, notification_id, attempt, provider, status, provider_message_id, error_code, error_message, retry_at, completed_at)
     SELECT $1, $2, COALESCE(max(attempt), 0) + 1, $3, $4, $5, $6, $7, $8, now() FROM notification_delivery_attempts WHERE workspace_id = $1 AND notification_id = $2`,
    [workspaceId, notificationId, input.provider ?? "mailgun", attemptStatus, input.messageId, errorCode, errorMessage, disposition.kind === "retry" ? disposition.retryAt : null]);
}
