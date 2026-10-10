import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabaseService } from "../database/database.service";
import { OpsError } from "./ops-context";

/**
 * Moves a sandbox's test members to new sign-in addresses (`sandbox --email-pattern`, ops-sandbox.ts), e.g. from
 * sales@igolo.test to wodanatechnology+sales@gmail.com, so the emails they are sent reach a real inbox.
 *
 * Wodana has no address change a person can make: an address is how a person signs in and is told things. This is the
 * one path, and it is narrow: only the operator CLI's sandbox command calls it, only for the sandbox's own test members
 * (people who belong to no organization and no customer account but the sandbox's, and who are not Wodana operators;
 * anyone else refuses the whole change), and only to an address nobody else signs in with.
 *
 * In one transaction, so a run that stops part-way changes nothing:
 *  - the person's address (users.primary_email, which sign-in, the member directory and every email read) and their local
 *    sign-in identity's copy of it. The person stays who they are: user id, password, sessions, memberships, roles and
 *    teams are untouched. Sign-in by the new address finds them; by the old one, nobody.
 *  - a pending invitation to the old address in the sandbox's organizations goes to the new one (accepted, cancelled and
 *    expired invitations are records of what was sent, and stay as they were).
 *  - every email queued for the person before the change (pending, scheduled or being sent) is suppressed with the
 *    reason sandbox_email_changed, so nothing written for the old address reaches the new inbox. In-app notices stay.
 *    A notification carries no address: the sender reads it from the person when it sends, so whatever is queued after
 *    the change goes to the new address.
 *  - the sandbox's address pattern (operator_sandbox_settings), so later runs find the same people.
 *  - the audit: auth.primary_email_changed in each organization the person belongs to, sandbox.email_pattern_set in the
 *    sandbox's first organization; both, as every write the CLI makes, marked via operator_cli.
 * Without `apply`, the same checks and counts, and nothing is written.
 */

export type SandboxAddressChange = { role: string; userId: string; from: string; to: string };
export type SandboxAddressInput = {
  sandbox: { slug: string; workspaceId: string; accountId: string };
  /** Every organization in the sandbox's customer account; the caller has checked the sandbox command made each one. */
  organizationIds: string[];
  /** Each person's address as the caller found it (checked again under lock) and the one they move to. */
  changes: SandboxAddressChange[];
  /** The address pattern the sandbox keeps, when it changes (from: the one it keeps now, checked under lock). */
  pattern: { from: string | null; to: string } | null;
  apply: boolean;
};
export type SandboxAddressResult = {
  changes: Array<SandboxAddressChange & { emailsSkipped: number; invitationsMoved: number }>;
  emailsSkipped: number;
  invitationsMoved: number;
};

/** The suppression reason of an email queued for a sandbox member's old address. */
export const SANDBOX_EMAIL_CHANGED = "sandbox_email_changed";

