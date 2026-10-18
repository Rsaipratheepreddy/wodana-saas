import { describe, expect, it } from "vitest";
import { translatorFor } from "@/lib/i18n/keys";
import { effectiveHealth, nextStepPhrase, nextStepText } from "./next-step";

const t = translatorFor({});

describe("a project's next step", () => {
  it("says what to do, not the state it waits for", () => {
    expect(nextStepText(t, { kind: "installation_done", text: "Installation signed off", stage: "Delivery and installation" })).toBe("Confirm installation");
    expect(nextStepText(t, { kind: "everything_ordered", text: "Everything is ordered", stage: "Procurement" })).toBe("Order the remaining materials");
    expect(nextStepText(t, { kind: "finish", text: "Finish Production", stage: "Production" })).toBe("Finish Production");
    // A firm's own check keeps its words.
    expect(nextStepText(t, { kind: "confirm", text: "Site measured", stage: "Kickoff" })).toBe("Site measured");
    expect(nextStepPhrase({ kind: "finish", text: "", stage: "Production" })).toEqual({ key: "Finish {stage}", values: { stage: "Production" } });
  });

  it("puts a running project with late work at risk", () => {
    expect(effectiveHealth({ status: "active", health: "on_track", attention: { late: 3, blocked: 0 } })).toBe("at_risk");
    expect(effectiveHealth({ status: "active", health: "on_track", attention: { late: 0, blocked: 2 } })).toBe("on_track");
    expect(effectiveHealth({ status: "active", health: "off_track", attention: { late: 3, blocked: 0 } })).toBe("off_track");
    expect(effectiveHealth({ status: "completed", health: "on_track", attention: { late: 3, blocked: 0 } })).toBe("on_track");
  });
});
