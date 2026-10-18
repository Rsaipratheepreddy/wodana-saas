import { describe, expect, it } from "vitest";
import { openWorkMessage } from "./handover";

describe("handover with work still open", () => {
  it("needs nothing when every stage is finished and no snag is open", () => {
    expect(openWorkMessage("accept", { stages: [], snags: [] })).toBe("");
  });

  it("lists the open stages and snags it asks the manager to confirm", () => {
    const message = openWorkMessage("accept", { stages: ["4. Production", "5. Installation"], snags: ["#7 Scratched door (major)"] });
    expect(message).toContain("Accepting the handover with work still open needs a confirmed reason");
    expect(message).toContain("2 stages not finished: 4. Production, 5. Installation");
    expect(message).toContain("1 snag open: #7 Scratched door (major)");
  });

  it("says the same when the pack is issued", () => {
    expect(openWorkMessage("issue", { stages: [], snags: ["#3 Chipped tile (minor)"] })).toBe("Issuing the handover with work still open needs a confirmed reason (1 snag open: #3 Chipped tile (minor)).");
  });
});
