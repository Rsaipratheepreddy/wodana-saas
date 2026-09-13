import { describe, expect, it } from "vitest";
import { deriveAuthBootstrapNextAction } from "./identity.service";

describe("deriveAuthBootstrapNextAction", () => {
  it("routes a first owner through invitation acceptance and onboarding", () => {
    expect(deriveAuthBootstrapNextAction([], 1)).toBe("accept_invitation");
    expect(deriveAuthBootstrapNextAction([], 0)).toBe("await_invitation");
    expect(deriveAuthBootstrapNextAction([
      { onboarding: { status: "not_started" } },
    ], 0)).toBe("start_onboarding");
    expect(deriveAuthBootstrapNextAction([
      { onboarding: { status: "in_progress" } },
    ], 0)).toBe("resume_onboarding");
    expect(deriveAuthBootstrapNextAction([
      { onboarding: { status: "completed" } },
    ], 0)).toBe("enter_workspace");
  });
});
