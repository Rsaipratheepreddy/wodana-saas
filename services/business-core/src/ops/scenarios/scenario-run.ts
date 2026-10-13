import type { INestApplicationContext } from "@nestjs/common";
import type { RequestActor } from "../../auth/actor";
import { CrmIntakeService } from "../../crm/intake/crm-intake.service";
import { DatabaseService } from "../../database/database.service";
import type { ShowcaseRole } from "../../seed/showcase";
import type { Report } from "../ops-context";
import { APPROVAL_KINDS, expandMatrix, moduleCounts, outcomes, planScenarios, type MatrixContext, type RecipeKey, type ScenarioOutcome } from "./scenario-matrix";
import { probeScenarios } from "./scenario-probes";
import { regionFixture } from "./scenario-regions";
import { RECIPE_STORIES } from "./scenario-seed";
import { ScenarioSeedTwo } from "./scenario-seed-two";
import { storyCatalog, type StoryKey } from "./scenario-stories";

/**
 * `sandbox --scenarios`: every main scenario gets at least one realistic example in the organization (scenario-matrix.ts).
 * The run reads what is there (scenario-probes.ts; the approvals feed and My day as each test member sees them), makes
 * only what is missing through the app's own services as the sandbox's test members (scenario-seed.ts and
 * scenario-seed-two.ts, on the showcase engine), reads again and reports each scenario with its record: already there,
 * created, or skipped with the reason. A second run finds everything and makes nothing. Without --apply it only reads
 * and says what it would make.
 */

/** The scenarios this release makes (pass 2: all of them). */
export const SCENARIO_PASS = 2;

export type ScenarioRunInput = {
  workspaceId: string;
  /** The test owner: reads and the steps that need an administrator. */
  ownerUserId: string;
  /** The test members by role key (owner, manager, sales, …): user ids. */
  members: ReadonlyArray<{ key: string; displayName: string; userId: string | null }>;
  apply: boolean;
  /** The organization's reminder sweep on the lock the run holds (scenario-delivery.ts): My day's items. */
  sweepReminders?: () => Promise<unknown>;
};

export type ScenarioRunResult = { rows: ScenarioOutcome[]; recipes: RecipeKey[]; created: number; skipped: Array<{ stage: string; reason: string }> };

/** The organization's own options and facts the scenarios depend on. */
async function readContext(app: INestApplicationContext, workspaceId: string, owner: RequestActor & { userId: string }) {
  const db = app.get(DatabaseService, { strict: false });
  const facts = (await db.tenantTransaction(workspaceId, owner.userId, async (client) => {
    const workspace = (await client.query<{ currency: string; country: string | null }>(
      `SELECT workspace.default_currency AS currency, coalesce((SELECT setup.region_code FROM workspace_setup_versions setup WHERE setup.workspace_id = workspace.id),
              (SELECT entity.country_code FROM legal_entities entity WHERE entity.workspace_id = workspace.id ORDER BY entity.created_at LIMIT 1)) AS country
         FROM workspaces workspace WHERE workspace.id = $1`, [workspaceId])).rows[0];
    const route = (await client.query<{ key: string; name: string }>(
      `SELECT stage.key, stage.name FROM project_templates template JOIN project_template_stages stage ON stage.workspace_id = template.workspace_id AND stage.template_id = template.id
        WHERE template.workspace_id = $1 AND template.is_default AND template.status = 'active' ORDER BY stage.position`, [workspaceId])).rows;
    const pipeline = (await client.query<{ id: string; code: string; label: string }>(
      `SELECT stage.id, stage.code, stage.name AS label FROM crm_pipelines pipeline JOIN crm_pipeline_stages stage ON stage.workspace_id = pipeline.workspace_id AND stage.pipeline_id = pipeline.id
        WHERE pipeline.workspace_id = $1 AND pipeline.is_default AND stage.status = 'active' ORDER BY stage.position`, [workspaceId]).catch(() => ({ rows: [] as Array<{ id: string; code: string; label: string }> }))).rows;
    return { currency: workspace?.currency ?? "", country: (workspace?.country ?? "").toUpperCase(), route, pipeline };
  }));
  const options = (await app.get(CrmIntakeService, { strict: false }).options(owner, workspaceId)) as unknown as {
    enquiryTypes: Array<{ id: string; label: string }>; emirates: Array<{ id: string; label: string }> };
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const regionId = (name: string) => options.emirates.find((option) => norm(option.label) === norm(name) || norm(option.id) === norm(name))?.id;
  return { ...facts, enquiryTypes: options.enquiryTypes.map((type) => ({ code: type.id, label: type.label })), regionId };
}

