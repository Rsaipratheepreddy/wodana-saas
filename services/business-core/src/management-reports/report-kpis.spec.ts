import { describe, expect, it } from "vitest";
import { marginBand, portfolioMargin, salesFiltered } from "./finance";
import { LOAD_WEEKS, foldSteps, groupCentres, loadWeeks, onTimeRate, spreadLoad } from "./production-delivery";
import { byUrgency, change, matchBucket, monthKeys, parseBucket, weekKeys, type Fact } from "./report-kit";
import { localDate, parseFilters, previousPeriod } from "./report-scope";
import { sourceRates, topFive } from "./stock-marketing";
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

describe("comparison with the period before", () => {
  it("sets a month to date against the same days of the month before, other spans against the days just before", () => {
    expect(previousPeriod("2026-10-01", "2026-10-12")).toEqual({ from: "2026-09-01", to: "2026-09-12" });
    expect(previousPeriod("2026-09-01", "2026-09-30")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(previousPeriod("2026-03-01", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousPeriod("2026-03-01", "2026-03-30")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousPeriod("2026-07-01", "2026-08-15")).toEqual({ from: "2026-05-01", to: "2026-06-15" });
    expect(previousPeriod("2025-11-01", "2026-10-12")).toEqual({ from: "2024-11-01", to: "2025-10-12" });
    expect(previousPeriod("2026-09-10", "2026-09-19")).toEqual({ from: "2026-08-31", to: "2026-09-09" });
  });

  it("works out the change in exact decimals, with nothing to compare against a zero or a missing figure", () => {
    expect(change("30450.00", "1050.00")).toBe("2800.0");
    expect(change("50.0", "100.0")).toBe("-50.0");
    expect(change("-5", "-10")).toBe("50.0");
    expect(change("1", "0")).toBeNull();
    expect(change(null, "1")).toBeNull();
  });
});

describe("operations KPI arithmetic", () => {
  it("rates on time over the work orders with a planned end", () => {
    expect(onTimeRate([fact({ timing: "on_time" }), fact({ timing: "late" }), fact({ timing: "no_date" })])).toBe("50.0");
    expect(onTimeRate([fact({ timing: "no_date" })])).toBeNull();
  });

  it("folds a production step the firm doesn't keep into the one before", () => {
    const facts = foldSteps([fact({ step: "quality_check" }), fact({ step: "delivered" }), fact({ step: "ready" })], ["scheduled", "in_production", "ready"]);
    expect(facts.map((item) => item.dims.step)).toEqual(["in_production", "delivered", "ready"]);
  });

  it("spreads a work order's hours over its working days and weeks, from this week on the workspace's week start", () => {
    // 20 Sep 2026 is a Sunday: on a Monday week this week starts on the 14th.
    const weeks = loadWeeks("2026-09-20", 1);
    expect(weeks).toHaveLength(LOAD_WEEKS);
    expect(weeks.slice(0, 2)).toEqual(["2026-09-14", "2026-09-21"]);
    const weekday = (day: string) => ![0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay());
    const order = { id: "o1", number: 1, title: "Cabinet", projectId: "p", projectReference: "PRJ-1", client: null, owner: null, am: null, workcenterId: "w", workcenterName: "Joinery",
      hoursPerDay: "8", plannedStart: "2026-09-17", plannedEnd: "2026-09-22", plannedHours: "40" };
    // Thu, Fri (this week) and Mon, Tue (next): 10 hours a day.
    expect(spreadLoad([order], weeks, weekday, () => null).map((item) => [item.dims.week, item.measure])).toEqual([["2026-09-14", "20.0"], ["2026-09-21", "20.0"]]);
    expect(spreadLoad([{ ...order, plannedHours: null }], weeks, weekday, () => "32").map((item) => item.measure)).toEqual(["16.0", "16.0"]);
    const facts = spreadLoad(["a", "b", "c", "d", "e", "f"].map((id, index) => ({ ...order, id, workcenterId: id, plannedHours: String(10 + index) })), weeks, weekday, () => null);
    expect(groupCentres(facts)).toEqual({ top: ["f", "e", "d", "c", "b"], hasOther: true });
  });

  it("puts the most days late first in a needs-attention list", () => {
    const sorted = byUrgency([fact({}, { id: "a", measure: null }), fact({}, { id: "b", measure: "2" }), fact({}, { id: "c", measure: "10" }), fact({}, { id: "d", measure: "-5" })]);
    expect(sorted.map((item) => item.id)).toEqual(["c", "b", "d", "a"]);
  });

  it("bands project margins and weights them by revenue", () => {
    expect(marginBand("0", "0", "20")).toBe("no_revenue");
    expect(marginBand("1000", "-1", "20")).toBe("loss");
    expect(marginBand("1000", "150", "20.0")).toBe("below_target");
    expect(marginBand("1000", "200", "20.0")).toBe("on_target");
    expect(marginBand("1000", "100", null)).toBe("on_target");
    expect(portfolioMargin([fact({ currency: "base", profit: "250" }, { amount: "1000" }), fact({ currency: "base", profit: "-100" }, { amount: "1000" }),
      fact({ currency: "other", profit: "999" }, { amount: "1" }), fact({ currency: "base", profit: "0" }, { amount: "0" })])).toBe("7.5");
    expect(portfolioMargin([])).toBeNull();
  });

  it("keeps company records out under a sales filter only", () => {
    const base = parseFilters({}, "2026-09-20");
    expect(salesFiltered(base)).toBe(false);
    expect(salesFiltered({ ...base, entity: "00000000-0000-4000-8000-000000000001" })).toBe(false);
    expect(salesFiltered({ ...base, source: "website" })).toBe(true);
  });

  it("rates each source's enquiries through the funnel and keeps the five biggest groups", () => {
    expect(sourceRates([fact({ qualified: "1", proposal: "1", won: "1" }), fact({ qualified: "1", proposal: "0", won: "0" }), fact({ qualified: "0", proposal: "0", won: "0" })]))
      .toEqual({ qualified: "66.7", proposal: "33.3", won: "33.3" });
    expect(sourceRates([])).toEqual({ qualified: null, proposal: null, won: null });
    const facts = ["a", "a", "b", "c", "d", "e", "f", "f"].map((type) => fact({ type }));
    expect(topFive(facts, "type", "typeGroup")).toEqual({ top: ["a", "f", "b", "c", "d"], hasOther: true });
    expect(facts.filter((item) => item.dims.typeGroup === "other").map((item) => item.dims.type)).toEqual(["e"]);
  });
});
