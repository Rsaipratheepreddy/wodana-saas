import { describe, expect, it } from "vitest";
import { builtInProjectWorkflow, parseProjectWorkflowTemplate } from "./project-workflow";
import { palmProjectWorkflowTemplate } from "./palm-project-workflow";
import { emptyProject, applyExecution, type ExecutionActor } from "./execution.domain";
import { projectWorkflowGateResults } from "./project-workflow";

const base = builtInProjectWorkflow();

describe("Palm Deal project stages", () => {
  it("keeps one Project Ref and the full design-to-delivery sequence", () => {
    const template = palmProjectWorkflowTemplate(base, {
      design: true, mainQuotation: true, materialSelection: true, procurement: true,
      manufacturing: true, siteWorks: true, installation: true,
    });
    expect(template.stages.map(stage => stage.key)).toEqual([
      "deal_file", "site_visit", "design_specifications", "main_quote", "main_qs_review",
      "main_client_approval", "main_agreement_payment", "material_list_signoff",
      "procurement", "manufacturing_readiness", "factory_production",
      "site_works", "installation", "snagging", "completed",
    ]);
    expect(template.stages.filter(stage => stage.releaseStart).map(stage => stage.key)).toEqual(["procurement"]);
    expect(template.stages.find(stage => stage.key === "snagging")?.exitGates).toEqual([
      "all_tasks_closed", "all_snags_closed", "all_handovers_accepted", "finance_closed",
    ]);
    expect(() => parseProjectWorkflowTemplate(template)).not.toThrow();
  });

  it("ends a moodboards-only project after design", () => {
    const template = palmProjectWorkflowTemplate(base, {
      design: true, mainQuotation: false, materialSelection: false, procurement: false,
      manufacturing: false, siteWorks: false, installation: false,
    });
    expect(template.stages.map(stage => stage.key)).toEqual(["deal_file", "site_visit", "design_specifications", "completed"]);
    expect(template.stages.find(stage => stage.key === "site_visit")?.exitGates).toEqual(["site_visit_recorded"]);
    expect(template.stages.some(stage => stage.releaseStart)).toBe(false);
    expect(() => parseProjectWorkflowTemplate(template)).not.toThrow();
  });

  it("requires a post-payment visit record before detailed design", () => {
    const template = palmProjectWorkflowTemplate(base, {
      design: true, mainQuotation: false, materialSelection: false, procurement: false,
      manufacturing: false, siteWorks: false, installation: false,
    });
    const data = emptyProject();
    data.workflow = {
      template: { id: template.id, code: template.code, name: template.name, version: template.version, source: template.source, stages: template.stages },
      currentStageKey: "site_visit", currentStageStartedAt: "2026-09-24T00:00:00Z", history: [],
    };
    const gate = template.stages.find(stage => stage.key === "site_visit")!;
    expect(projectWorkflowGateResults(data, gate)[0].passed).toBe(false);
    const actor: ExecutionActor = { id: "manager", userId: "manager", name: "Manager", manage: true, review: true, report: true, buy: true, memberIds: [], resourceIds: [], now: "2026-09-24T10:00:00Z", released: false };
    applyExecution(data, "record_site_visit", { visitedOn: "2026-09-24", scopeSummary: "Confirm living room and bedrooms", evidenceReference: "Visit note #1", feeReviewNote: "Additional room needs fee review" }, actor);
    expect(projectWorkflowGateResults(data, gate)[0].passed).toBe(true);
    expect(data.siteVisit?.feeReviewNote).toContain("fee review");
  });

  it("completes signed-off design work without inventing installation handovers", () => {
    const template = palmProjectWorkflowTemplate(base, {
      design: true, mainQuotation: false, materialSelection: false, procurement: false,
      manufacturing: false, siteWorks: false, installation: false,
    });
    const data = emptyProject();
    data.phase = "active";
    data.workflow = {
      template: { id: template.id, code: template.code, name: template.name, version: template.version, source: template.source, stages: template.stages },
      currentStageKey: "design_specifications", currentStageStartedAt: "2026-09-24T00:00:00Z", history: [],
    };
    const actor: ExecutionActor = { id: "member", userId: "user", name: "Owner", manage: true, review: true, report: true, buy: true, memberIds: [], resourceIds: [], now: "2026-09-24T01:00:00Z", released: false, designOnlySignedOff: true };
    expect(() => applyExecution(data, "complete_project", { note: "Client approved design" }, actor)).not.toThrow();
    expect(data.phase).toBe("completed");
    expect(data.workflow.currentStageKey).toBe("completed");
  });

  it("skips design and factory for ready-made furniture", () => {
    const template = palmProjectWorkflowTemplate(base, {
      design: false, mainQuotation: true, materialSelection: false, procurement: true,
      manufacturing: false, siteWorks: false, installation: true,
    });
    expect(template.stages.map(stage => stage.key)).toEqual([
      "deal_file", "procurement", "installation", "snagging", "completed",
    ]);
    expect(() => parseProjectWorkflowTemplate(template)).not.toThrow();
  });
});
