import { describe, expect, it } from "vitest";
import { agentSystemPrompt } from "./agent-prompt";

describe("Woddy's instructions", () => {
  it("look records and people up by name instead of asking for ids", () => {
    const prompt = agentSystemPrompt({ now: new Date("2026-10-02T08:00:00Z"), timeZone: "UTC", surface: "panel", record: null, selection: null });
    expect(prompt).toContain("never ask the person for an id");
    expect(prompt).toContain("search_records");
    expect(prompt).toContain("find_member");
  });

  it("answer product, price, stock and supplier questions only from the tools, never invented", () => {
    const prompt = agentSystemPrompt({ now: new Date("2026-10-02T08:00:00Z"), timeZone: "UTC", surface: "panel", record: null, selection: null });
    for (const tool of ["search_catalog", "check_stock", "search_suppliers"]) expect(prompt).toContain(tool);
    expect(prompt).toContain("price on request");
    expect(prompt).toContain("Never invent or estimate a price, cost, size or stock level");
    expect(prompt).toContain("no access");
  });
});
