import { BadRequestException } from "@nestjs/common";
import type { PoolClient } from "pg";

/**
 * The Sales pipeline a workspace starts with. The firm setup kit may carry its own (`salesPipeline`),
 * so a kind of firm can open with the stages its deals really go through; without one, this default
 * applies. Seeded when the workspace is created, so the first conversion never depends on someone
 * with the CRM-settings permission creating a pipeline first.
 */
export type SalesPipelineStageTemplate = {
  code: string;
  name: string;
  position: number;
  probability: number;
  forecastCategory: "pipeline" | "best_case" | "commit" | "closed";
  entryRequirements: Record<string, boolean>;
};

export type SalesPipelineTemplate = { code: string; name: string; stages: SalesPipelineStageTemplate[] };

export const DEFAULT_SALES_PIPELINE: SalesPipelineTemplate = {
  code: "sales",
  name: "Sales",
  stages: [
    { code: "qualified", name: "New Opportunity", position: 1, probability: 20, forecastCategory: "pipeline", entryRequirements: { owner: true, nextAction: true } },
    // What each column needs comes from the enquiry type's flow (crm/opportunities/flow-gates.ts).
    { code: "qualification", name: "Qualified", position: 2, probability: 35, forecastCategory: "pipeline", entryRequirements: {} },
    { code: "proposal", name: "Proposal", position: 3, probability: 50, forecastCategory: "best_case", entryRequirements: {} },
    { code: "negotiation", name: "Negotiation", position: 4, probability: 75, forecastCategory: "commit", entryRequirements: {} },
    { code: "won", name: "Won", position: 5, probability: 100, forecastCategory: "closed", entryRequirements: {} },
    { code: "lost", name: "Lost", position: 6, probability: 0, forecastCategory: "closed", entryRequirements: {} },
  ],
};

const STAGE_CODE = /^[a-z][a-z0-9_-]{0,62}$/;
const FORECAST_CATEGORIES = ["pipeline", "best_case", "commit", "closed"] as const;
const ENTRY_REQUIREMENTS = ["amount", "expectedCloseAt", "nextAction", "owner", "stakeholders", "discovery"] as const;

/** The kit's sales pipeline, validated; a kit without one gets the default. Malformed configuration is an error, never a silent gap. */
export function parseSalesPipelineTemplate(value: unknown): SalesPipelineTemplate {
  if (value === undefined || value === null) return DEFAULT_SALES_PIPELINE;
  const fail = (reason: string): never => { throw new BadRequestException(`The firm kit's salesPipeline is invalid: ${reason}`); };
  if (typeof value !== "object" || Array.isArray(value)) return fail("expected an object");
  const input = value as Record<string, unknown>;
  const code = typeof input.code === "string" ? input.code.trim().toLowerCase() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!STAGE_CODE.test(code)) return fail("code");
  if (!name || name.length > 160) return fail("name");
  if (!Array.isArray(input.stages) || !input.stages.length) return fail("at least one stage is needed");
  const stages = input.stages.map((raw, index): SalesPipelineStageTemplate => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail(`stage ${index + 1}`);
    const stage = raw as Record<string, unknown>;
    const stageCode = typeof stage.code === "string" ? stage.code.trim().toLowerCase() : "";
    const stageName = typeof stage.name === "string" ? stage.name.trim() : "";
    if (!STAGE_CODE.test(stageCode)) return fail(`stage ${index + 1} code`);
    if (!stageName || stageName.length > 160) return fail(`stage ${index + 1} name`);
    if (!Number.isInteger(stage.position) || Number(stage.position) < 0) return fail(`stage ${stageCode} position`);
    if (typeof stage.probability !== "number" || stage.probability < 0 || stage.probability > 100) return fail(`stage ${stageCode} probability`);
    if (!FORECAST_CATEGORIES.includes(stage.forecastCategory as never)) return fail(`stage ${stageCode} forecast category`);
    const requirements = stage.entryRequirements ?? {};
    if (typeof requirements !== "object" || Array.isArray(requirements)) return fail(`stage ${stageCode} entry requirements`);
    const entryRequirements: Record<string, boolean> = {};
    for (const [key, flag] of Object.entries(requirements as Record<string, unknown>)) {
      if (!ENTRY_REQUIREMENTS.includes(key as never) || typeof flag !== "boolean") return fail(`stage ${stageCode} entry requirement ${key}`);
      entryRequirements[key] = flag;
    }
    return { code: stageCode, name: stageName, position: Number(stage.position), probability: stage.probability, forecastCategory: stage.forecastCategory as SalesPipelineStageTemplate["forecastCategory"], entryRequirements };
  });
  if (new Set(stages.map((stage) => stage.code)).size !== stages.length) return fail("stage codes must be unique");
  if (new Set(stages.map((stage) => stage.position)).size !== stages.length) return fail("stage positions must be unique");
  return { code, name, stages };
}

/**
 * Gives a workspace its default Sales pipeline unless it already has a usable one (active, with an
 * active stage). Runs inside the workspace's tenant transaction. Idempotent: a pipeline with the
 * template's code is reused (and reactivated) rather than duplicated.
 */
export async function seedDefaultSalesPipeline(
  db: Pick<PoolClient, "query">,
  workspaceId: string,
  template: SalesPipelineTemplate = DEFAULT_SALES_PIPELINE,
): Promise<{ pipelineId: string; created: boolean }> {
  const usable = await db.query<{ id: string }>(
    `SELECT pipeline.id FROM crm_pipelines pipeline
      WHERE pipeline.workspace_id = $1 AND pipeline.status = 'active'
        AND EXISTS (SELECT 1 FROM crm_pipeline_stages stage
                     WHERE stage.workspace_id = pipeline.workspace_id AND stage.pipeline_id = pipeline.id AND stage.status = 'active')
      ORDER BY pipeline.is_default DESC, pipeline.created_at, pipeline.id
      LIMIT 1`,
    [workspaceId],
  );
  if (usable.rowCount) return { pipelineId: usable.rows[0].id, created: false };
  await db.query(`UPDATE crm_pipelines SET is_default = false, version = version + 1 WHERE workspace_id = $1 AND is_default`, [workspaceId]);
  const pipeline = await db.query<{ id: string }>(
    `INSERT INTO crm_pipelines (workspace_id, code, name, is_default, status)
     VALUES ($1, $2, $3, true, 'active')
     ON CONFLICT (workspace_id, code) DO UPDATE
       SET is_default = true, status = 'active', version = crm_pipelines.version + 1, updated_at = now()
     RETURNING id`,
    [workspaceId, template.code, template.name],
  );
  const pipelineId = pipeline.rows[0].id;
  for (const stage of template.stages) {
    await db.query(
      `INSERT INTO crm_pipeline_stages
         (workspace_id, pipeline_id, code, name, position, probability, forecast_category, entry_requirements)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING`,
      [workspaceId, pipelineId, stage.code, stage.name, stage.position, stage.probability, stage.forecastCategory, JSON.stringify(stage.entryRequirements)],
    );
  }
  await db.query(`UPDATE crm_pipeline_stages SET status = 'active', version = version + 1 WHERE workspace_id = $1 AND pipeline_id = $2 AND status <> 'active'`, [workspaceId, pipelineId]);
  return { pipelineId, created: true };
}
