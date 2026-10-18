import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SALES_PIPELINE, parseSalesPipelineTemplate, seedDefaultSalesPipeline } from "./default-sales-pipeline";

describe("default sales pipeline", () => {
  it("opens with the standard stages a deal goes through, won and lost last", () => {
    expect(DEFAULT_SALES_PIPELINE.code).toBe("sales");
    expect(DEFAULT_SALES_PIPELINE.stages.map((stage) => stage.code)).toEqual(["qualified", "intro_booked", "qualification", "proposal", "negotiation", "won", "lost"]);
    expect(DEFAULT_SALES_PIPELINE.stages.map((stage) => stage.name)).toEqual(["New Opportunity", "Intro booked", "Qualified", "Proposal", "Negotiation", "Won", "Lost"]);
    expect(DEFAULT_SALES_PIPELINE.stages[0].entryRequirements).toEqual({ owner: true, nextAction: true });
  });

  it("reads a kit's pipeline, defaults when the kit has none and refuses a broken one", () => {
    expect(parseSalesPipelineTemplate(undefined)).toBe(DEFAULT_SALES_PIPELINE);
    const kit = parseSalesPipelineTemplate({ code: "Joinery", name: " Joinery sales ", stages: [
      { code: "Quote", name: "Quote", position: 1, probability: 30, forecastCategory: "pipeline" },
      { code: "sample", name: "Sample approved", position: 2, probability: 70, forecastCategory: "commit", entryRequirements: { amount: true } },
    ] });
    expect(kit).toEqual({ code: "joinery", name: "Joinery sales", stages: [
      { code: "quote", name: "Quote", position: 1, probability: 30, forecastCategory: "pipeline", entryRequirements: {} },
      { code: "sample", name: "Sample approved", position: 2, probability: 70, forecastCategory: "commit", entryRequirements: { amount: true } },
    ] });
    const stage = { code: "a", name: "A", position: 1, probability: 10, forecastCategory: "pipeline" };
    expect(() => parseSalesPipelineTemplate("sales")).toThrow(BadRequestException);
    expect(() => parseSalesPipelineTemplate({ code: "sales", name: "Sales", stages: [] })).toThrow(/at least one stage/);
    expect(() => parseSalesPipelineTemplate({ code: "sales", name: "Sales", stages: [stage, { ...stage, position: 2 }] })).toThrow(/unique/);
    expect(() => parseSalesPipelineTemplate({ code: "sales", name: "Sales", stages: [stage, { ...stage, code: "b" }] })).toThrow(/positions must be unique/);
    expect(() => parseSalesPipelineTemplate({ code: "sales", name: "Sales", stages: [{ ...stage, probability: 101 }] })).toThrow(/probability/);
    expect(() => parseSalesPipelineTemplate({ code: "sales", name: "Sales", stages: [{ ...stage, forecastCategory: "maybe" }] })).toThrow(/forecast/);
    expect(() => parseSalesPipelineTemplate({ code: "sales", name: "Sales", stages: [{ ...stage, entryRequirements: { budget: true } }] })).toThrow(/entry requirement/);
  });

  it("leaves a workspace that already has a usable pipeline alone", async () => {
    const query = vi.fn(async (sql: string) => sql.includes("FROM crm_pipelines pipeline") ? { rowCount: 1, rows: [{ id: "existing" }] } : { rowCount: 0, rows: [] });
    await expect(seedDefaultSalesPipeline({ query } as never, "ws")).resolves.toEqual({ pipelineId: "existing", created: false });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("creates the pipeline as the default with every stage when there is none", async () => {
    const query = vi.fn(async (sql: string) => sql.includes("INSERT INTO crm_pipelines") ? { rowCount: 1, rows: [{ id: "new" }] } : { rowCount: 0, rows: [] });
    await expect(seedDefaultSalesPipeline({ query } as never, "ws")).resolves.toEqual({ pipelineId: "new", created: true });
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.filter((sql) => sql.includes("INSERT INTO crm_pipeline_stages"))).toHaveLength(DEFAULT_SALES_PIPELINE.stages.length);
    expect(statements.find((sql) => sql.includes("INSERT INTO crm_pipelines"))).toContain("ON CONFLICT (workspace_id, code) DO UPDATE");
    expect(query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO crm_pipelines"))?.[1]).toEqual(["ws", "sales", "Sales"]);
  });
});
