import { describe, expect, it } from "vitest";
import { teamToCarry, type TeamChoice } from "./project-team";

const roles = ["project_manager", "account_manager", "designer", "quantity_surveyor", "factory_lead"];
const person = (membershipId: string): TeamChoice => ({ membershipId, notApplicable: false });
const none: TeamChoice = { membershipId: null, notApplicable: true };

describe("teamToCarry (PLM-100 / PLM-089)", () => {
  it("carries each tagged role, person or not applicable, into the next record", () => {
    const source = new Map([["designer", person("d")], ["quantity_surveyor", none], ["account_manager", person("a")]]);
    expect(teamToCarry(roles, new Set(), source)).toEqual([
      { role: "account_manager", membershipId: "a", notApplicable: false },
      { role: "designer", membershipId: "d", notApplicable: false },
      { role: "quantity_surveyor", membershipId: null, notApplicable: true },
    ]);
  });

  it("never overwrites a role someone already settled, and is a no-op the second time", () => {
    const source = new Map([["designer", person("d")], ["factory_lead", person("f")]]);
    const first = teamToCarry(roles, new Set(["designer"]), source);
    expect(first).toEqual([{ role: "factory_lead", membershipId: "f", notApplicable: false }]);
    expect(teamToCarry(roles, new Set(["designer", "factory_lead"]), source)).toEqual([]);
  });

  it("only carries the workspace's own roles, and never makes the project manager not applicable", () => {
    const source = new Map([["visualiser", person("v")], ["project_manager", none]]);
    expect(teamToCarry(roles, new Set(), source)).toEqual([]);
    expect(teamToCarry([...roles, "visualiser"], new Set(), source)).toEqual([{ role: "visualiser", membershipId: "v", notApplicable: false }]);
  });
});
