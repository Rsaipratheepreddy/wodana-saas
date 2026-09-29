import { describe, expect, it } from "vitest";
import { clientEmailNote, joinList, templateSummary, validateSummary, type ClientView, type SummaryFacts } from "./daily-progress";

const facts = (overrides: Partial<SummaryFacts> = {}): SummaryFacts => ({
  project: "Villa 12", stage: "Carpentry", progress: 42, noWork: false, completed: [], advanced: [], next: [], areas: [], photos: 0, notes: [], ...overrides,
});

describe("daily progress words", () => {
  it("joins lists the way people write them", () => {
    expect([joinList([]), joinList(["a"]), joinList(["a", "b"]), joinList(["a", "b", "c"])]).toEqual(["", "a", "a and b", "a, b and c"]);
  });

  it("writes two to four friendly sentences from the day's facts", () => {
    expect(templateSummary(facts({ completed: ["Kitchen carcasses"], advanced: [{ title: "Wardrobe doors", progress: 50 }], next: ["Worktop template", "Painting"] })))
      .toBe("Today the team finished Kitchen carcasses. Work also moved forward on Wardrobe doors. Villa 12 is 42% complete, in the Carpentry stage. Next up: Worktop template and Painting.");
    expect(templateSummary(facts({ progress: 0, stage: null, areas: ["Kitchen", "Living room"] }))).toBe("The team was on site today, working in Kitchen and Living room.");
    expect(templateSummary(facts({ noWork: true, next: ["Tiling"] }))).toBe("There was no work on site today. Next up: Tiling.");
  });

  it("accepts Woddy's summary only as one sensible string", () => {
    expect(validateSummary({ summary: "  The kitchen carcasses are in.\n Next, the worktop.  " })).toBe("The kitchen carcasses are in. Next, the worktop.");
    expect(() => validateSummary({ summary: "Short" })).toThrow();
    expect(() => validateSummary({ text: "The kitchen carcasses are in." })).toThrow();
    expect(() => validateSummary({ summary: "x".repeat(901) })).toThrow();
  });

  it("emails the summary, what was done and what's next", () => {
    const view = { summary: "Carcasses are in.", completed: ["Carcasses"], next: ["Worktop"] } as ClientView;
    expect(clientEmailNote(view)).toBe("Carcasses are in.\n\nDone today: Carcasses.\n\nNext up: Worktop.");
  });
});
