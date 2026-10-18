import { describe, expect, it } from "vitest";
import { buildDayCards, crewOfDay, dayStatus, missingWorkDays, type DayCardRows } from "./day-cards";

const report = (id: string, date: string, overrides: Partial<DayCardRows["reports"][number]> = {}): DayCardRows["reports"][number] => ({
  id, date, authorId: `author-${id}`, authorName: `Author ${id}`, status: "approved", version: 3, submittedAt: `${date}T15:00:00.000Z`, decidedAt: null, decidedByName: null,
  decisionNote: "", late: false, backdated: false, delivery: "pending", sentAt: null, hidden: false, noWorkReason: "", notes: "", clientSummary: "", safety: "none", safetyNote: "",
  forecast: "none", impact: "", recoveryOwnerName: null, recoveryOn: null, ...overrides,
});
const rows = (overrides: Partial<DayCardRows> = {}): DayCardRows => ({
  today: "2026-10-12", reports: [], workforce: [], crewDays: [], work: [], photos: [], issues: [], materials: [], received: [], issued: [], next: [], reactions: [], approvers: [], ...overrides,
});
const issue = (id: string, reportId: string, overrides: Partial<DayCardRows["issues"][number]> = {}): DayCardRows["issues"][number] => ({
  id, reportId, severity: "minor", description: `Issue ${id}`, internal: true, status: "open", ownerId: null, ownerName: null, dueOn: null, resolvedAt: null, resolvedByName: null,
  resolution: "", raised: null, workItemId: null, workItemNumber: null, changeRequestId: null, changeRequestReference: null, version: 1, ...overrides,
});
// Sunday to Thursday, with a holiday on Wednesday 7 October.
const calendar = { workingDays: [0, 1, 2, 3, 4], holidays: ["2026-10-07"] };

