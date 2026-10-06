import { describe, expect, it } from "vitest";
import type { ProjectDetail, ProjectOverview } from "./types";
import { projectPeople, projectPercent, projectStrip, projectTimeline, stageLateDays } from "./project-record";

const stage = (position: number, status: ProjectDetail["stages"][number]["status"], patch: Partial<ProjectDetail["stages"][number]> = {}) => ({
  id: `s${position}`, position, key: `k${position}`, name: `Stage ${position + 1}`, ownerRole: "project_manager", status, startedAt: null, completedAt: status === "done" ? "2026-09-29T18:00:00Z" : null,
  completedByName: null, skipReason: null, checks: [], ready: false, owner: null, canWork: false, ...patch,
});
const detail = (patch: Partial<ProjectDetail> = {}): ProjectDetail => ({
  project: { id: "p1", reference: "PRJ-0003", name: "Townhouse 7", clientName: "Haddad", status: "active", priority: "normal", health: "on_track", promiseDate: "2026-10-19", currency: "AED",
    total: "43596.0000", startedAt: "2026-09-29T18:00:00Z", caseId: "c1", opportunityId: "o1", opportunityReference: "D-0003", holdReason: null, holdReviewOn: null, startDate: "2026-09-04",
    templateName: "Standard", version: 20, closedAt: null, closedByName: null, cancelReason: null },
  seal: null, roles: [{ key: "project_manager", label: "Project manager" }, { key: "designer", label: "Designer" }, { key: "installation_lead", label: "Installation lead" }],
  team: [{ role: "project_manager", label: "Project manager", member: { membershipId: "m1", name: "Khalid", email: "khalid@example.test" } },
    { role: "designer", label: "Designer", member: { membershipId: "m1", name: "Khalid", email: "khalid@example.test" } }, { role: "installation_lead", label: "Installation lead", member: null }],
  stages: [stage(0, "done"), stage(1, "done"), stage(2, "current", { ownerRole: "installation_lead" }), stage(3, "upcoming")],
  next: null, updates: [], members: [], canManage: true, canClose: true, canSeeMoney: false, progress: 10, ...patch,
});
const overview = (patch: Partial<ProjectOverview> = {}): ProjectOverview => ({
  today: "2026-10-06", work: { open: 3, late: 3, blocked: 0, ready: 2, openSnags: 2, criticalSnags: 0, clientRequests: 0 }, blockers: [], decisions: [],
  stagePlan: { s2: { start: "2026-09-07", end: "2026-10-02", open: 1, total: 4 }, s3: { start: "2026-10-02", end: "2026-10-02", open: 2, total: 2 } },
  dates: { start: "2026-09-04", promise: "2026-10-19", planEnd: "2026-10-02", siteStarted: null, siteFinished: null },
  money: { currency: "AED", agreed: "43596.00", invoiced: "43596.00", received: "39236.40", due: "4359.60", toInvoice: 0, next: null, spent: "12000.0000", committed: "3000.0000", available: null, costCurrency: "AED", budget: "20000.0000" },
  activity: [], health: { health: "at_risk", stated: "on_track", reasons: [{ key: "late_work", count: 3 }] }, ...patch,
});

describe("the project's strip", () => {
  it("takes health from the records, not only what was said", () => {
    expect(projectStrip(detail(), overview())).toMatchObject({ health: "at_risk", reasons: [{ key: "late_work", count: 3 }] });
    expect(projectStrip(detail(), null).health).toBe("on_track");
  });

  it("reads the stage, the handover countdown, work done, budget used and payments", () => {
    expect(projectStrip(detail(), overview())).toMatchObject({
      stage: { name: "Stage 3", position: 3, count: 4 }, handover: { date: "2026-10-19", days: 13 }, work: { done: 3, total: 6 }, budgetUsed: 75, paid: 90,
    });
    expect(projectStrip(detail(), overview({ money: null })).budgetUsed).toBeNull();
  });

  it("never shows progress below the stages already behind the project", () => {
    expect(projectPercent(detail())).toBe(50);
    expect(projectPercent(detail({ progress: 72 }))).toBe(72);
    expect(projectPercent(detail({ progress: null }))).toBe(50);
    expect(projectPercent(detail({ project: { ...detail().project, status: "completed" } }))).toBe(100);
  });
});

describe("the project's timeline and people", () => {
  it("marks a stage past the end of its planned work", () => {
    expect(stageLateDays({ id: "s2", status: "current" }, overview().stagePlan, "2026-10-06")).toBe(4);
    expect(stageLateDays({ id: "s2", status: "done" }, overview().stagePlan, "2026-10-06")).toBe(0);
  });

  it("gives each stage its date, its plan and who does it", () => {
    const steps = projectTimeline(detail(), overview());
    expect(steps[0]).toMatchObject({ state: "done", doneAt: "2026-09-29T18:00:00Z", person: { id: "m1", name: "Khalid" } });
    expect(steps[2]).toMatchObject({ state: "current", plannedEnd: "2026-10-02", lateDays: 4, person: null, role: "installation_lead" });
    expect(projectTimeline(detail({ project: { ...detail().project, status: "on_hold" } }), overview())[2].state).toBe("blocked");
  });

  it("lists each person once with all their roles, and the roles nobody holds", () => {
    expect(projectPeople(detail())).toEqual({ named: [{ id: "m1", name: "Khalid", email: "khalid@example.test", roles: ["Project manager", "Designer"] }], missing: ["Installation lead"] });
  });
});
