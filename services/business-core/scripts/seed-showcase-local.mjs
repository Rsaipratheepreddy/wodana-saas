#!/usr/bin/env node
// Seeds the showcase project ("Demo Client — Villa 12") into a local workspace through the business-core services:
// no HTTP, no login, no password. Boots the same Nest application context the API runs and acts as existing members.
//
//   node scripts/seed-showcase-local.mjs                       # workspace palm-living, acting as manager@palmliving.test
//   SEED_TENANT_SLUG=plm SEED_ACTOR_EMAIL=owner@x.test node scripts/seed-showcase-local.mjs
//
// A second run finds everything the first made and creates nothing. Emails are suppressed unless SEED_DELIVER_EMAIL=1.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
process.chdir(root);
require("reflect-metadata");
require("ts-node").register({ project: resolve(root, "tsconfig.json"), transpileOnly: true });
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require(resolve(root, "src/app.module.ts"));
const { DatabaseService } = require(resolve(root, "src/database/database.service.ts"));
const { seedShowcase } = require(resolve(root, "src/seed/showcase.ts"));

const slug = (process.env.SEED_TENANT_SLUG ?? "palm-living").trim().toLowerCase();
const actorEmail = (process.env.SEED_ACTOR_EMAIL ?? "manager@palmliving.test").trim().toLowerCase();

const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
let failed = false;
try {
  const db = app.get(DatabaseService, { strict: false });
  // Workspaces are visible to their members: the acting person is found first, then their workspace by slug.
  const person = (await db.query(`SELECT id FROM users WHERE lower(primary_email) = $1`, [actorEmail])).rows[0];
  if (!person) throw new Error(`No user ${actorEmail}.`);
  const workspace = (await db.actorTransaction(person.id, (client) => client.query(`SELECT id, name FROM workspaces WHERE slug = $1`, [slug]))).rows[0];
  if (!workspace) throw new Error(`No workspace with slug ${slug} that ${actorEmail} is a member of.`);
  const members = (await db.tenantTransaction(workspace.id, null, (client) => client.query(
    `SELECT person.id AS "userId", person.primary_email AS email, membership.id AS "membershipId",
            ARRAY(SELECT team.code FROM workspace_team_members link JOIN workspace_teams team ON team.id = link.team_id WHERE link.membership_id = membership.id) AS teams,
            ARRAY(SELECT role.code FROM member_roles link JOIN roles role ON role.id = link.role_id WHERE link.membership_id = membership.id) AS roles
       FROM workspace_memberships membership JOIN users person ON person.id = membership.user_id
      WHERE membership.workspace_id = $1 AND membership.status = 'active' ORDER BY person.primary_email`, [workspace.id]))).rows;
  const actor = members.find((row) => row.email.toLowerCase() === actorEmail);
  if (!actor) throw new Error(`${actorEmail} is not an active member of ${slug}.`);
  // People per team code (the bootstrap's teams) and the owner by role; the actor covers whatever is missing.
  const roleActors = {};
  for (const row of members) {
    if (row.email.toLowerCase() === "operations@palmlivingae.com") continue; // never act as the real operations mailbox
    for (const team of row.teams) roleActors[team] ??= { userId: row.userId, membershipId: row.membershipId, active: true };
  }
  const owner = members.find((row) => row.roles.includes("owner") && row.email.toLowerCase() !== "operations@palmlivingae.com");
  process.stdout.write(`Seeding the showcase into ${workspace.name} (${slug}) as ${actor.email}\n`);
  const result = await seedShowcase({
    app, workspaceId: workspace.id, actorUserId: actor.userId, roleActors,
    actors: owner ? { owner: owner.userId } : {},
    deliverEmail: process.env.SEED_DELIVER_EMAIL === "1",
  });
  process.stdout.write(`\ncreated ${result.created.length} · reused ${result.reused.length} · skipped ${result.skipped.length}\n`);
  for (const skipped of result.skipped) process.stdout.write(`  skipped  ${skipped.stage}: ${skipped.reason}\n`);
  process.stdout.write(`${JSON.stringify(result.ids, null, 2)}\n`);
} catch (error) {
  failed = true;
  process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  if (process.env.SEED_DEBUG === "1" && error instanceof Error) process.stderr.write(`${error.stack}\n`);
} finally {
  await app.close();
}
process.exit(failed ? 1 : 0);
