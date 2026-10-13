import { describe, expect, it } from "vitest";
import { journeyStages, nextStage, siteEvidenceProblem } from "./design-journey.domain";

describe("design journey (PLM-047..053)", () => {
  it("keeps the old order for journeys started under it: space planning and renders only when the package does", () => {
    expect(journeyStages({ includesSpacePlanning: false, includesRenders: false }, 1)).toEqual(["inspiration", "site_visit", "concepts", "material_selection", "approval"]);
    expect(journeyStages({ includesSpacePlanning: true, includesRenders: true }, 1)).toEqual(["inspiration", "site_visit", "concepts", "space_planning", "material_selection", "renders", "approval"]);
  });
  it("runs the order of 13 Oct 2026: kick-off after inspiration, renders after the concept, samples after the renders (PLM-140–144)", () => {
    // Bespoke and Creative Director: renders; space planning folds into the concept (the layout to scale is in every package).
    expect(journeyStages({ includesSpacePlanning: true, includesRenders: true })).toEqual(["inspiration", "kickoff", "concepts", "renders", "samples", "approval"]);
    // Concept package: no renders, so samples follow the concept straight away.
    expect(journeyStages({ includesSpacePlanning: false, includesRenders: false })).toEqual(["inspiration", "kickoff", "concepts", "samples", "approval"]);
  });
  it("moves to the next stage in order", () => {
    const old = journeyStages({ includesSpacePlanning: false, includesRenders: true }, 1);
    expect(nextStage(old, "material_selection")).toBe("renders");
    expect(nextStage(old, "approval")).toBeNull();
    const current = journeyStages({ includesSpacePlanning: false, includesRenders: true });
    expect(nextStage(current, "concepts")).toBe("renders");
    expect(nextStage(current, "renders")).toBe("samples");
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

  it("gives the 3D renders their own internal and client-facing days when the firm sets them, else the design days", () => {
    // Palm: renders up to 8 weeks for the client, 5 weeks inside (configuration, not code).
    const renders = stageDeadlines("renders", now, { ...timings, designInternalDays: 21, designClientDays: 28, renderInternalDays: 35, renderClientDays: 56 });
    expect([renders.dueAt?.toISOString(), renders.clientDueAt?.toISOString()]).toEqual(["2026-11-09T08:00:00.000Z", "2026-11-30T08:00:00.000Z"]);
    const concepts = stageDeadlines("concepts", now, { ...timings, designInternalDays: 21, designClientDays: 28, renderInternalDays: 35, renderClientDays: 56 });
    expect(concepts.clientDueAt?.toISOString()).toBe("2026-11-02T08:00:00.000Z");
    expect(stageDeadlines("renders", now, { ...timings, renderInternalDays: null, renderClientDays: null }).dueAt?.toISOString()).toBe("2026-11-09T08:00:00.000Z");
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

import { developmentWindowDays, groupSiteQuestions, kickoffProblem, renderSignOffProblem, requiredSiteQuestions, samplesProblem, scopeMatches } from "./design-journey.domain";

describe("the design order of 13 Oct 2026 (PLM-140–144, PLM-154)", () => {
  const now = new Date("2026-10-13T08:00:00Z");
  const timings = { siteVisitHours: 72, designInternalDays: 35, designClientDays: 56, materialSelectionDays: 7, flowVersion: 2 as const, kickoffDays: 5, conceptDays: 7,
    sampleCollectionDays: 7, sampleMeetingDays: 7, renderInternalDays: 21, renderClientDays: 56 };

  it("dates the kick-off, the concept from the meeting with the development window, the renders to the agreed sign-off and samples in two weeks", () => {
    expect(stageDeadlines("kickoff", now, timings).dueAt?.toISOString()).toBe("2026-10-18T08:00:00.000Z");
    const kickoffAt = new Date("2026-10-12T09:00:00Z");
    const concept = stageDeadlines("concepts", now, timings, { kickoffAt, developmentDays: 28 });
    expect([concept.dueAt?.toISOString(), concept.clientDueAt?.toISOString()]).toEqual(["2026-10-19T09:00:00.000Z", "2026-11-09T09:00:00.000Z"]);
    // A meeting booked in the future (not held yet) never pulls the deadline earlier than now.
    expect(stageDeadlines("concepts", now, timings, { kickoffAt: new Date("2026-10-20T09:00:00Z"), developmentDays: 14 }).dueAt?.toISOString()).toBe("2026-10-20T08:00:00.000Z");
    const renders = stageDeadlines("renders", now, timings, { renderSignoffDueOn: "2026-12-01" });
    expect([renders.dueAt?.toISOString(), renders.clientDueAt?.toISOString()]).toEqual(["2026-11-03T08:00:00.000Z", "2026-12-01T12:00:00.000Z"]);
    const samples = stageDeadlines("samples", now, timings);
    expect([samples.dueAt?.toISOString(), samples.bookingReminderAt?.toISOString()]).toEqual(["2026-10-27T08:00:00.000Z", "2026-10-20T08:00:00.000Z"]);
  });

  it("sizes the client-facing development window by the rooms in scope, between its shortest and longest", () => {
    const window = { minDays: 14, maxDays: 56, daysPerRoom: 7 };
    expect([0, 1, 3, 5, 12].map((rooms) => developmentWindowDays(rooms, window))).toEqual([14, 14, 21, 35, 56]);
  });

  it("holds the kick-off only once its meeting took place, with the render sign-off date agreed when the package has renders", () => {
    const base = { now, today: "2026-10-13", includesRenders: true };
    expect(kickoffProblem({ ...base, scheduledAt: null, renderSignoffOn: null })).toBe("Book the kick-off meeting first");
    expect(kickoffProblem({ ...base, scheduledAt: new Date("2026-10-14T09:00:00Z"), renderSignoffOn: "2026-12-01" })).toBe("The kick-off meeting hasn't taken place yet");
    expect(kickoffProblem({ ...base, scheduledAt: new Date("2026-10-12T09:00:00Z"), renderSignoffOn: null })).toBe("Enter the render sign-off date agreed with the client");
    expect(kickoffProblem({ ...base, scheduledAt: new Date("2026-10-12T09:00:00Z"), renderSignoffOn: "2026-10-13" })).toBe("The render sign-off date is after today");
    expect(kickoffProblem({ ...base, scheduledAt: new Date("2026-10-12T09:00:00Z"), renderSignoffOn: "2026-02-30" })).toBe("Enter the render sign-off date agreed with the client");
    expect(kickoffProblem({ ...base, scheduledAt: new Date("2026-10-12T09:00:00Z"), renderSignoffOn: "2026-12-01" })).toBeNull();
    expect(kickoffProblem({ ...base, includesRenders: false, scheduledAt: new Date("2026-10-12T09:00:00Z"), renderSignoffOn: null })).toBeNull();
  });

  it("needs the render sign-off's day (not after today), signer and file", () => {
    expect(renderSignOffProblem({}, "2026-10-13")).toBe("Enter the day the client signed off the renders");
    expect(renderSignOffProblem({ signedOn: "2026-10-14", signer: "Maya", assetId: "a" }, "2026-10-13")).toBe("The sign-off date can't be in the future");
    expect(renderSignOffProblem({ signedOn: "2026-10-13", signer: " ", assetId: "a" }, "2026-10-13")).toBe("Say who signed off the renders");
    expect(renderSignOffProblem({ signedOn: "2026-10-13", signer: "Maya" }, "2026-10-13")).toBe("Attach the client's render sign-off");
    expect(renderSignOffProblem({ signedOn: "2026-10-13", signer: "Maya", assetId: "a" }, "2026-10-13")).toBeNull();
  });

  it("approves samples once collected, after the meeting, with every material confirmed and every outsourced one signed off", () => {
    const base = { now, collected: true, meetingAt: new Date("2026-10-12T09:00:00Z"), materials: 2, waiting: [] as string[], outsourcedWaiting: [] as string[] };
    expect(samplesProblem({ ...base, collected: false })).toBe("Collect the samples first");
    expect(samplesProblem({ ...base, meetingAt: null })).toBe("Book the sample meeting first");
    expect(samplesProblem({ ...base, meetingAt: new Date("2026-10-14T09:00:00Z") })).toBe("The sample meeting hasn't taken place yet");
    expect(samplesProblem({ ...base, materials: 0 })).toBe("Add the materials to the list first");
    expect(samplesProblem({ ...base, waiting: ["Oak"] })).toBe("Waiting for the client's confirmation: Oak");
    expect(samplesProblem({ ...base, outsourcedWaiting: ["Onyx", "Brass"] })).toBe("Waiting for the sign-off of the outsourced materials: Onyx, Brass");
    expect(samplesProblem(base)).toBeNull();
  });

  it("groups the site visit questions by scope: general first, the job's scopes next, the rest optional (PLM-154)", () => {
    const questions = [
      { key: "access", question: "Access?" },
      { key: "bed-size", question: "Bed size?", scope: "Bedrooms" },
      { key: "family", question: "Family size?", scope: "Kitchen" },
      { key: "back", question: "Back kitchen?", scope: "kitchen" },
    ];
    expect(scopeMatches("Kitchen", ["Main kitchen"])).toBe(true);
    expect(scopeMatches("Bedrooms", ["Bedroom 2"])).toBe(true);
    expect(scopeMatches("Bedrooms", ["Living room"])).toBe(false);
    const groups = groupSiteQuestions(questions, ["Main kitchen", "Living"]);
    expect(groups.map((group) => [group.scope, group.matches, group.required, group.questions.map((question) => question.key)])).toEqual([
      [null, true, true, ["access"]], ["Kitchen", true, true, ["family", "back"]], ["Bedrooms", false, false, ["bed-size"]],
    ]);
    expect(requiredSiteQuestions(questions, ["Main kitchen"]).map((question) => question.key)).toEqual(["access", "family", "back"]);
    // The job's scope unknown (no rooms yet, or none matching): every group is asked.
    expect(requiredSiteQuestions(questions, []).map((question) => question.key)).toEqual(["access", "bed-size", "family", "back"]);
    expect(requiredSiteQuestions(questions, ["Garage"]).length).toBe(4);
    // An old list without scopes is one group, asked in full.
    expect(groupSiteQuestions(DEFAULT_SITE_VISIT_QUESTIONS, ["Kitchen"]).map((group) => [group.scope, group.questions.length])).toEqual([[null, 7]]);
    expect(normaliseSiteQuestions([{ key: "k", question: "Q?", scope: "  Kitchen  " }, { key: "g", question: "G?", scope: "" }])).toEqual([{ key: "k", question: "Q?", scope: "Kitchen" }, { key: "g", question: "G?" }]);
  });
});
