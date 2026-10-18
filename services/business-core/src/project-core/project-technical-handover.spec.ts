import { describe, expect, it } from "vitest";
import { checkPasses, type CheckFacts } from "./project-checks";
import { acceptable, HANDOVER_ITEMS, missingItems } from "./project-technical-handover";

describe("PLM-165: the technical handover pack's checklist", () => {
  it("lists the checklist items a line is still missing, less those marked not applicable", () => {
    const cells = { picture: { state: "missing" as const }, size: { state: "missing" as const }, materials: { state: "done" as const }, selection: { state: "not_needed" as const } };
    expect(missingItems(cells, [])).toEqual(["picture", "size"]);
    expect(missingItems(cells, ["size"])).toEqual(["picture"]);
    // Waiting (in hand, not finished) isn't missing; a waiver of a done item changes nothing.
    expect(missingItems({ ...cells, picture: { state: "waiting", note: "sent" } }, ["materials"])).toEqual(["size"]);
    expect(HANDOVER_ITEMS).toEqual(["picture", "size", "materials", "selection"]);
  });

  it("accepts the pack only once it was handed over and nothing required is missing", () => {
    expect(acceptable({ status: "draft", missing: 0 })).toEqual({ ok: false, reason: "not_handed_over" });
    expect(acceptable({ status: "handed_over", missing: 2 })).toEqual({ ok: false, reason: "missing" });
    expect(acceptable({ status: "handed_over", missing: 0 })).toEqual({ ok: true });
    expect(acceptable({ status: "accepted", missing: 0 })).toEqual({ ok: false, reason: "already_accepted" });
  });
});

describe("PLM-174: the path E checks on a project's route", () => {
  const facts = (bespoke: CheckFacts["bespoke"]): CheckFacts => ({
    filledRoles: new Set(), confirmed: new Set(), productionPaid: true, materialsSignedOff: true, everythingOrdered: true, everythingMade: false, openSnags: 0, openCriticalSnags: 0, handedOver: false, bespoke,
  });

  it("holds on a bespoke job until the handover is accepted, the requirements are settled and QS approved", () => {
    const open = facts({ technicalHandoverAccepted: false, factoryRequirementsConfirmed: false, qsApproved: true });
    expect(checkPasses({ key: "h", kind: "technical_handover_accepted" }, open)).toBe(false);
    expect(checkPasses({ key: "r", kind: "factory_requirements_confirmed" }, open)).toBe(false);
    expect(checkPasses({ key: "q", kind: "qs_approved" }, open)).toBe(true);
    const done = facts({ technicalHandoverAccepted: true, factoryRequirementsConfirmed: true, qsApproved: true });
    expect(checkPasses({ key: "h", kind: "technical_handover_accepted" }, done)).toBe(true);
    expect(checkPasses({ key: "r", kind: "factory_requirements_confirmed" }, done)).toBe(true);
  });

  it("passes by itself on a job that isn't bespoke: the checks are about made-to-order work", () => {
    for (const kind of ["technical_handover_accepted", "factory_requirements_confirmed", "qs_approved"] as const) expect(checkPasses({ key: kind, kind }, facts(null))).toBe(true);
  });
});
