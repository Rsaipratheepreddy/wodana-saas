import { describe, expect, it } from "vitest";
import { checkPasses, DEFAULT_ROLES, parseStages, TASK_CHECKS, type CheckFacts } from "./project-checks";
import { assertDecidable, assertSendable, canStartRevision, drawingFacts, routeHolds } from "./project-drawings";
import { stageTaskAssignee, stageTaskLinks } from "./project-stage-tasks";

const facts = (over: Partial<CheckFacts> = {}): CheckFacts => ({
  filledRoles: new Set(), confirmed: new Set(), productionPaid: false, materialsSignedOff: false, everythingOrdered: false, everythingMade: false,
  openSnags: 0, openCriticalSnags: 0, handedOver: false, ...over,
});

describe("technical drawings to production release", () => {
  it("reads the stage checks from the latest revision: sent back means the drawings are due again", () => {
    expect(drawingFacts(null)).toEqual({ uploaded: false, siteChecked: false, approved: false });
    expect(drawingFacts({ status: "uploaded", siteCheck: null, drawingFiles: 0 })).toEqual({ uploaded: false, siteChecked: false, approved: false });
    expect(drawingFacts({ status: "uploaded", siteCheck: null, drawingFiles: 2 })).toEqual({ uploaded: true, siteChecked: false, approved: false });
    expect(drawingFacts({ status: "changes_needed", siteCheck: "changes", drawingFiles: 2 })).toEqual({ uploaded: false, siteChecked: false, approved: false });
    expect(drawingFacts({ status: "checked", siteCheck: "ok", drawingFiles: 2 })).toEqual({ uploaded: true, siteChecked: true, approved: false });
    expect(drawingFacts({ status: "sent", siteCheck: "ok", drawingFiles: 2 })).toEqual({ uploaded: true, siteChecked: true, approved: false });
    expect(drawingFacts({ status: "approved", siteCheck: "ok", drawingFiles: 2 })).toEqual({ uploaded: true, siteChecked: true, approved: true });
    expect(drawingFacts({ status: "changes_requested", siteCheck: "ok", drawingFiles: 2 })).toEqual({ uploaded: false, siteChecked: false, approved: false });
  });

  it("starts a new revision only once the latest is decided", () => {
    expect(canStartRevision(null)).toBe(true);
    for (const status of ["changes_needed", "changes_requested", "approved"] as const) expect(canStartRevision({ status })).toBe(true);
    for (const status of ["uploaded", "checked", "sent"] as const) expect(canStartRevision({ status })).toBe(false);
  });

  it("sends drawings to the client only after the site check when the route asks for one", () => {
    expect(() => assertSendable({ status: "uploaded", number: 1, drawingFiles: 0 }, false)).toThrow("Upload the drawings first.");
    expect(() => assertSendable({ status: "uploaded", number: 1, drawingFiles: 3 }, true)).toThrow("Record the technical site check first.");
    expect(() => assertSendable({ status: "uploaded", number: 1, drawingFiles: 3 }, false)).not.toThrow();
    expect(() => assertSendable({ status: "checked", number: 1, drawingFiles: 3 }, true)).not.toThrow();
    expect(() => assertSendable({ status: "changes_needed", number: 1, drawingFiles: 3 }, true)).toThrow("can't be sent now");
    expect(() => assertSendable({ status: "sent", number: 2, drawingFiles: 3 }, true)).toThrow("already with the client");
  });

  it("records the client's decision only on drawings with them, for a day between sending and today", () => {
    const sent = { status: "sent" as const, number: 1, sentOn: "2026-10-01" };
    expect(() => assertDecidable(sent, "2026-10-03", "2026-10-06")).not.toThrow();
    expect(() => assertDecidable(sent, "2026-10-07", "2026-10-06")).toThrow("future");
    expect(() => assertDecidable(sent, "2026-09-30", "2026-10-06")).toThrow("before the drawings were sent");
    expect(() => assertDecidable({ ...sent, status: "checked" }, "2026-10-03", "2026-10-06")).toThrow("aren't waiting for the client");
  });

  it("follows the route: a skipped stage doesn't ask for the client's approval", () => {
    const route = [{ status: "done", checks: [{ key: "lead", kind: "lead_assigned" as const }] }, { status: "skipped", checks: [{ key: "ok", kind: "drawings_client_approved" as const }] }];
    expect(routeHolds(route, ["drawings_client_approved"])).toBe(false);
    expect(routeHolds([...route, { status: "upcoming", checks: [{ key: "slot", kind: "factory_slot_booked" as const }] }], ["factory_slot_booked"])).toBe(true);
  });

  it("lets a route ask for the drawings, the site check, the client's approval and the factory slot, each read from its record", () => {
    const stages = parseStages([
      { name: "Kickoff", ownerRole: "project_manager", checks: [{ kind: "lead_assigned" }, { kind: "factory_slot_booked" }] },
      { name: "Technical drawings", ownerRole: "technical_designer", checks: [{ kind: "drawings_uploaded" }, { kind: "drawings_site_checked" }, { kind: "drawings_client_approved" }] },
    ], DEFAULT_ROLES);
    expect(stages[1].checks.map((check) => check.kind)).toEqual(["drawings_uploaded", "drawings_site_checked", "drawings_client_approved"]);
    expect(stages[1].checks.every((check) => TASK_CHECKS.includes(check.kind))).toBe(true);
    const [uploaded, checked, approved] = stages[1].checks;
    expect(checkPasses(uploaded, facts())).toBe(false);
    expect(checkPasses(uploaded, facts({ drawings: { uploaded: true, siteChecked: false, approved: false } }))).toBe(true);
    expect(checkPasses(checked, facts({ drawings: { uploaded: true, siteChecked: true, approved: false } }))).toBe(true);
    expect(checkPasses(approved, facts({ drawings: { uploaded: true, siteChecked: true, approved: false } }))).toBe(false);
    expect(checkPasses(stages[0].checks[1], facts({ factorySlotBooked: true }))).toBe(true);
  });

  it("gives each task to its person: the technical drawer, the project manager for the client's approval, the factory lead for the slot", () => {
    const team = [
      { membershipId: "pm", name: "Omar", roles: ["project_manager"], lead: true },
      { membershipId: "tech", name: "Tara", roles: ["technical_designer"], lead: false },
      { membershipId: "factory", name: "Faris", roles: ["factory_lead"], lead: false },
    ];
    expect(stageTaskAssignee("drawings_uploaded", "technical_designer", team)).toBe("tech");
    expect(stageTaskAssignee("drawings_site_checked", "technical_designer", team)).toBe("tech");
    expect(stageTaskAssignee("drawings_client_approved", "technical_designer", team)).toBe("pm");
    expect(stageTaskAssignee("factory_slot_booked", "project_manager", team)).toBe("factory");
    // Nobody holds the role yet: the project manager has it.
    expect(stageTaskAssignee("drawings_uploaded", "technical_designer", [team[0]])).toBe("pm");
  });

  it("links the drawings task to the site's measurements, the material list and the designer's details", () => {
    const links = stageTaskLinks("drawings_uploaded", { id: "p1", caseId: "c1" });
    expect(links.map((link) => link.key)).toEqual(["drawings", "measurements", "materials", "designs"]);
    expect(links.find((link) => link.key === "measurements")?.href).toBe("/workspace/pre-projects/cases/c1/measurements");
    expect(stageTaskLinks(null, { id: "p1", caseId: "c1" })).toEqual([]);
  });
});
