import "reflect-metadata";
import { readFile } from "node:fs/promises";
import { HttpException, type INestApplicationContext } from "@nestjs/common";
import { runWithCommandOrigin } from "../database/command-origin";
import { parseArgs, USAGE, UsageError, type ConfigureArgs, type OpsArgs } from "./ops-args";
import { readBrandFile, runBrand } from "./ops-brand";
import { runConfigure } from "./ops-configure";
import { openContext, OpsError, Report } from "./ops-context";
import { runImport } from "./ops-import";
import { runMembers } from "./ops-members";
import { runSandbox, runSandboxLifecycle } from "./ops-sandbox";
import { packagesAgainstProfile, ProfileError, validatePackagesFile, validateProfile } from "./ops-profile";
import { parseTeamsFile, SandboxFileError, type TeamSpec } from "./ops-sandbox-plan";

/**
 * The operator CLI (run in the business-core container: `node dist/ops/ops-cli.js …`). A platform operator with shell
 * access runs a workspace's go-live import and configuration without a sign-in, through the app's own services, as a
 * named active member of the workspace: the same validation, tenant isolation, version checks and permissions apply,
 * and every audit row it writes names that member and carries via = 'operator_cli'. Dry run unless --apply.
 * `sandbox` makes (or finds) a test workspace with one member per role through the same provisioning (ops-sandbox.ts).
 */

export type OpsOutput = { out: (line: string) => void; err: (line: string) => void };

/** Runs one command on a booted application context; the exit code. */
export async function runOps(app: INestApplicationContext, args: Exclude<OpsArgs, { command: "help" }>, output: OpsOutput): Promise<number> {
  const report = new Report(output.out, args.json);
  try {
    // Everything this run writes is audited as the member, marked as the operator CLI (audit_events.via).
    // A dry run's transactions are all rolled back, so it writes nothing, not even defaults a read would make.
    return await runWithCommandOrigin({ via: "operator_cli", dryRun: !args.apply }, async () => {
      if (args.command === "sandbox") {
        // No member to act as yet: the sandbox's own test owner acts once the workspace is made (ops-sandbox.ts).
        const lifecycle = "lifecycle" in args ? args.lifecycle : null;
        report.note(`sandbox ${args.slug}${lifecycle ? ` --${lifecycle}` : ""}: ${args.apply ? "APPLY" : "dry run"}`);
        if ("lifecycle" in args) await runSandboxLifecycle(app, args, report);
        else await runSandbox(app, args, report);
        report.finish({ command: args.command, workspace: args.slug, ...(lifecycle ? { lifecycle } : {}), mode: args.apply ? "apply" : "dry-run" });
        return report.failed ? 1 : 0;
      }
      // Every file is read and checked whole before anything connects to the workspace.
      const files = args.command === "configure" ? await readConfigureFiles(args) : null;
      const brand = args.command === "brand" ? await readBrandFile(args.file) : null;
      const ctx = await openContext(app, args.workspace, args.as, args.apply);
      report.note(`${args.command} in ${ctx.workspace.slug} as ${args.as}: ${args.apply ? "APPLY" : "dry run"}`);
      if (args.command === "import") await runImport(ctx, args, report);
      else if (args.command === "brand") await runBrand(ctx, brand!, report);
      else if (args.command === "members") await runMembers(ctx, args, report);
      else await runConfigure(ctx, files!.profile, report, files!);
      report.finish({ command: args.command, workspace: ctx.workspace.slug, mode: args.apply ? "apply" : "dry-run" });
      return report.failed ? 1 : 0;
    });
  } catch (error) {
    if (error instanceof UsageError) { output.err(error.message); return 2; }
    const message = error instanceof OpsError || error instanceof ProfileError ? error.message
      : error instanceof HttpException ? `${error.getStatus()} ${error.message}` : `Unexpected error: ${(error as Error).message}`;
    const workspace = args.command === "sandbox" ? args.slug : args.workspace;
    if (args.json) output.out(JSON.stringify({ command: args.command, workspace, mode: args.apply ? "apply" : "dry-run", error: message, lines: report.lines }, null, 2));
    else output.err(message);
    return 1;
  }
}

async function readJson(path: string, what: string): Promise<unknown> {
  let text: string;
  try { text = await readFile(path, "utf8"); } catch { throw new OpsError(`No ${what} at ${path}.`); }
  try { return JSON.parse(text); } catch { throw new OpsError(`${path} is not valid JSON.`); }
}

/** configure's profile, teams access file and design packages file, each checked whole (and against each other). */
async function readConfigureFiles(args: ConfigureArgs) {
  const profile = args.profile ? validateProfile(await readJson(args.profile, "profile")) : null;
  let teams: TeamSpec[] | null = null;
  if (args.teams) {
    try { teams = parseTeamsFile(await readJson(args.teams, "teams file")); } catch (error) {
      if (error instanceof SandboxFileError) throw new OpsError(error.message);
      throw error;
    }
  }
  const packages = args.packages ? validatePackagesFile(await readJson(args.packages, "design packages file")) : null;
  const conflicts = packages ? packagesAgainstProfile(packages, profile) : [];
  if (conflicts.length) throw new OpsError(`The design packages file and the profile disagree:\n  - ${conflicts.join("\n  - ")}`);
  return { profile, teams, packages };
}

/** Boots the application context without an HTTP listener and without the background publishers. */
export async function bootContext(): Promise<INestApplicationContext> {
  // The outbox stays in PostgreSQL for the API's own publisher; the storage cleanup worker is the API's to run.
  process.env.REDIS_URL = "";
  process.env.WORKSPACE_OBJECT_CLEANUP_ENABLED = "false";
  // The reminder and Ledger sweeps are the API's timers: the CLI runs only the sweeps a command asks for, for its own workspace.
  process.env.REMINDERS_SWEEP_ENABLED = "false";
  process.env.BOOKS_SWEEP_ENABLED = "false";
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../app.module");
  return NestFactory.createApplicationContext(AppModule, { logger: ["error"], abortOnError: false });
}

async function main() {
  const output: OpsOutput = { out: (line) => process.stdout.write(`${line}\n`), err: (line) => process.stderr.write(`${line}\n`) };
  let args: OpsArgs;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) {
    if (error instanceof UsageError) { output.err(`${error.message}\n\n${USAGE}`); process.exit(2); }
    throw error;
  }
  if (args.command === "help") { output.out(USAGE); process.exit(0); }
  const app = await bootContext();
  let code = 1;
  try { code = await runOps(app, args, output); }
  finally { await app.close().catch(() => undefined); }
  process.exit(code);
}

if (require.main === module) void main();
