import { describe, expect, it } from "vitest";
import { mergeDayViews } from "./progress-report";

const view = (overrides: Partial<Parameters<typeof mergeDayViews>[1][number]> = {}) => ({
  summary: "", noWork: false, hero: null, photos: [], completed: [], advanced: [], next: [], notes: [], ...overrides,
});

describe("progress report", () => {
  it("merges two reports of a day into one section: words in order, lists without repeats, every photo once", () => {
    const day = mergeDayViews("2026-10-11", [
      view({ summary: "Carcasses are in.", hero: { id: "p1", area: "Kitchen", phase: "after", pairId: null }, photos: [{ id: "p2", area: null, phase: null, pairId: null }],
        completed: ["Carcasses"], advanced: [{ title: "Wardrobe doors", progress: 50 }], next: ["Worktop"] }),
      view({ summary: "Wiring done in the hall.", hero: { id: "p2", area: null, phase: null, pairId: null }, completed: ["Carcasses", "Hall wiring"],
        advanced: [{ title: "Wardrobe doors", progress: 75 }, { title: "Hall wiring", progress: 60 }], next: ["Worktop", "Painting"], notes: ["Water is off on Sunday"] }),
    ]);
    expect(day).toEqual({
      date: "2026-10-11", summary: "Carcasses are in.\n\nWiring done in the hall.", noWork: false,
      photos: [{ id: "p1", area: "Kitchen", phase: "after", pairId: null }, { id: "p2", area: null, phase: null, pairId: null }],
      completed: ["Carcasses", "Hall wiring"], advanced: [{ title: "Wardrobe doors", progress: 75 }], next: ["Worktop", "Painting"], notes: ["Water is off on Sunday"],
    });
  });

  it("is a day without work only when every report says so", () => {
    expect(mergeDayViews("2026-10-11", [view({ noWork: true }), view()]).noWork).toBe(false);
    expect(mergeDayViews("2026-10-11", [view({ noWork: true })]).noWork).toBe(true);
  });
});
