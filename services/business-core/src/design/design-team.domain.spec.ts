import { describe, expect, it } from "vitest";
import { allocationMissing, allocationSlots, DEFAULT_DESIGN_TEAM, designerPairProblem, settableSlots, slotSetters, teamConfigProblem } from "./design-team.domain";
import { agreedRate } from "./design-packages.domain";

describe("the design team of a job (PLM-151)", () => {
  const nobody = { admin: false, accountManager: false, reviewer: false, leadDesigner: false, technicalLead: false };

  it("lets the Account Manager allocate the designers and the Sales Admin, the lead tag the Visualiser and the technical lead tag the Draftsman", () => {
    expect(settableSlots({ ...nobody, accountManager: true }, false)).toEqual(["lead_designer", "junior_designer", "sales_admin", "material_coordinator"]);
    expect(settableSlots({ ...nobody, leadDesigner: true }, false)).toEqual(["visualiser", "material_coordinator"]);
    expect(settableSlots({ ...nobody, technicalLead: true }, false)).toEqual(["draftsman"]);
    expect(settableSlots(nobody, false)).toEqual([]);
    expect(settableSlots({ ...nobody, admin: true }, true).length).toBe(6);
  });

  it("gives the lead designer's choice to the package's reviewer when the package has one (PLM-145)", () => {
    expect(slotSetters("lead_designer", true)).toEqual(["reviewer"]);
    expect(settableSlots({ ...nobody, accountManager: true }, true)).toEqual(["junior_designer", "sales_admin", "material_coordinator"]);
    expect(settableSlots({ ...nobody, reviewer: true }, true)).toEqual(["lead_designer"]);
  });

  it("is allocated once the lead has a person and every other configured slot a person or 'not needed'", () => {
    const team = new Map<string, { membershipId: string | null; notApplicable: boolean }>();
    expect(allocationMissing(DEFAULT_DESIGN_TEAM, team)).toEqual(["lead_designer", "junior_designer", "sales_admin"]);
    team.set("designer", { membershipId: "m1", notApplicable: false });
    team.set("junior_designer", { membershipId: null, notApplicable: true });
    expect(allocationMissing(DEFAULT_DESIGN_TEAM, team)).toEqual(["sales_admin"]);
    team.set("sales_admin", { membershipId: "m2", notApplicable: false });
    expect(allocationMissing(DEFAULT_DESIGN_TEAM, team)).toEqual([]);
    // A firm without a junior designer or a Sales Admin per job only allocates the lead.
    expect(allocationSlots({ ...DEFAULT_DESIGN_TEAM, junior_designer: null, sales_admin: null })).toEqual(["lead_designer"]);
  });

  it("checks the role keys a firm configures", () => {
    expect(teamConfigProblem({ lead_designer: "" })).toBe("Choose the lead designer's role");
    expect(teamConfigProblem({ lead_designer: "Lead Designer" })).toBe("Use a role key of lower-case letters, numbers and underscores");
    expect(teamConfigProblem({ lead_designer: "designer", junior_designer: "designer" })).toBe("Give each part of the design team its own role");
    expect(teamConfigProblem({ ...DEFAULT_DESIGN_TEAM })).toBeNull();
  });

  it("refuses the same person as both the lead and the junior designer, in the firm's words", () => {
    const labels = { lead: "Lead Interior Designer", junior: "Junior Interior Designer" };
    expect(designerPairProblem("m1", "m1", labels)).toBe("The Lead Interior Designer and the Junior Interior Designer must be different people. Choose someone else.");
    expect(designerPairProblem("m1", "m2", labels)).toBeNull();
    // Nobody yet in one of them (or "not needed on this job"): nothing to compare.
    expect(designerPairProblem("m1", null, labels)).toBeNull();
    expect(designerPairProblem(null, null, labels)).toBeNull();
  });
});

describe("a design rate above the package's starting rate (PLM-139)", () => {
  const creativeDirector = { rate: "100.00", rateFrom: true };
  it("uses the package rate until a higher agreed rate is approved", () => {
    expect(agreedRate(creativeDirector, null, false)).toEqual({ rate: "100.00", needsApproval: false });
    expect(agreedRate(creativeDirector, "100", false)).toEqual({ rate: "100.00", needsApproval: false });
    expect(agreedRate(creativeDirector, "90", false)).toEqual({ rate: "100.00", needsApproval: false });
    expect(agreedRate(creativeDirector, "125.50", false)).toEqual({ rate: "100.00", needsApproval: true });
    expect(agreedRate(creativeDirector, "125.50", true)).toEqual({ rate: "125.50", needsApproval: false });
    // A package with a set rate (Bespoke at 40 per sq ft) never takes another one.
    expect(agreedRate({ rate: "40.00", rateFrom: false }, "55", true)).toEqual({ rate: "40.00", needsApproval: false });
  });
});
