import { describe, expect, it } from "vitest";
import { clientTypeDecided, flowOf, suggestedFlow } from "./flow-gates";

// What each step needs is tested on the interpreter (src/crm/flows); these are the shared helpers.
describe("pipeline flow vocabulary (PLM-121/122)", () => {
  it("reads flows and client types generically", () => {
    expect(flowOf("furniture")).toBe("furniture");
    expect(flowOf(null)).toBe("basic");
    expect(flowOf("something_else")).toBe("basic");
    expect(suggestedFlow("Furniture Only")).toBe("furniture");
    expect(suggestedFlow("interior_design_furniture")).toBe("design");
    expect(suggestedFlow("Concepts / Early Ideas")).toBe("design");
    expect(suggestedFlow("Renovation / Fit-Out")).toBe("fit_out");
    expect(suggestedFlow("Architecture")).toBe("basic");
    expect(clientTypeDecided("end_user")).toBe(true);
    expect(clientTypeDecided("TBC")).toBe(false);
    expect(clientTypeDecided("")).toBe(false);
    expect(clientTypeDecided(null)).toBe(false);
  });
});