export async function changeSandboxAddresses(database: DatabaseService, input: SandboxAddressInput): Promise<SandboxAddressResult> {
  const organizations = new Set(input.organizationIds);
  return database.transaction(async (client) => {
    const correlationId = randomUUID();
    // The people, locked in id order (as signing in locks them), at the address the caller saw.
    const current = new Map((await client.query<{ id: string; email: string }>(
      `SELECT id, lower(primary_email::text) AS email FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [input.changes.map((change) => change.userId)])).rows.map((row) => [row.id, row.email]));
    const joined = new Map<string, string[]>();
    for (const change of input.changes) {
      if (current.get(change.userId) !== change.from) throw new OpsError(`${change.from} changed while this ran; run it again.`);
      joined.set(change.userId, await sandboxOnly(client, change, organizations, input.sandbox));
      const taken = await client.query(`SELECT 1 FROM users WHERE primary_email = $1 AND id <> $2`, [change.to, change.userId]);
      if (taken.rowCount) throw new OpsError(`${change.to} already signs in to Wodana as someone else; choose another --email-pattern. Nobody's address was changed.`);
    }
    if (input.pattern) {
      await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [input.sandbox.workspaceId]);
      const kept = (await client.query<{ pattern: string }>(
        `SELECT email_pattern AS pattern FROM operator_sandbox_settings WHERE workspace_id = $1 FOR UPDATE`, [input.sandbox.workspaceId])).rows[0]?.pattern ?? null;
      if (kept !== input.pattern.from) throw new OpsError(`The address pattern of sandbox ${input.sandbox.slug} changed while this ran; run it again.`);
    }

    if (input.apply) {
      for (const change of input.changes) {
        await client.query(`UPDATE users SET primary_email = $2, updated_at = now() WHERE id = $1`, [change.userId, change.to]);
        await client.query(`UPDATE user_identities SET email_at_provider = $2, updated_at = now() WHERE user_id = $1 AND provider = 'local'`, [change.userId, change.to]);
      }
    }
    const result: SandboxAddressResult = { changes: input.changes.map((change) => ({ ...change, emailsSkipped: 0, invitationsMoved: 0 })), emailsSkipped: 0, invitationsMoved: 0 };
    const people = input.changes.map((change) => change.userId);
    for (const workspaceId of input.organizationIds) {
      await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [workspaceId]);
      const skipped = new Map<string, number>();
      const moved = new Map<string, number>();
      if (people.length) {
        // Emails queued before the change: never sent, to either address. Failed and delivered ones are history.
        const queued = input.apply
          ? await client.query<{ recipientId: string }>(
            `UPDATE notifications SET status = 'suppressed', suppressed_reason = $3, processing_started_at = NULL, version = version + 1
              WHERE workspace_id = $1 AND recipient_type = 'user' AND recipient_id = ANY($2::uuid[]) AND channel = 'email'
                AND status IN ('pending', 'scheduled', 'processing') AND created_at <= now()
             RETURNING recipient_id AS "recipientId"`, [workspaceId, people, SANDBOX_EMAIL_CHANGED])
          : await client.query<{ recipientId: string }>(
            `SELECT recipient_id AS "recipientId" FROM notifications
              WHERE workspace_id = $1 AND recipient_type = 'user' AND recipient_id = ANY($2::uuid[]) AND channel = 'email'
                AND status IN ('pending', 'scheduled', 'processing') AND created_at <= now()`, [workspaceId, people]);
        for (const row of queued.rows) skipped.set(row.recipientId, (skipped.get(row.recipientId) ?? 0) + 1);
      }
      for (const change of input.changes) {
        const invitations = input.apply
          ? await client.query(`UPDATE workspace_invitations SET email = $3 WHERE workspace_id = $1 AND status = 'pending' AND email = $2`, [workspaceId, change.from, change.to])
          : await client.query(`SELECT 1 FROM workspace_invitations WHERE workspace_id = $1 AND status = 'pending' AND email = $2`, [workspaceId, change.from]);
        if (invitations.rowCount) moved.set(change.userId, invitations.rowCount);
      }
      for (const entry of result.changes) {
        const emails = skipped.get(entry.userId) ?? 0, invitations = moved.get(entry.userId) ?? 0;
        entry.emailsSkipped += emails;
        entry.invitationsMoved += invitations;
        result.emailsSkipped += emails;
        result.invitationsMoved += invitations;
        // Recorded in each organization the person belongs to (their sandbox's first one when they belong to none).
        const memberships = joined.get(entry.userId)!;
        const here = memberships.includes(workspaceId) || (!memberships.length && workspaceId === input.sandbox.workspaceId);
        if (input.apply && here) {
          await audit(client, workspaceId, "auth.primary_email_changed", "user", entry.userId, { email: entry.from },
            { email: entry.to, sandbox: input.sandbox.slug, role: entry.role, emailsSkipped: emails, invitationsMoved: invitations }, correlationId);
        }
      }
    }

    if (input.apply && input.pattern) {
      await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [input.sandbox.workspaceId]);
      await client.query(
        `INSERT INTO operator_sandbox_settings (workspace_id, email_pattern) VALUES ($1, $2)
         ON CONFLICT (workspace_id) DO UPDATE SET email_pattern = EXCLUDED.email_pattern, version = operator_sandbox_settings.version + 1, updated_at = now()`,
        [input.sandbox.workspaceId, input.pattern.to]);
      await audit(client, input.sandbox.workspaceId, "sandbox.email_pattern_set", "operator_sandbox_settings", input.sandbox.workspaceId,
        { emailPattern: input.pattern.from }, { emailPattern: input.pattern.to, sandbox: input.sandbox.slug }, correlationId);
    }
    return result;
  });
}

/**
 * Refuses a person who is a Wodana operator, or who belongs to an organization or a customer account the sandbox didn't
 * make: their address is theirs, not the sandbox's. The organizations they belong to, otherwise.
 */
async function sandboxOnly(client: PoolClient, change: SandboxAddressChange, organizations: ReadonlySet<string>, sandbox: SandboxAddressInput["sandbox"]) {
  const refused = (where: string) => new OpsError(
    `${change.from} also belongs to ${where}; a sandbox changes only its own test members' addresses. Nobody's address was changed.`);
  if ((await client.query(`SELECT 1 FROM platform_administrators WHERE user_id = $1`, [change.userId])).rowCount) throw refused("Wodana's operators");
  // The person's own memberships, as they would see them (membership_self_discovery).
  await client.query("SELECT set_config('app.current_workspace_id', '', true), set_config('app.current_actor_id', $1, true)", [change.userId]);
  const joined = (await client.query<{ workspaceId: string }>(
    `SELECT workspace_id AS "workspaceId" FROM workspace_memberships WHERE user_id = $1`, [change.userId])).rows.map((row) => row.workspaceId);
  const elsewhere = joined.filter((workspaceId) => !organizations.has(workspaceId));
  if (elsewhere.length) {
    const slugs = (await client.query<{ slug: string }>(`SELECT slug FROM workspaces WHERE id = ANY($1::uuid[]) ORDER BY slug`, [elsewhere])).rows.map((row) => row.slug);
    throw refused(`${slugs.length ? slugs.join(", ") : `${elsewhere.length} other organizations`}, which sandbox ${sandbox.slug} didn't make`);
  }
  const accounts = await client.query(`SELECT 1 FROM customer_account_memberships WHERE user_id = $1 AND account_id <> $2`, [change.userId, sandbox.accountId]);
  if (accounts.rowCount) throw refused(`a customer account other than sandbox ${sandbox.slug}'s`);
  await client.query("SELECT set_config('app.current_actor_id', '', true)");
  return joined;
}

async function audit(client: PoolClient, workspaceId: string, action: string, entityType: string, entityId: string,
  before: Record<string, unknown>, after: Record<string, unknown>, correlationId: string) {
  await client.query(
    `INSERT INTO audit_events (workspace_id, actor_user_id, source, action, entity_type, entity_id, before, after, correlation_id)
     VALUES ($1, NULL, 'internal', $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [workspaceId, action, entityType, entityId, JSON.stringify(before), JSON.stringify(after), correlationId]);
}
