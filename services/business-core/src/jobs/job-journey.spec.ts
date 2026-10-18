import { describe, expect, it } from "vitest";
import { applyFurniturePath, chapterOfProjectStage, resolveStates } from "./job-journey";

const step = (key: string, done: boolean, skipped = false) => ({ key, chapter: "win" as const, lane: "sales" as const, label: key, doneAt: null, doneBy: null, dueAt: null, href: null, done, skipped, doneWhen: "" });

describe("a job's journey (§0.3 P2)", () => {
  it("marks the first step not done as now, the two after it as next, skipped steps aside", () => {
    const states = resolveStates([step("a", true), step("b", false, true), step("c", false), step("d", false), step("e", false, true), step("f", false), step("g", false)]).map((item) => item.state);
    expect(states).toEqual(["done", "skipped", "now", "next", "skipped", "next", "upcoming"]);
  });

  it("counts the steps a done step can't happen without as done, never a skipped one", () => {
    const states = resolveStates([step("proposal_1", false), step("proposal_1_accepted", false), step("design_fee", false), step("design_deal", true), step("quotation", false)])
      .map((item) => item.state);
    expect(states).toEqual(["done", "done", "done", "done", "now"]);
    expect(resolveStates([step("proposal_1", false, true), step("proposal_1_accepted", true)]).map((item) => item.state)).toEqual(["skipped", "done"]);
    expect(resolveStates([step("quotation", false), step("qs_estimate", false), step("manager_approval", false), step("quotation_sent", true)]).map((item) => item.state))
      .toEqual(["done", "done", "done", "done"]);
  });

  it("has nothing now once every step is done", () => {
    expect(resolveStates([step("a", true), step("b", true)]).map((item) => item.state)).toEqual(["done", "done"]);
  });

  it("puts buying, drawings and production in Make, site work and handover in Install, warranty in Care", () => {
    expect(["kickoff", "materials", "procurement", "drawings", "production"].map(chapterOfProjectStage)).toEqual(Array(5).fill("make"));
    expect(["permit", "installation", "snagging", "handover", "delivery"].map(chapterOfProjectStage)).toEqual(Array(5).fill("install"));
    expect(chapterOfProjectStage("warranty")).toBe("care");
  });
});

describe("a furniture-only job follows its path (the guide's A–E)", () => {
  const keys = ["intro_booked", "intro_held", "outcome", "quotation", "qs_estimate", "manager_approval", "project", "kickoff_project", "material_list", "technical",
    "drawings", "margin", "release", "factory", "pre_install", "install", "site_reports", "snagging", "handover"];
  const steps = (done: string[] = []) => keys.map((key) => ({ key, done: done.includes(key), skipped: false, note: null as string | null }));
  const live = (list: ReturnType<typeof steps>) => list.filter((step) => !step.skipped).map((step) => step.key);

  it("A, taken home now: no intro, no QS, nothing after the deal but the handover, done when the deal closes", () => {
    const path = applyFurniturePath(steps(), { boq: false, fulfilment: true, areas: [], delivered: false, closed: true });
    expect(live(path)).toEqual(["quotation", "handover"]);
    expect(path.find((step) => step.key === "handover")!.done).toBe(true);
    expect(path.find((step) => step.key === "intro_held")!.note).toBe("Not part of furniture-only jobs");
  });

  it("C, ordered from the supplier: delivered from the deal, done when the delivery is recorded", () => {
    const path = applyFurniturePath(steps(), { boq: false, fulfilment: true, areas: ["supply", "delivery"], delivered: true, closed: true });
    expect(live(path)).toEqual(["quotation", "install", "handover"]);
    expect(path.filter((step) => step.done).map((step) => step.key)).toEqual(["install", "handover"]);
  });

  it("D, made from the collection: the factory without drawings or the QS", () => {
    const path = applyFurniturePath(steps(), { boq: false, fulfilment: false, areas: ["production", "supply", "delivery"], delivered: false, closed: false });
    expect(live(path)).toEqual(["quotation", "project", "release", "factory", "install", "handover"]);
  });

  it("E, bespoke: the full make chain; a step already done never disappears", () => {
    const path = applyFurniturePath(steps(["intro_held"]), { boq: true, fulfilment: false, areas: ["planning", "production", "supply", "delivery"], delivered: false, closed: false });
    expect(live(path)).toEqual(keys.filter((key) => !["intro_booked", "outcome"].includes(key)));
  });
});
