import type { INestApplicationContext } from "@nestjs/common";
import { CrmIntakeService } from "../../crm/intake/crm-intake.service";
import { DatabaseService } from "../../database/database.service";
import type { RequestActor } from "../../auth/actor";
import type { ShowcaseRole } from "../../seed/showcase";
import type { Report } from "../ops-context";
import { expandMatrix, moduleCounts, outcomes, planScenarios, type MatrixContext, type RecipeKey, type ScenarioOutcome } from "./scenario-matrix";
import { probeScenarios } from "./scenario-probes";
import { regionFixture } from "./scenario-regions";
import { RECIPE_STORIES, ScenarioSeed } from "./scenario-seed";
import { storyCatalog, type StoryKey } from "./scenario-stories";

/**
 * `sandbox --scenarios`: every main scenario gets at least one realistic example in the organization (scenario-matrix.ts).
 * The run reads what is there (scenario-probes.ts), makes only what is missing through the app's own services as the
 * sandbox's test members (scenario-seed.ts, on the showcase engine), reads again and reports each scenario with its
 * record: already there, created, or skipped with the reason. A second run finds everything and makes nothing. Without
 * --apply it only reads and says what it would make.
 */

/** The scenarios this pass makes (the rest follow in the next pass). */
export const SCENARIO_PASS = 1;

export type ScenarioRunInput = {
  workspaceId: string;
  /** The test owner: reads and the steps that need an administrator. */
  ownerUserId: string;
  /** The test members by role key (owner, manager, sales, …): user ids. */
  members: ReadonlyArray<{ key: string; displayName: string; userId: string | null }>;
  apply: boolean;
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
    return { currency: workspace?.currency ?? "", country: (workspace?.country ?? "").toUpperCase(), route };
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
    enquiryTypes: context.enquiryTypes, pipelineStages: [], routeStages: context.route.map((stage) => ({ key: stage.key, label: stage.name })),
    members: input.members.map((member) => ({ key: member.key, displayName: member.displayName })),
  };
  const matrix = expandMatrix(matrixContext).filter((spec) => spec.pass <= SCENARIO_PASS);
  const probe = () => db.tenantTransaction(input.workspaceId, input.ownerUserId, (client) => probeScenarios(client, input.workspaceId, context.country, matrix));
  const before = await probe();
  const plan = planScenarios(matrix, before);
  report.facts.scenarioRegion = { country: context.country, currency: context.currency, route: context.route.map((stage) => stage.key) };

  let after = before;
  const reasons = new Map<RecipeKey, string>();
  const notes = new Map<string, string>();
  let created = 0;
  let skipped: Array<{ stage: string; reason: string }> = [];
  if (input.apply && plan.recipes.length) {
    const fixture = regionFixture(context.country);
    const route = context.route.map((stage) => stage.key);
    const catalog = storyCatalog({ fixture, country: context.country, regionId: context.regionId, routeStages: route });
    const wanted = new Set<StoryKey>();
    for (const recipe of plan.recipes) for (const key of RECIPE_STORIES[recipe]?.(route) ?? []) if (catalog.has(key)) wanted.add(key);
    const actors: Partial<Record<ShowcaseRole, string>> = {};
    for (const member of input.members) for (const role of ROLE_OF[member.key] ?? []) if (member.userId && !actors[role]) actors[role] = member.userId;
    const seed = new ScenarioSeed({ app, workspaceId: input.workspaceId, actorUserId: input.ownerUserId, actors, deliverEmail: false, log: () => undefined,
      stories: [...wanted].map((key) => catalog.get(key)!), fixture, country: context.country, currency: context.currency });
    await seed.prepareScenarios();
    const has = (recipe: RecipeKey) => plan.recipes.includes(recipe);
    if (has("enquiries")) await seed.recipe("enquiries", () => seed.scenarioEnquiries(context.enquiryTypes, context.regionId));
    await seed.recipe(plan.recipes.find((recipe) => RECIPE_STORIES[recipe]) ?? "quotes", () => seed.tellStories());
    if (has("quotes")) {
      await seed.recipe("quotes", () => seed.declineQuote());
      await seed.recipe("quotes", () => seed.reviseQuote());
      await seed.recipe("quotes", () => seed.discountQuote());
      notes.set("quote.expired", "a quotation can't be sent with a validity that has already passed: the one sent today expires after its validity days, and the daily expiry run marks it expired");
    }
    if (has("project_hold")) await seed.recipe("project_hold", () => seed.holdProject());
    if (has("project_risk")) await seed.recipe("project_risk", () => seed.riskProject());
    if (has("project_budget")) await seed.recipe("project_budget", () => seed.overBudget());
    if (has("changes")) await seed.recipe("changes", () => seed.changes(route.includes("production") ? "stage-production" : `stage-${route[0]}` as StoryKey));
    if (has("purchasing")) await seed.recipe("purchasing", () => seed.scenarioPurchasing(route));
    if (has("finance")) await seed.recipe("finance", () => seed.invoices());
    // Last: the Ledger posts what everything above made.
    if (has("ledger") || plan.recipes.length) await seed.recipe("ledger", () => seed.ledger());
    for (const [key, value] of seed.reasons) reasons.set(key, value);
    for (const [key, value] of seed.notes) if (!notes.has(key)) notes.set(key, value);
    created = seed.result.created.length;
    skipped = seed.result.skipped;
    after = await probe();
  } else if (!input.apply) {
    for (const spec of plan.missing) if (spec.key === "quote.expired") notes.set(spec.key, "made with --apply");
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
  report.note(`\nScenarios (pass ${SCENARIO_PASS}), ${context.country} · ${context.currency}:`);
  for (const [module, count] of Object.entries(counts))
    report.note(`  ${module.padEnd(12)} ${String(count.scenarios).padStart(3)} scenarios: ${count.alreadyThere} already there, ${count.created} created${count.wouldCreate ? `, ${count.wouldCreate} to make` : ""}${count.skipped ? `, ${count.skipped} skipped` : ""}`);
  return { rows, recipes: plan.recipes, created, skipped };
}
