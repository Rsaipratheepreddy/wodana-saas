#!/usr/bin/env node
// Activates a workspace's pending demonstration invitations with ONE password the owner types here, through the
// same acceptance the activation link runs (credential, local identity, membership with its roles and teams,
// audit). The tool is interactive and local to the database host; it never logs or stores the password.
//
//   ACTIVATE_DATABASE_URL=postgresql://postgres@localhost:5432/wodana \
//     node scripts/activate-demo-accounts.mjs <workspace-login-slug> <email-domain-filter>
//   e.g. node scripts/activate-demo-accounts.mjs plm @palmliving.test
//
// In the core image, mount this file into /workspace (next to node_modules and services/business-core/dist).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";

const [slugArgument, filterArgument] = process.argv.slice(2);
assert.ok(slugArgument && filterArgument, "Usage: activate-demo-accounts.mjs <workspace-login-slug> <email-domain-filter such as @palmliving.test>");
const slug = slugArgument.trim().toLowerCase();
assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, "The workspace login slug is lowercase letters, numbers and hyphens");
const filter = filterArgument.trim().toLowerCase();
assert.match(filter, /^@[a-z0-9.-]+\.[a-z]{2,}$/, "The email filter is a domain such as @palmliving.test");

const databaseUrl = process.env.ACTIVATE_DATABASE_URL;
assert.ok(databaseUrl, "ACTIVATE_DATABASE_URL is required");
const target = new URL(databaseUrl);
assert.ok(["localhost", "127.0.0.1", "::1", ""].includes(target.hostname) || target.hostname.startsWith("%2F") || target.hostname.startsWith("/"),
  "This tool is local-only: use the database host's socket or localhost, never a remote address");
assert.ok(process.stdin.isTTY && process.stdout.isTTY, "Run this tool from an interactive terminal");

// The core's own password hashing and invitation acceptance, from the built service (never re-implemented here).
const here = dirname(fileURLToPath(import.meta.url));
const distRoot = [resolve(here, "../dist"), "/workspace/services/business-core/dist"].find((dir) => existsSync(resolve(dir, "auth/local-password.js")));
assert.ok(distRoot, "The built core (dist/) was not found next to this tool or under /workspace/services/business-core");
const require = createRequire(import.meta.url);
const { hashPassword } = require(resolve(distRoot, "auth/local-password.js"));
const { acceptPendingInvitation } = require(resolve(distRoot, "workspaces/invitation-acceptance.js"));