const ROLE_OF: Record<string, ShowcaseRole[]> = {
  owner: ["owner"], manager: ["manager", "salesAdmin", "projectManager"], sales: ["sales"], designer: ["designer"], qs: ["estimator"], purchasing: ["buyer"],
  factory: ["factory"], site: ["site"], finance: ["finance"],
};

export async function runScenarios(app: INestApplicationContext, input: ScenarioRunInput, report: Report): Promise<ScenarioRunResult> {
  const db = app.get(DatabaseService, { strict: false });
  const ownerPerson = (await db.query<{ email: string; displayName: string }>(`SELECT primary_email::text AS email, display_name AS "displayName" FROM users WHERE id = $1`, [input.ownerUserId])).rows[0];
  const owner = { subject: `operator-cli:${input.ownerUserId}`, email: ownerPerson.email, displayName: ownerPerson.displayName, provider: "operator_cli", operator: { userId: input.ownerUserId },
    userId: input.ownerUserId } as RequestActor & { userId: string };
  const context = await readContext(app, input.workspaceId, owner);
  const matrixContext: MatrixContext = {
    enquiryTypes: context.enquiryTypes, pipelineStages: context.pipeline.map((stage) => ({ code: stage.code, label: stage.label })),
    routeStages: context.route.map((stage) => ({ key: stage.key, label: stage.name })), members: input.members.map((member) => ({ key: member.key, displayName: member.displayName })),
  };
  const matrix = expandMatrix(matrixContext).filter((spec) => spec.pass <= SCENARIO_PASS);
  const fixture = regionFixture(context.country);
  const route = context.route.map((stage) => stage.key);
  const actors: Partial<Record<ShowcaseRole, string>> = {};
  for (const member of input.members) for (const role of ROLE_OF[member.key] ?? []) if (member.userId && !actors[role]) actors[role] = member.userId;
  const seedFor = async (stories: StoryKey[]) => {
    const catalog = storyCatalog({ fixture, country: context.country, regionId: context.regionId, routeStages: route });
    const seed = new ScenarioSeedTwo({ app, workspaceId: input.workspaceId, actorUserId: input.ownerUserId, actors, deliverEmail: false, log: () => undefined,
      stories: stories.filter((key) => catalog.has(key)).map((key) => catalog.get(key)!), fixture, country: context.country, currency: context.currency });
    await seed.prepareScenarios();
    return seed;
  };
  const reader = await seedFor([]);
  // Each scenario's record: a query, or (approvals and My day) the feed each test member sees.
  const probe = async () => {
    const found = await db.tenantTransaction(input.workspaceId, input.ownerUserId, (client) => probeScenarios(client, input.workspaceId, context.country, matrix));
    const kinds = await reader.approvalKinds(input.members);
    for (const kind of APPROVAL_KINDS) if (found.has(`approval.${kind}`)) found.set(`approval.${kind}`, kinds.get(kind) ?? null);
    const days = await reader.myDayCounts(input.members);
    for (const member of input.members) if (found.has(`my_day.${member.key}`)) {
      const count = days.get(member.key) ?? 0;
      found.set(`my_day.${member.key}`, count ? `${count} item${count === 1 ? "" : "s"} on their day` : null);
    }
    return found;
  };
  const before = await probe();
  const plan = planScenarios(matrix, before);
  report.facts.scenarioRegion = { country: context.country, currency: context.currency, route };

  let after = before;
  const reasons = new Map<RecipeKey, string>();
  const notes = new Map<string, string>();
  let created = 0;
  let skipped: Array<{ stage: string; reason: string }> = [];
  if (input.apply && plan.recipes.length) {
    const wanted = new Set<StoryKey>();
    for (const recipe of plan.recipes) for (const key of RECIPE_STORIES[recipe]?.(route) ?? []) wanted.add(key);
    const seed = await seedFor([...wanted]);
    const has = (recipe: RecipeKey) => plan.recipes.includes(recipe);
    const first = route[0] ? `stage-${route[0]}` as StoryKey : "project-risk";
    const production = route.includes("production") ? "stage-production" as StoryKey : first;
    if (has("enquiries")) await seed.recipe("enquiries", () => seed.scenarioEnquiries(context.enquiryTypes, context.regionId));
    if (has("pipeline")) await seed.recipe("pipeline", () => seed.pipeline(context.pipeline));
    if (has("inbox")) await seed.recipe("inbox", () => seed.unansweredMessage());
    await seed.recipe(plan.recipes.find((recipe) => RECIPE_STORIES[recipe]) ?? "quotes", () => seed.tellStories());
    if (has("quotes")) {
      await seed.recipe("quotes", () => seed.declineQuote());
      await seed.recipe("quotes", () => seed.reviseQuote());
      await seed.recipe("quotes", () => seed.discountQuote());
      await seed.recipe("quotes", () => seed.valueEngineering());
      await seed.recipe("quotes", async () => {
        const expiring = await seed.expiringQuote();
        notes.set("quote.expired", expiring
          ? `${expiring}: the product's daily expiry marks it expired once today is over (a quotation can't be sent with a validity that has already passed)`
          : "a quotation can't be sent with a validity that has already passed");
      });
    }
    if (has("deals")) await seed.recipe("deals", () => seed.agreementWaiting());
    if (has("design_fee")) await seed.recipe("design_fee", () => seed.designFee());
    if (has("planning")) await seed.recipe("planning", () => seed.planningPhases());
    if (has("project_hold")) await seed.recipe("project_hold", () => seed.holdProject());
    if (has("project_risk")) await seed.recipe("project_risk", () => seed.riskProject());
    if (has("project_budget")) await seed.recipe("project_budget", () => seed.overBudget());
    if (has("changes")) await seed.recipe("changes", () => seed.changes(production));
    if (has("purchasing")) {
      await seed.recipe("purchasing", () => seed.scenarioPurchasing(route));
      await seed.recipe("purchasing", () => seed.waitingPurchases("project-budget"));
    }
    if (has("stock")) await seed.recipe("stock", () => seed.lowStock());
    if (has("factory")) {
      await seed.recipe("factory", () => seed.factoryShortage(production));
      await seed.recipe("factory", () => seed.factoryOutput(production));
    }
    if (has("site")) await seed.recipe("site", () => seed.snags("project-risk"));
    if (has("finance")) {
      await seed.recipe("finance", () => seed.invoices());
      await seed.recipe("finance", () => seed.refund("project-budget"));
      await seed.recipe("finance", () => seed.supplierPayment("project-budget"));
      await seed.recipe("finance", () => seed.pettyCashWaiting("project-budget"));
      await seed.recipe("finance", () => seed.invoiceDue(first));
      await seed.recipe("finance", () => seed.paymentRun());
    }
    // The Ledger posts what everything above made.
    await seed.recipe("ledger", () => seed.ledger());
    // My day: the reminder sweep (on the run's lock) opens each person's items; anyone still without one gets a task due today.
    if (input.sweepReminders) {
      await input.sweepReminders();
      if (has("my_day")) {
        const days = await seed.myDayCounts(input.members);
        let added = false;
        for (const member of input.members) if (member.userId && !(days.get(member.key) ?? 0)) {
          await seed.recipe("my_day", () => seed.dueToday({ key: member.key, displayName: member.displayName, userId: member.userId! }, "project-risk"));
          added = true;
        }
        if (added) await input.sweepReminders();
      }
    } else notes.set("my_day", "made by the reminder sweep with --apply");
    for (const [key, value] of seed.reasons) reasons.set(key, value);
    for (const [key, value] of seed.notes) if (!notes.has(key)) notes.set(key, value);
    created = seed.result.created.length;
    skipped = seed.result.skipped;
    after = await probe();
  }

  const rows = outcomes(matrix, before, after, { apply: input.apply, reasons, notes });
  for (const row of rows) {
    const status = row.status === "already there" ? "unchanged" : row.status === "created" ? "changed" : row.status === "would create" ? "would change" : "manual";
    report.add("scenarios", status, row.spec.key, row.reference ? `${row.spec.label} → ${row.reference}` : `${row.spec.label}${row.reason ? `: ${row.reason}` : ""}`);
  }
  report.facts.scenarios = { pass: SCENARIO_PASS, matrix: rows.map((row) => ({ key: row.spec.key, module: row.spec.module, label: row.spec.label, status: row.status, reference: row.reference,
    ...(row.reason ? { reason: row.reason } : {}) })), modules: moduleCounts(rows), recipes: plan.recipes, recordsCreated: created };
  // What the product refused on the way (each with its reason), for the operator.
  for (const entry of skipped.slice(0, 40)) report.add("scenarios", "info", entry.stage, entry.reason.slice(0, 240));
  const counts = moduleCounts(rows);
  report.note(`\nScenarios, ${context.country} · ${context.currency}:`);
  for (const [module, count] of Object.entries(counts))
    report.note(`  ${module.padEnd(12)} ${String(count.scenarios).padStart(3)} scenarios: ${count.alreadyThere} already there, ${count.created} created${count.wouldCreate ? `, ${count.wouldCreate} to make` : ""}${count.skipped ? `, ${count.skipped} skipped` : ""}`);
  return { rows, recipes: plan.recipes, created, skipped };
}
