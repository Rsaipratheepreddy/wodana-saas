import { describe, expect, it } from "vitest";
import { journeyStages, nextStage, siteEvidenceProblem } from "./design-journey.domain";

describe("design journey (PLM-047..053)", () => {
  it("includes space planning and renders only when the package does", () => {
    expect(journeyStages({ includesSpacePlanning: false, includesRenders: false })).toEqual(["inspiration", "site_visit", "concepts", "material_selection", "approval"]);
    expect(journeyStages({ includesSpacePlanning: true, includesRenders: true })).toEqual(["inspiration", "site_visit", "concepts", "space_planning", "material_selection", "renders", "approval"]);
  });
  it("moves to the next stage in order", () => {
    const order = journeyStages({ includesSpacePlanning: false, includesRenders: true });
    expect(nextStage(order, "material_selection")).toBe("renders");
    expect(nextStage(order, "approval")).toBeNull();
  });
  it("needs every wall measured with a photo before the site visit is done", () => {
    expect(siteEvidenceProblem([])).toMatch(/Record the measurements/);
    expect(siteEvidenceProblem([{ title: "Living wall A", status: "incomplete", files: 1 }])).toBe("Finish the measurements for Living wall A");
    expect(siteEvidenceProblem([{ title: "Kitchen", status: "measured", files: 0 }])).toBe("Add a photo for Kitchen");
    expect(siteEvidenceProblem([{ title: "Kitchen", status: "verified", files: 2 }])).toBeNull();
  });
});

import { approvalProblem, DEFAULT_SITE_VISIT_QUESTIONS, normaliseSiteQuestions, optionProblem, roundChargeable, SITE_AND_MATERIALS_STAGES, siteChecklistProblem, stageDeadlines, stageRevisions } from "./design-journey.domain";

describe("design flow after Won (PLM-049/050/051/053/128, PLM-081)", () => {
  const timings = { siteVisitHours: 72, designInternalDays: 35, designClientDays: 56, materialSelectionDays: 7 };
  const now = new Date("2026-10-05T08:00:00Z");

  it("gives design stages an internal and a client-facing deadline, the site visit its hours and material selection its week plus a booking reminder", () => {
    const concepts = stageDeadlines("concepts", now, timings);
    expect([concepts.dueAt?.toISOString(), concepts.clientDueAt?.toISOString(), concepts.bookingReminderAt]).toEqual(["2026-11-09T08:00:00.000Z", "2026-11-30T08:00:00.000Z", null]);
    expect(stageDeadlines("renders", now, timings).clientDueAt?.toISOString()).toBe("2026-11-30T08:00:00.000Z");
    expect(stageDeadlines("site_visit", now, timings)).toEqual({ dueAt: new Date("2026-10-08T08:00:00Z"), clientDueAt: null, bookingReminderAt: null });
    expect(stageDeadlines("material_selection", now, timings)).toEqual({ dueAt: new Date("2026-10-12T08:00:00Z"), clientDueAt: null, bookingReminderAt: now });
    expect(stageDeadlines("approval", now, timings)).toEqual({ dueAt: null, clientDueAt: null, bookingReminderAt: null });
  });

  it("counts revisions after the first presentation and flags the one beyond the package's included revisions as chargeable", () => {
    expect(stageRevisions(0, 2)).toEqual({ used: 0, included: 2, chargeable: false });
    expect(stageRevisions(1, 2)).toEqual({ used: 0, included: 2, chargeable: false });
    expect(stageRevisions(3, 2)).toEqual({ used: 2, included: 2, chargeable: false });
    expect(stageRevisions(4, 2)).toEqual({ used: 3, included: 2, chargeable: true });
    expect([1, 2, 3, 4].map((round) => roundChargeable(round, 2))).toEqual([false, false, false, true]);
    expect(roundChargeable(2, 0)).toBe(true);
  });

  it("keeps only well-formed, unique questions and needs every one answered to complete the visit", () => {
    expect(normaliseSiteQuestions([{ key: "a", question: "A?" }, { key: "a", question: "Again" }, { key: "", question: "x" }, { key: "b" }, "junk", { key: " c ", question: " C? " }])).toEqual([{ key: "a", question: "A?" }, { key: "c", question: "C?" }]);
    expect(normaliseSiteQuestions(null)).toEqual([]);
    expect(DEFAULT_SITE_VISIT_QUESTIONS.length).toBe(7);
    expect(siteChecklistProblem(DEFAULT_SITE_VISIT_QUESTIONS, [])).toBe("Answer the 7 site visit questions left");
    expect(siteChecklistProblem(DEFAULT_SITE_VISIT_QUESTIONS, DEFAULT_SITE_VISIT_QUESTIONS.slice(1).map((question) => question.key))).toBe("Answer the last site visit question");
    expect(siteChecklistProblem(DEFAULT_SITE_VISIT_QUESTIONS, DEFAULT_SITE_VISIT_QUESTIONS.map((question) => question.key))).toBeNull();
  });

  it("needs the approval day (not after today in the firm's time zone), the signer and the signed file", () => {
    expect(approvalProblem({}, "2026-10-05")).toBe("Enter the day the client approved the design");
    expect(approvalProblem({ approvedOn: "2026-10-06", assetId: "x", signer: "Maya" }, "2026-10-05")).toBe("The approval date can't be in the future");
    expect(approvalProblem({ approvedOn: "2026-10-05", assetId: "x", signer: " " }, "2026-10-05")).toBe("Say who signed the approval");
    expect(approvalProblem({ approvedOn: "2026-10-05", signer: "Maya" }, "2026-10-05")).toBe("Attach the client's signed approval");
    expect(approvalProblem({ approvedOn: "2026-10-05", assetId: "x", signer: "Maya" }, "2026-10-05")).toBeNull();
  });

  it("shows a concept option as a file or an https link, never both or neither", () => {
    expect(optionProblem({ title: "Warm minimal", linkUrl: "https://www.canva.com/design/abc" })).toBeNull();
    expect(optionProblem({ title: "Warm minimal", designId: "d1" })).toBeNull();
    expect(optionProblem({ title: "", designId: "d1" })).toBe("Give each option a title");
    expect(optionProblem({ title: "x" })).toBe("Attach a file or a link to each option");
    expect(optionProblem({ title: "x", designId: "d1", linkUrl: "https://a.b" })).toBe("Attach a file or a link to each option");
    expect(optionProblem({ title: "x", linkUrl: "http://insecure.example" })).toBe("Use an https link");
  });

  it("gives an order without a design package the site visit and material selection only", () => {
    expect(SITE_AND_MATERIALS_STAGES).toEqual(["site_visit", "material_selection"]);
  });
});