function secretPrompt(label) {
  return new Promise((resolvePrompt, reject) => {
    let value = "";
    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n") {
          process.stdin.off("data", onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          resolvePrompt(value);
          return;
        }
        if (character === "\u0003") {
          process.stdin.off("data", onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          reject(new Error("Cancelled"));
          return;
        }
        if (character === "\u007f") value = value.slice(0, -1);
        else if (character >= " " && value.length < 128) value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

const database = new pg.Client({ connectionString: databaseUrl });
await database.connect();
try {
  const workspace = (await database.query(
    `SELECT branding.workspace_id AS id, workspace.name FROM tenant_login_branding branding
       JOIN workspaces workspace ON workspace.id = branding.workspace_id WHERE branding.login_slug = $1`, [slug])).rows[0];
  assert.ok(workspace, `No workspace has the login address "${slug}"`);
  const pending = (await database.query(
    `SELECT invitation.id, invitation.email, invitation.expires_at AS "expiresAt", app_user.id AS "userId", app_user.display_name AS "displayName",
            coalesce((SELECT string_agg(role.code, ', ' ORDER BY role.code) FROM invitation_roles invited JOIN roles role ON role.id = invited.role_id WHERE invited.invitation_id = invitation.id), '') AS roles,
            coalesce((SELECT string_agg(team.name, ', ' ORDER BY team.name) FROM invitation_teams invited JOIN workspace_teams team ON team.id = invited.team_id WHERE invited.invitation_id = invitation.id), '') AS teams
       FROM workspace_invitations invitation JOIN users app_user ON app_user.primary_email = invitation.email
      WHERE invitation.workspace_id = $1 AND invitation.status = 'pending' AND lower(invitation.email) LIKE '%' || $2
      ORDER BY invitation.created_at`, [workspace.id, filter])).rows;
  if (!pending.length) {
    console.log(`No pending invitations for ${filter} in ${workspace.name} (${slug}).`);
    process.exit(0);
  }
  console.log(`${pending.length} pending invitation(s) in ${workspace.name} (${slug}) for ${filter}:`);
  for (const row of pending) console.log(`  ${(row.teams || row.roles || "member").padEnd(34)} ${row.displayName.padEnd(28)} ${row.email}`);
  const password = await secretPrompt("Shared password for these accounts (hidden): ");
  const confirmation = await secretPrompt("Confirm password (hidden): ");
  assert.equal(password, confirmation, "Passwords do not match");
  assert.ok(password.length >= 10 && password.length <= 128
    && /[a-z]/.test(password) && /[A-Z]/.test(password)
    && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password),
  "Use 10–128 characters with upper/lowercase, a number and a symbol");

  const results = [];
  for (const row of pending) {
    if (new Date(row.expiresAt).getTime() <= Date.now()) { results.push({ ...row, activated: "expired" }); continue; }
    await database.query("BEGIN");
    try {
      // The same steps as the activation link: tenant context, the credential, the local identity, acceptance, audit.
      await database.query("SELECT set_config('app.current_workspace_id', $1, true)", [workspace.id]);
      await database.query("SELECT set_config('app.current_actor_id', $1, true)", [row.userId]);
      const locked = await database.query(`SELECT status FROM workspace_invitations WHERE id = $1 FOR UPDATE`, [row.id]);
      if (locked.rows[0]?.status !== "pending") { await database.query("ROLLBACK"); results.push({ ...row, activated: "no longer pending" }); continue; }
      const encoded = await hashPassword(password);
      await database.query(
        `INSERT INTO local_auth_credentials (user_id, password_hash, password_salt) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, password_salt = EXCLUDED.password_salt,
           failed_attempts = 0, locked_until = NULL, password_changed_at = now(), updated_at = now()`,
        [row.userId, encoded.hash, encoded.salt]);
      await database.query(
        `INSERT INTO user_identities (user_id, provider, provider_subject, email_at_provider, last_login_at) VALUES ($1, 'local', $2, $3, now())
         ON CONFLICT (provider, provider_subject) DO UPDATE SET email_at_provider = EXCLUDED.email_at_provider, updated_at = now()`,
        [row.userId, `local:${row.userId}`, row.email]);
      const accepted = await acceptPendingInvitation(database, { invitationId: row.id, userId: row.userId });
      await database.query(
        `INSERT INTO audit_events (workspace_id, actor_user_id, source, action, entity_type, entity_id, after, correlation_id)
         VALUES ($1, $2, 'user', 'workspace.invitation_accepted', 'workspace_membership', $3, $4::jsonb, $5)`,
        [workspace.id, row.userId, accepted.membershipId, JSON.stringify({ invitationId: row.id, email: row.email, tool: "activate-demo-accounts" }), randomUUID()]);
      await database.query("COMMIT");
      results.push({ ...row, activated: "yes" });
    } catch (error) {
      await database.query("ROLLBACK").catch(() => undefined);
      results.push({ ...row, activated: `no: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  console.log("");
  console.log(`${"Role".padEnd(34)} ${"Name".padEnd(28)} ${"Email".padEnd(36)} Activated`);
  for (const row of results) console.log(`${(row.teams || row.roles || "member").padEnd(34)} ${row.displayName.padEnd(28)} ${row.email.padEnd(36)} ${row.activated}`);
} finally {
  await database.end();
}
