import { describe, expect, it } from "vitest";
import { matchBucket, monthKeys, parseBucket, weekKeys, type Fact } from "./report-kit";
import { localDate, parseFilters } from "./report-scope";
import { TARGET_KPIS, achievement, parseTargetChanges, periodMonths, periodTarget, targetsComparable } from "./report-targets";
import { groupSources } from "./sales-pipeline";
import { weightedMargin } from "./owner-overview";
import { responseRate } from "./lead-response";

const fact = (dims: Record<string, string>, extra: Partial<Fact> = {}): Fact => ({
  id: "1", kind: "lead", parentId: null, reference: null, title: "", client: null, owner: null, ownerId: null, at: null, amount: null, measure: null, detail: null, dims, ...extra,
});

describe("management dashboard filters", () => {
  it("defaults to the current month to date and refuses bad input", () => {
    expect(parseFilters({}, "2026-09-20")).toMatchObject({ from: "2026-09-01", to: "2026-09-20", accountManager: null });
    expect(() => parseFilters({ from: "2026-02-30" }, "2026-09-20")).toThrow("Choose a valid period");
    expect(() => parseFilters({ from: "2025-01-01", to: "2026-09-20" }, "2026-09-20")).toThrow("a year or less");
    expect(() => parseFilters({ entity: "nope" }, "2026-09-20")).toThrow("Invalid entity filter");
    expect(() => parseFilters({ source: "a'; drop" }, "2026-09-20")).toThrow("Invalid source filter");
    expect(parseFilters({ source: "returning_customer", channel: "old_leads" }, "2026-09-20")).toMatchObject({ source: "returning_customer", channel: "old_leads" });
  });

  it("reads today in the workspace's own time zone", () => {
    expect(localDate(new Date("2026-09-01T03:00:00Z"), "America/New_York")).toBe("2026-08-31");
    expect(localDate(new Date("2026-08-31T21:00:00Z"), "Asia/Dubai")).toBe("2026-09-01");
  });

  it("lists the trend's 12 months and 12 weeks on the workspace's week start", () => {
    expect(monthKeys({ to: "2026-02-10" })).toEqual(["2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
    // 20 Sep 2026 is a Sunday: a Monday week starts on the 14th, a Sunday week on the 20th, a Saturday week on the 19th.
    expect(weekKeys({ to: "2026-09-20" }, 1).at(-1)).toBe("2026-09-14");
    expect(weekKeys({ to: "2026-09-20" }, 0).at(-1)).toBe("2026-09-20");
    expect(weekKeys({ to: "2026-09-20" }, 6)).toHaveLength(12);
    expect(weekKeys({ to: "2026-09-20" }, 6)[0]).toBe("2026-07-04");
  });

  it("opens a bar by its dimensions only", () => {
    expect(parseBucket(undefined)).toEqual({ period: "1" });
    expect(parseBucket("month=2026-09;series=design")).toEqual({ month: "2026-09", series: "design" });
    const facts = [fact({ month: "2026-09", series: "design" }), fact({ month: "2026-09", series: "main" }), fact({ month: "2026-08", series: "design" })];
    expect(matchBucket(facts, parseBucket("month=2026-09;series=design"))).toHaveLength(1);
  });
});

describe("KPI targets", () => {
  it("covers each month the period touches by its days", () => {
    expect(periodMonths("2026-08-25", "2026-09-10")).toEqual([{ month: "2026-08", days: 7, daysInMonth: 31 }, { month: "2026-09", days: 10, daysInMonth: 30 }]);
    expect(periodMonths("2028-02-01", "2028-02-29")).toEqual([{ month: "2028-02", days: 29, daysInMonth: 29 }]);
  });

  it("prorates counts and money, averages levels, and has no target when a month has none", () => {
    const monthly = new Map([["2026-08", "31000"], ["2026-09", "30000"]]);
    expect(periodTarget(TARGET_KPIS.sales_won_value, "2026-08-25", "2026-09-10", monthly)).toBe("17000.0000");
    expect(periodTarget(TARGET_KPIS.response_rate, "2026-08-25", "2026-09-10", new Map([["2026-08", "90"], ["2026-09", "80"]]))).toBe("84.1176");
    expect(periodTarget(TARGET_KPIS.sales_won_value, "2026-08-25", "2026-10-01", monthly)).toBeNull();
  });

  it("colours achievement green from 100 %, amber from 80 %, red below; lower is better for times", () => {
    expect(achievement(TARGET_KPIS.sales_won_value, "100", "100")).toMatchObject({ percent: "100.0", gap: "0.0000", tone: "success" });
    expect(achievement(TARGET_KPIS.sales_won_value, "80", "100")).toMatchObject({ percent: "80.0", gap: "20.0000", tone: "warning" });
    expect(achievement(TARGET_KPIS.sales_won_value, "79.99", "100")).toMatchObject({ tone: "danger" });
    expect(achievement(TARGET_KPIS.first_response_hours, "2", "1")).toMatchObject({ percent: "50.0", gap: "1.0000", tone: "danger" });
    expect(achievement(TARGET_KPIS.first_response_hours, "0.5", "1")).toMatchObject({ percent: "200.0", gap: "-0.5000", tone: "success" });
    expect(achievement(TARGET_KPIS.first_response_hours, "0", "1")).toMatchObject({ percent: null, tone: "success" });
  });

  it("compares targets only when the filters are the period and the Account Manager", () => {
    const base = parseFilters({}, "2026-09-20");
    expect(targetsComparable(base)).toBe(true);
    expect(targetsComparable({ ...base, accountManager: "00000000-0000-4000-8000-000000000001" })).toBe(true);
    expect(targetsComparable({ ...base, region: "dubai" })).toBe(false);
  });

  it("validates a save before anything is written", () => {
    const commandId = "00000000-0000-4000-8000-000000000001";
    expect(() => parseTargetChanges({ commandId, changes: [{ kpi: "made_up", month: "2026-09", target: "1" }] })).toThrow("Unknown KPI");
    expect(() => parseTargetChanges({ commandId, changes: [{ kpi: "new_leads", month: "2026-13", target: "1" }] })).toThrow("valid month");
    expect(() => parseTargetChanges({ commandId, changes: [{ kpi: "new_leads", month: "2026-09", target: "0" }] })).toThrow("above zero");
    expect(() => parseTargetChanges({ commandId, changes: [{ kpi: "new_leads", month: "2026-09", target: "1.5e3" }] })).toThrow("above zero");
    expect(() => parseTargetChanges({ commandId, changes: [{ kpi: "new_leads", month: "2026-09", target: "1" }, { kpi: "new_leads", month: "2026-09", target: "2" }] })).toThrow("once per save");
    expect(parseTargetChanges({ commandId, changes: [{ kpi: "new_leads", month: "2026-09", target: "12", version: 2 }] }).changes[0]).toEqual({ kpi: "new_leads", month: "2026-09", membershipId: null, target: "12", version: 2 });
  });
});

describe("KPI arithmetic", () => {
  it("keeps the five biggest sources and folds the rest into Other", () => {
    const facts = ["a", "a", "b", "c", "d", "e", "f", "f", "f"].map((source) => fact({ source }));
    expect(groupSources(facts).top).toEqual(["f", "a", "b", "c", "d"]);
    expect(facts.filter((item) => item.dims.sourceGroup === "other").map((item) => item.dims.source)).toEqual(["e"]);
  });

  it("weights margin by agreed value and leaves projects without a QS cost out", () => {
    expect(weightedMargin([fact({ cost: "known" }, { amount: "1000", detail: "750" }), fact({ cost: "known" }, { amount: "3000", detail: "2700" }), fact({ cost: "missing" })])).toBe("13.75");
    expect(weightedMargin([fact({ cost: "missing" })])).toBeNull();
  });

  it("rates responses over the clocks that have an outcome", () => {
    expect(responseRate([fact({ outcome: "met" }), fact({ outcome: "missed" }), fact({ outcome: "open" }), fact({ outcome: "met" })])).toBe("66.7");
    expect(responseRate([fact({ outcome: "open" })])).toBeNull();
  });
});