describe("day cards", () => {
  it("reads a day as one state: waiting first, then sent back, a draft, approved only when every report is", () => {
    expect(dayStatus(["approved", "submitted"])).toBe("submitted");
    expect(dayStatus(["approved", "returned"])).toBe("returned");
    expect(dayStatus(["approved", "draft"])).toBe("draft");
    expect(dayStatus(["approved", "approved"])).toBe("approved");
  });

  it("counts the crew by trade: a crew's named day replaces the reports' headcount for its trade, others add up", () => {
    expect(crewOfDay([{ trade: "Carpenters", people: 3 }, { trade: "carpenters ", people: 2 }, { trade: "Painters", people: 4 }], [{ trade: "Painters", people: 5 }]))
      .toEqual([{ trade: "Carpenters", people: 5, source: "report" }, { trade: "Painters", people: 5, source: "crew_day" }]);
    expect(crewOfDay([{ trade: "Tilers", people: 2 }], [{ trade: "Tilers", people: 0 }])).toEqual([{ trade: "Tilers", people: 2, source: "report" }]);
  });

  it("finds the working days with no report from the workspace calendar: never before site work, after it, on days off, or today before it's due", () => {
    const base = { from: "2026-10-01", to: "2026-10-12", today: "2026-10-12", startedOn: "2026-10-04", finishedOn: null, calendar };
    // 4 Oct is a Sunday. Fri 9 and Sat 10 are off, Wed 7 is a holiday; the 5th has a report; today isn't due yet.
    expect(missingWorkDays({ ...base, reported: ["2026-10-05"], todayPastDue: false })).toEqual(["2026-10-11", "2026-10-08", "2026-10-06", "2026-10-04"]);
    expect(missingWorkDays({ ...base, reported: ["2026-10-05"], todayPastDue: true })[0]).toBe("2026-10-12");
    expect(missingWorkDays({ ...base, finishedOn: "2026-10-06", reported: [], todayPastDue: true })).toEqual(["2026-10-06", "2026-10-05", "2026-10-04"]);
    expect(missingWorkDays({ ...base, startedOn: null, reported: [], todayPastDue: true })).toEqual([]);
    // A range in the future never reaches past today.
    expect(missingWorkDays({ ...base, from: "2026-10-12", to: "2026-10-20", reported: [], todayPastDue: false })).toEqual([]);
  });

  it("merges everyone's report of a day into one card, newest day first, each item keeping its report", () => {
    const cards = buildDayCards(rows({
      reports: [report("a", "2026-10-11", { status: "submitted", authorId: "u1" }), report("b", "2026-10-11"), report("c", "2026-10-08", { delivery: "sent", sentAt: "2026-10-08T17:00:00.000Z" })],
      approvers: [{ userId: "u1", name: "Omar" }, { userId: "u2", name: "Lina" }],
      workforce: [{ reportId: "a", trade: "Carpenters", people: 3 }, { reportId: "b", trade: "Electricians", people: 2 }],
      work: [
        { id: "w1", reportId: "a", kind: "task", title: "Fit carcasses", workItemId: "t1", number: 4, progress: 100, previous: 50, stageId: "s-carpentry", stageName: "Carpentry", packageName: null, area: null, quantity: null, unit: "", note: "", hidden: false },
        { id: "w2", reportId: "b", kind: "installed", title: "Worktop", workItemId: null, number: null, progress: null, previous: null, stageId: null, stageName: null, packageName: "Kitchen", area: "Kitchen", quantity: "2.2500", unit: "m²", note: "", hidden: false },
      ],
      issues: [issue("i1", "a", { severity: "minor", status: "resolved" }), issue("i2", "b", { severity: "critical", dueOn: "2026-10-10" }), issue("i3", "a", { severity: "major" })],
      photos: [{ id: "p1", reportId: "b", area: "Kitchen", phase: "after", pairId: null, forClient: true, shared: false }],
      next: [{ id: "n1", reportId: "a", title: "Template the worktop", workItemId: null, hidden: false }],
      reactions: [{ reportId: "c", reaction: "love", count: 2 }],
    }));
    expect(cards.map((card) => card.date)).toEqual(["2026-10-11", "2026-10-08"]);
    const [day, earlier] = cards;
    expect(day.reports.map((item) => item.id)).toEqual(["a", "b"]);
    expect(day.status).toBe("submitted");
    // The author never approves their own report: only the others are waited on.
    expect(day.reports[0].waitingFor).toEqual(["Lina"]);
    expect(day.crew).toEqual([{ trade: "Carpenters", people: 3, source: "report" }, { trade: "Electricians", people: 2, source: "report" }]);
    expect(day.people).toBe(5);
    expect(day.work.map((item) => [item.reportId, item.title])).toEqual([["a", "Fit carcasses"], ["b", "Worktop"]]);
    // Open issues first, the most serious first; an open one past its due date is overdue.
    expect(day.issues.map((item) => [item.id, item.overdue])).toEqual([["i2", true], ["i3", false], ["i1", false]]);
    expect(day.stageIds).toEqual(["s-carpentry"]);
    expect(day.trades).toEqual(["Carpenters", "Electricians"]);
    expect(day.clientVisible).toBe(false);
    expect(earlier.clientVisible).toBe(true);
    expect(earlier.reports[0].reactions).toEqual({ like: 0, love: 2 });
  });

  it("a day taken off the client's page isn't client visible", () => {
    const [card] = buildDayCards(rows({ reports: [report("a", "2026-10-11", { delivery: "sent", hidden: true })] }));
    expect(card.clientVisible).toBe(false);
  });

  it("lists materials once: the report's own, deliveries received that day it doesn't name, and stock issued", () => {
    const [card] = buildDayCards(rows({
      reports: [report("a", "2026-10-11")],
      materials: [{ id: "m1", reportId: "a", date: "2026-10-11", direction: "received", description: "Plywood 18 mm", quantity: "20.0000", unit: "sheet", source: "report", reference: "PO-12",
        purchaseOrderId: "po-12", stockTransferId: null }],
      received: [
        { date: "2026-10-11", id: "gr1", kind: "order", orderId: "po-12", transferId: null, label: "PO-12 · Timber Co" },
        { date: "2026-10-11", id: "gr2", kind: "order", orderId: "po-13", transferId: null, label: "PO-13 · Tile House" },
        { date: "2026-10-10", id: "gr3", kind: "order", orderId: "po-14", transferId: null, label: "PO-14 · Other day" },
      ],
      issued: [{ date: "2026-10-11", id: "s1", description: "Tile adhesive", quantity: "4.0000", unit: "bag" }],
    }));
    expect(card.materials.map((item) => [item.source, item.direction, item.description])).toEqual([
      ["report", "received", "Plywood 18 mm"], ["delivery", "received", "PO-13 · Tile House"], ["stock", "used", "Tile adhesive"]]);
    // The internal links never leave the read model.
    expect(card.materials[0]).not.toHaveProperty("purchaseOrderId");
  });
});
