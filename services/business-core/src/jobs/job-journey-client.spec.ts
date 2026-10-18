import { describe, expect, it } from "vitest";
import { clientLens } from "./job-journey-client";
import type { JourneyStep } from "./job-journey";

const step = (key: string, state: JourneyStep["state"], chapter: JourneyStep["chapter"] = "win"): JourneyStep =>
  ({ key, chapter, lane: "sales", label: key, state, doneAt: null, doneBy: null, dueAt: null, href: "/internal", owner: null, ownerId: null });

describe("the client's lens on the journey (§0.3 P5)", () => {
  it("shows only the steps a client recognises, in their words, never the internal ones", () => {
    const lens = clientLens([step("assigned", "done"), step("proposal_1", "done"), step("outcome", "done"), step("proposal_1_accepted", "now"), step("design_fee", "next"),
      step("design:concepts", "upcoming", "design"), step("qs_estimate", "upcoming", "price"), step("margin", "upcoming", "make")]);
    expect(lens.steps.map((item) => item.label)).toEqual(["Design proposal shared with you", "You accept the design proposal", "Design fee paid", "2D design"]);
    expect(lens.now).toEqual({ label: "You accept the design proposal", yours: true, dueAt: null });
    expect(lens.next.map((item) => item.label)).toEqual(["Design fee paid", "2D design"]);
    expect(JSON.stringify(lens)).not.toContain("/internal");
  });

  it("names the next step the client would recognise when the team is on an internal one", () => {
    const lens = clientLens([step("quotation_sent", "done", "price"), step("qs_estimate", "now", "price"), step("quotation_accepted", "next", "price")]);
    expect(lens.now).toEqual({ label: "You sign the quotation", yours: false, dueAt: null });
    expect(lens.chapter).toBe("price");
  });
});
