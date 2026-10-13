import { describe, expect, it } from "vitest";
import { checkPasses, DEFAULT_ROLES, orderDrawingLine, parseStages, TASK_CHECKS, type CheckFacts, type StageCheck } from "./project-checks";
import { drawingOnlyStage } from "./project-drawing-needs";
import { assertSendable, drawingFacts, drawingsClientRoleOf, routeDrawingCheck } from "./project-drawings";
import { stageTaskAssignee, stageTaskLinks } from "./project-stage-tasks";
import { parseMeasure } from "./project-technical-measure";

const facts = (over: Partial<CheckFacts> = {}): CheckFacts => ({
  filledRoles: new Set(), confirmed: new Set(), productionPaid: false, materialsSignedOff: false, everythingOrdered: false, everythingMade: false,
  openSnags: 0, openCriticalSnags: 0, handedOver: false, ...over,
});
const check = (kind: StageCheck["kind"], key = kind): StageCheck => ({ key, kind });

describe("PLM-149: the technical site measure before shop drawings", () => {
  it("runs the drawing line in its own order, whatever order the stage lists it in, and leaves other checks in place", () => {
    const listed = [check("factory_slot_booked"), check("drawings_uploaded"), check("drawings_client_approved"), check("drawings_design_checked"), check("technical_measure_done")];
    expect(orderDrawingLine(listed).map((item) => item.kind))
      .toEqual(["factory_slot_booked", "technical_measure_done", "drawings_uploaded", "drawings_design_checked", "drawings_client_approved"]);
    expect(TASK_CHECKS.indexOf("technical_measure_done")).toBe(0);
  });

  it("saves a route with the measure first and refuses one that asks for both the site check and the design check", () => {
    const stages = parseStages([
      { name: "Kickoff", ownerRole: "project_manager", checks: [{ kind: "lead_assigned" }] },
      { name: "Technical drawings", ownerRole: "technical_designer", checks: [{ kind: "drawings_uploaded" }, { kind: "drawings_design_checked" }, { kind: "drawings_client_approved" },
        { kind: "technical_measure_done" }] },
    ], DEFAULT_ROLES);
    expect(stages[1].checks.map((item) => item.kind)).toEqual(["technical_measure_done", "drawings_uploaded", "drawings_design_checked", "drawings_client_approved"]);
    expect(() => parseStages([
      { name: "A", ownerRole: "project_manager", checks: [{ kind: "drawings_site_checked" }] },
      { name: "B", ownerRole: "project_manager", checks: [{ kind: "drawings_design_checked" }] },
    ], DEFAULT_ROLES)).toThrow("not both");
    // A stage of only the measure and drawing checks still skips itself when no item needs drawings.
    expect(drawingOnlyStage({ checks: stages[1].checks })).toBe(true);
  });

  it("reads the measure and the design check from their records", () => {
    expect(checkPasses(check("technical_measure_done"), facts())).toBe(false);
    expect(checkPasses(check("technical_measure_done"), facts({ drawings: { measured: true, uploaded: false, siteChecked: false, approved: false } }))).toBe(true);
    const designed = drawingFacts({ status: "checked", siteCheck: "ok", drawingFiles: 2, checkKind: "design" }, true);
    expect(designed).toEqual({ measured: true, uploaded: true, siteChecked: false, designChecked: true, approved: false });
    expect(checkPasses(check("drawings_design_checked"), facts({ drawings: designed }))).toBe(true);
    // A design check sent back is no check: the next revision is checked again.
    expect(drawingFacts({ status: "changes_needed", siteCheck: "changes", drawingFiles: 2, checkKind: "design" }, true).designChecked).toBe(false);
    // An older revision checked on site stays a site check.
    expect(drawingFacts({ status: "sent", siteCheck: "ok", drawingFiles: 2, checkKind: null }).siteChecked).toBe(true);
  });

  it("sends drawings only after the design check when the route asks for it", () => {
    expect(() => assertSendable({ status: "uploaded", number: 1, drawingFiles: 3 }, "design")).toThrow("Check the drawings match the design first.");
    expect(() => assertSendable({ status: "checked", number: 1, drawingFiles: 3 }, "design")).not.toThrow();
    const route = (kinds: Array<StageCheck["kind"]>, status = "current") => [{ status, checks: kinds.map((kind) => check(kind)) }];
    expect(routeDrawingCheck(route(["drawings_uploaded", "drawings_design_checked"]))).toBe("design");
    expect(routeDrawingCheck(route(["drawings_uploaded", "drawings_site_checked"]))).toBe("site");
    expect(routeDrawingCheck(route(["drawings_uploaded", "drawings_design_checked"], "skipped"))).toBeNull();
  });

  it("lets the firm choose who talks to the client about drawings: its role, else the designer on a design check, else the project manager", () => {
    const roles = [...DEFAULT_ROLES, { key: "lead_designer", label: "Lead interior designer" }];
    expect(drawingsClientRoleOf({ drawingsClientRole: "lead_designer", roles }, "design")).toBe("lead_designer");
    expect(drawingsClientRoleOf({ drawingsClientRole: null, roles }, "design")).toBe("designer");
    expect(drawingsClientRoleOf({ drawingsClientRole: null, roles }, "site")).toBeNull();
    // A role removed since falls back.
    expect(drawingsClientRoleOf({ drawingsClientRole: "gone", roles: DEFAULT_ROLES }, null)).toBeNull();
  });

  it("gives the measure to the project manager and the design check and the client's approval to the lead designer", () => {
    const team = [
      { membershipId: "pm", name: "Omar", roles: ["project_manager"], lead: true },
      { membershipId: "tech", name: "Tara", roles: ["technical_designer"], lead: false },
      { membershipId: "lead", name: "Lina", roles: ["lead_designer"], lead: false },
    ];
    expect(stageTaskAssignee("technical_measure_done", "technical_designer", team, "lead_designer")).toBe("pm");
    expect(stageTaskAssignee("drawings_design_checked", "technical_designer", team, "lead_designer")).toBe("lead");
    expect(stageTaskAssignee("drawings_client_approved", "technical_designer", team, "lead_designer")).toBe("lead");
    // Nobody in the role yet: the project manager does it.
    expect(stageTaskAssignee("drawings_design_checked", "technical_designer", team.slice(0, 2), "lead_designer")).toBe("pm");
    expect(stageTaskAssignee("drawings_client_approved", "technical_designer", team)).toBe("pm");
    expect(stageTaskLinks("drawings_design_checked", { id: "p1", caseId: "c1" }).map((link) => link.key)).toEqual(["drawings", "designs"]);
  });

  it("takes a measure with its day, at least one dimension and its unit", () => {
    const base = { measureId: "6f1c2a0e-1d2b-4c3d-8e4f-5a6b7c8d9e0f", measuredOn: "2026-10-12", note: " Wall A out of plumb ",
      lines: [{ area: "Kitchen", label: "Wall A width", value: 3200, unit: "mm" }] };
    expect(parseMeasure(base, "2026-10-13")).toEqual({ ...base, note: "Wall A out of plumb", lines: [{ area: "Kitchen", label: "Wall A width", value: 3200, unit: "mm" }] });
    expect(() => parseMeasure({ ...base, measuredOn: "2026-10-14" }, "2026-10-13")).toThrow("future");
    expect(() => parseMeasure({ ...base, lines: [] }, "2026-10-13")).toThrow("at least one dimension");
    expect(() => parseMeasure({ ...base, lines: [{ label: "Width", value: 0, unit: "mm" }] }, "2026-10-13")).toThrow("above zero");
    expect(() => parseMeasure({ ...base, lines: [{ label: "Width", value: 12, unit: "yard" }] }, "2026-10-13")).toThrow("choose a unit");
    expect(() => parseMeasure({ ...base, lines: [{ label: " ", value: 12, unit: "cm" }] }, "2026-10-13")).toThrow("what was measured");
    expect(() => parseMeasure({ ...base, measureId: "x" }, "2026-10-13")).toThrow("isn't valid");
  });
});
