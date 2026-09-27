/**
 * Palm Living showcase seed: the tenant (on an empty database), the role-wise team accounts as invitations,
 * teams and roles, the Core Collection, the supplier register, the proposal kit, tax and settings, and one
 * demonstration client and project run end to end through the core's own commands.
 *
 * Runs inside the business-core application (no HTTP, no login, no password, no token): it opens the same Nest
 * application context the API runs and acts as named existing people, so validation, permissions, audit and
 * forced RLS apply exactly as they do for the app.
 *
 *   node dist/seed/palm-showcase/main.js --dry-run                    # reports what would change; writes nothing
 *   node dist/seed/palm-showcase/main.js --commit --phase bootstrap   # the tenant, the owner and team invitations (links printed), teams and roles
 *   node dist/seed/palm-showcase/main.js --commit                     # everything: settings, catalog, suppliers, proposal kit and the showcase project
 *   node dist/seed/palm-showcase/main.js --commit --rotate-links      # prints fresh activation links for pending invitations
 *
 * On an empty database the first run provisions the tenant and prints the owner's activation link; the owner opens
 * it, sets a password and signs in once. The next run (as that owner) creates the teams, roles and the team
 * invitations and prints their links; later runs continue with whatever those people have accepted.
 *
 * Environment: DATABASE_URL (the app role), SEED_TENANT_SLUG (login slug; default palm-living), SEED_ACTOR_EMAIL
 * (the owner acting for setup; default the fixture's owner), SEED_DATA_DIR (a copy of docs/), SEED_CORE_COLLECTION_DIR
 * (the extracted artifact's "prepared" folder). Email leaves the process only with SEED_DELIVER_EMAIL=1.
 */
import "reflect-metadata";
import { ensureTeamsAndPeople, ensureTenant } from "./bootstrap";
import { ensureCoreCollection } from "./catalog";
import { Core, describe, type Actor, type Mode } from "./core";
import { loadSeedData, type Phase } from "./data";
import { ensureSettings } from "./settings";
import { ensureSuppliers } from "./suppliers";

async function main() {
  const args = new Set(process.argv.slice(2));
  const mode: Mode = args.has("--commit") ? "commit" : "dry-run";
  if (!args.has("--commit") && !args.has("--dry-run")) throw new Error("Pass --dry-run or --commit.");
  const rotateLinks = args.has("--rotate-links");
  const phaseArgument = process.argv[process.argv.indexOf("--phase") + 1];
  const phase: Phase = args.has("--phase") ? (phaseArgument === "bootstrap" ? "bootstrap" : phaseArgument === "all" ? "all" : (() => { throw new Error("--phase is bootstrap or all."); })()) : "all";
  const slug = (process.env.SEED_TENANT_SLUG ?? "palm-living").trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("SEED_TENANT_SLUG must be a login slug such as palm-living or plm.");
  const data = loadSeedData(phase);
  const ownerEmail = (process.env.SEED_ACTOR_EMAIL ?? data.showcase.owner.email).trim().toLowerCase();
  const core = await Core.open(mode);
  let failure: unknown = null;
  try {
    core.suppressEmail();
    const tenant = await ensureTenant(core, data, slug, rotateLinks);
    if (tenant) {
      const owner = await core.actor(tenant.workspaceId, ownerEmail);
      if (!owner?.active) {
        core.report.notes.push(`${ownerEmail} is not an active member of ${slug} yet. Open their activation link, set a password, sign in once, then run the seed again for everything else.`);
      } else {
        await ensureTeamsAndPeople(core, data, tenant, owner, rotateLinks);
        if (phase === "all") {
          await ensureSettings(core, data, tenant.workspaceId, owner);
          await ensureCoreCollection(core, data, tenant.workspaceId, owner);
          await ensureSuppliers(core, data, tenant.workspaceId, owner);
          await runShowcase(core, data, tenant.workspaceId, owner);
        }
      }
    }
  } catch (error) {
    failure = error;
  }
  try {
    const summary = core.report.summary(mode);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.links.length) {
      process.stdout.write("\nActivation links (each opens the sign-in page with the invitation; the person sets their own password):\n");
      for (const link of summary.links) process.stdout.write(`  ${link.role.padEnd(18)} ${link.name.padEnd(28)} ${link.email.padEnd(36)} ${link.link}\n`);
    }
  } finally {
    await core.close();
  }
  if (failure) throw failure;
}

/**
 * The demonstration client and project live in ../showcase (built separately). When that module is present it
 * runs last, as the owner, with the role-wise people the bootstrap created (by team code: their user and membership).
 */
async function runShowcase(core: Core, data: ReturnType<typeof loadSeedData>, workspaceId: string, owner: Actor) {
  type ShowcaseModule = { seedShowcase?: (input: Record<string, unknown>) => Promise<unknown> };
  let module: ShowcaseModule | null = null;
  try { module = require("../showcase") as ShowcaseModule; } catch (error) {
    if ((error as { code?: string }).code === "MODULE_NOT_FOUND") { core.report.notes.push("No showcase module (src/seed/showcase.ts); the demonstration project was not seeded."); return; }
    throw error;
  }
  if (!module?.seedShowcase) { core.report.notes.push("The showcase module exports no seedShowcase(); the demonstration project was not seeded."); return; }
  const roleActors: Record<string, { userId: string; membershipId: string | null; email: string; displayName: string; active: boolean }> = {};
  for (const person of data.showcase.people) {
    const actor = await core.actor(workspaceId, person.email);
    if (actor) roleActors[person.team] = { userId: actor.userId, membershipId: actor.membershipId, email: actor.email, displayName: actor.displayName, active: actor.active };
  }
  if (!core.commit) { core.report.record("showcase", "pending", "the demonstration project runs in commit mode"); return; }
  await module.seedShowcase({ app: core.app, workspaceId, actorUserId: owner.userId, roleActors, report: core.report });
  core.report.record("showcase", "changed");
}

main().catch((error) => {
  process.stderr.write(`Seed failed: ${describe(error)}\n`);
  if (error instanceof Error && error.cause) process.stderr.write(`  cause: ${describe(error.cause)}\n`);
  if (process.env.SEED_DEBUG === "1" && error instanceof Error) process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
