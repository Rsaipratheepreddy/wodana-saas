import { describe, expect, it } from "vitest";
import { invitationGreetingName, placeholderDisplayName } from "./invitation-recipient";

describe("invitation recipient", () => {
  it("keeps a readable placeholder for the people list when no name was given", () => {
    expect(placeholderDisplayName("qs@palmliving.test")).toBe("Qs");
    expect(placeholderDisplayName("maya.thomas@example.com")).toBe("Maya Thomas");
  });

  it("greets by the display name only when one was given", () => {
    expect(invitationGreetingName("Maya Thomas", "qs@palmliving.test")).toBe("Maya Thomas");
    expect(invitationGreetingName("  Maya Thomas  ", "qs@palmliving.test")).toBe("Maya Thomas");
    expect(invitationGreetingName(undefined, "qs@palmliving.test")).toBeNull();
    expect(invitationGreetingName("", "qs@palmliving.test")).toBeNull();
    expect(invitationGreetingName("   ", "qs@palmliving.test")).toBeNull();
  });

  it("never greets with a name that was only derived from the address", () => {
    expect(invitationGreetingName("Qs", "qs@palmliving.test")).toBeNull();
    expect(invitationGreetingName("qs", "qs@palmliving.test")).toBeNull();
    expect(invitationGreetingName("qs@palmliving.test", "qs@palmliving.test")).toBeNull();
    expect(invitationGreetingName("Finance Team", "finance.team@example.com")).toBeNull();
  });
});
