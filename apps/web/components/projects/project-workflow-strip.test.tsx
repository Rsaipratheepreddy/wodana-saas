import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { ProjectState } from "@/lib/projects/execution";
import { ProjectWorkflowStrip } from "./project-workflow-strip";

const makeState = (overrides: Record<string, unknown> = {}) => ({
  caseId: "case-1",
  canManage: true,
  canReview: true,
  commercialReady: true,
  data: {
    controls: { onHold: false },
    workflow: {
      currentStageKey: "procurement",
      template: { stages: [
        { key: "requirements", visibleName: "Requirements", phase: "planning" },
        { key: "procurement", visibleName: "Procurement", phase: "active", releaseStart: true },
        { key: "ready_for_manufacturing", visibleName: "Ready for Manufacturing", phase: "active" },
        { key: "completed", visibleName: "Completed", phase: "completed" },
      ] },
    },
  },
  workflowSummary: {
    currentStageKey: "procurement",
    currentStageName: "Procurement",
    ownerRole: "procurement_production",
    ownerId: "member-1",
    nextStage: { key: "ready_for_manufacturing", name: "Ready for Manufacturing" },
    exitGates: [{ key: "production_plan_ready", passed: true }],
  },
  ...overrides,
}) as unknown as ProjectState;

function renderStrip(state: ProjectState, run = vi.fn().mockResolvedValue(true)) {
  render(<DesignSystemProvider><ProjectWorkflowStrip state={state} busy={false} run={run} /></DesignSystemProvider>);
  return run;
}

describe("project workflow strip", () => {
  it("moves to the next delivery stage and links approved planning evidence", async () => {
    const run = renderStrip(makeState());
    expect(screen.getByText(/Approved planning and quotation are linked/)).toBeVisible();
    const button = screen.getByRole("button", { name: "Move to Ready for Manufacturing" });
    await userEvent.setup().click(button);
    expect(run).toHaveBeenCalledWith("workflow_transition", { toStageKey: "ready_for_manufacturing", note: "" });
  });

  it("blocks stage movement until commercial release and the exit gates are ready", () => {
    const state = makeState({
      commercialReady: false,
      workflowSummary: {
        currentStageKey: "procurement",
        currentStageName: "Procurement",
        ownerRole: "procurement_production",
        ownerId: "member-1",
        nextStage: { key: "ready_for_manufacturing", name: "Ready for Manufacturing" },
        exitGates: [{ key: "production_plan_ready", passed: false }],
      },
    });
    renderStrip(state);
    expect(screen.getByText("Complete commercial release first")).toBeVisible();
    expect(screen.getByRole("button", { name: "Move to Ready for Manufacturing" })).toBeDisabled();
  });

  it("shows the production-readiness reason when the released stage is blocked", () => {
    const state = makeState({
      workflowSummary: {
        currentStageKey: "procurement",
        currentStageName: "Procurement",
        ownerRole: "procurement_production",
        ownerId: "member-1",
        nextStage: { key: "ready_for_manufacturing", name: "Ready for Manufacturing" },
        exitGates: [{ key: "production_plan_ready", passed: false }],
      },
    });
    renderStrip(state);
    expect(screen.getByText("Make production packages ready")).toBeVisible();
    expect(screen.getByRole("button", { name: "Move to Ready for Manufacturing" })).toBeDisabled();
  });
  it("allows Palm design work after the paid Deal and explains the next commercial gate", async () => {
    const state = makeState({
      commercialReady: false,
      data: {
        controls: { onHold: false },
        workflow: { currentStageKey: "deal_file", template: { code: "palm_design_build_delivery", stages: [
          { key: "deal_file", visibleName: "Deal File", phase: "planning" },
          { key: "design_specifications", visibleName: "Design & specifications", phase: "active" },
          { key: "procurement", visibleName: "Procurement", phase: "active", releaseStart: true },
          { key: "completed", visibleName: "Client handover", phase: "completed" },
        ] } },
      },
      workflowSummary: { currentStageKey: "deal_file", currentStageName: "Deal File", ownerRole: null, ownerId: null, nextStage: { key: "design_specifications", name: "Design & specifications" }, exitGates: [] },
    });
    const run = renderStrip(state);
    await userEvent.setup().click(screen.getByRole("button", { name: "Move to Design & specifications" }));
    expect(run).toHaveBeenCalledWith("workflow_transition", { toStageKey: "design_specifications", note: "" });
  });
  it("keeps design blocked until the post-payment site visit is recorded", async () => {
    const state = makeState({
      commercialReady: false,
      data: {
        controls: { onHold: false },
        workflow: { currentStageKey: "site_visit", template: { code: "palm_design_build_delivery", stages: [
          { key: "deal_file", visibleName: "Deal File", phase: "planning" },
          { key: "site_visit", visibleName: "Site visit & scope", phase: "active" },
          { key: "design_specifications", visibleName: "Design & specifications", phase: "active" },
          { key: "completed", visibleName: "Design complete", phase: "completed" },
        ] } },
      },
      workflowSummary: { currentStageKey: "site_visit", currentStageName: "Site visit & scope", ownerRole: null, ownerId: null, nextStage: { key: "design_specifications", name: "Design & specifications" }, exitGates: [{ key: "site_visit_recorded", passed: false }] },
    });
    renderStrip(state);
    expect(screen.getByRole("button", { name: "Move to Design & specifications" })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Record site visit" }));
    expect(screen.getByRole("dialog", { name: "Site visit & design scope" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Confirmed design scope" })).toBeVisible();
  });
});
