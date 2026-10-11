import { describe, expect, it } from "vitest";
import { addDays, cashByMonth, dayIn, spendingLock, upcomingBuckets, type CashMove, type UpcomingItem } from "./project-cash-flow";
import { roleCategory, supplyCategory } from "./project-money";
import { buildPnl, componentCategory, estimateByCategory, lineCategory, percentOf, withoutMargin, type EstimateLine, type PnlInput } from "./project-pnl";

const line = (value: Partial<EstimateLine>): EstimateLine => ({ quantity: "1", unitCost: "0", kind: "item", credit: false, supply: null, components: [], ...value });

describe("cost categories", () => {
  it("follow the package's way of delivery, the line's kind, and a charge's Ledger account role", () => {
    expect(supplyCategory("make", "materials")).toBe("factory");
    expect(supplyCategory("subcontract", "materials")).toBe("subcontract_labour");
    expect(supplyCategory("site_work", "materials")).toBe("subcontract_labour");
    expect(supplyCategory("ready_made", "other")).toBe("materials");
    expect(supplyCategory(null, "other")).toBe("other");
    expect(lineCategory({ kind: "service", supply: null })).toBe("subcontract_labour");
    expect(lineCategory({ kind: "item", supply: "client" })).toBe("materials");
    expect(lineCategory({ kind: "allowance", supply: null })).toBe("other");
    expect(componentCategory("labour", "buy")).toBe("subcontract_labour");
    expect(componentCategory("hardware", "buy")).toBe("materials");
    expect(componentCategory("labour", "make")).toBe("factory");
    expect(roleCategory(["cost_site_expenses"])).toBe("site_expenses");
    expect(roleCategory(["cost_subcontract"])).toBe("subcontract_labour");
    expect(roleCategory(null)).toBe("other");
  });
});

describe("the quotation's cost estimate", () => {
  it("prices each line at its unit cost, splits a build-up by its parts' cost and credits removals", () => {
    const estimate = estimateByCategory([
      line({ quantity: "2", unitCost: "1500", supply: "make" }),
      line({ quantity: "10", unitCost: "33.333", supply: "buy" }),
      // A build-up: 3 kg of material at 20 (+10 % waste) = 66 and 1 hour of labour at 34 = 34; client-supplied parts weigh nothing.
      line({ quantity: "3", unitCost: "100", supply: "site_work", components: [
        { kind: "material", quantity: "3", unitCost: "20", wastePercent: "10", suppliedByClient: false },
        { kind: "labour", quantity: "1", unitCost: "34", wastePercent: null, suppliedByClient: false },
        { kind: "finish", quantity: "5", unitCost: "9", wastePercent: null, suppliedByClient: true },
      ] }),
      line({ quantity: "1", unitCost: "200", supply: "buy", credit: true }),
      line({ quantity: "4", unitCost: null }),
      line({ quantity: "1", unitCost: "75", kind: "service" }),
    ], 2);
    expect(estimate.byCategory.factory.toFixed(4)).toBe("3000.0000");
    // 333.33 for the bought line, 198 of the build-up's 300, less the 200 credit.
    expect(estimate.byCategory.materials.toFixed(4)).toBe("331.3300");
    expect(estimate.byCategory.subcontract_labour.toFixed(4)).toBe("177.0000");
    expect(estimate.total.toFixed(4)).toBe("3508.3300");
    expect(estimate.missing).toBe(1);
  });

  it("gives a split's rounding rest to its largest part so the line still adds up", () => {
    const estimate = estimateByCategory([line({ quantity: "1", unitCost: "10", supply: "buy", components: [
      { kind: "material", quantity: "1", unitCost: "1", wastePercent: null, suppliedByClient: false },
      { kind: "labour", quantity: "1", unitCost: "1", wastePercent: null, suppliedByClient: false },
      { kind: "other", quantity: "1", unitCost: "1", wastePercent: null, suppliedByClient: false },
    ] })], 2);
    expect([estimate.byCategory.materials, estimate.byCategory.subcontract_labour, estimate.byCategory.other].map((value) => value.toFixed(2))).toEqual(["3.34", "3.33", "3.33"]);
    expect(estimate.total.toFixed(2)).toBe("10.00");
  });
});

const contract = (currency = "AED") => ({
  currency,
  baseline: { sealId: "s1", label: "R2", net: "100000.0000", total: "105000.0000", acceptedAt: "2026-07-01T08:00:00.000Z" },
  variations: [{ sealId: "s2", label: "VO-1", net: "10000.0000", total: "10500.0000", acceptedAt: "2026-09-01T08:00:00.000Z" }],
});
const input = (value: Partial<PnlInput> = {}): PnlInput => ({
  currency: "AED", contract: contract(), invoiced: { net: "40000.0000", total: "42000.0000" }, received: "52500.0000",
  actual: { materials: "30000", factory: "10000", subcontract_labour: "5000", site_expenses: "1000" },
  committed: { materials: "5000", factory: "2000" },
  estimate: { currency: "AED", byCategory: { materials: "40000.0000", factory: "10000.0000", subcontract_labour: "8000.0000", site_expenses: "0.0000", other: "0.0000" },
    total: "58000.0000", lines: 12, missing: 0 },
  targetMarginPercent: "25.0",
  ...value,
});

describe("the project P&L", () => {
  it("compares each category's spend and commitments with the quotation, and works out the margin so far and at completion", () => {
    const pnl = buildPnl(input());
    expect(pnl.contract).toMatchObject({ baselineNet: "100000.0000", variationsNet: "10000.0000", net: "110000.0000", total: "115500.0000" });
    expect(pnl.revenue).toEqual({ invoicedNet: "40000.0000", invoicedTotal: "42000.0000", received: "52500.0000" });
    expect(pnl.categories).toEqual([
      { category: "materials", budget: "40000.0000", actual: "30000.0000", committed: "5000.0000", remaining: "5000.0000", forecast: "40000.0000", variance: "0.0000",
        usedPercent: "87.5", over: false },
      { category: "factory", budget: "10000.0000", actual: "10000.0000", committed: "2000.0000", remaining: "0.0000", forecast: "12000.0000", variance: "-2000.0000",
        usedPercent: "120.0", over: true },
      { category: "subcontract_labour", budget: "8000.0000", actual: "5000.0000", committed: "0.0000", remaining: "3000.0000", forecast: "8000.0000", variance: "0.0000",
        usedPercent: "62.5", over: false },
      // Nothing was planned for site expenses: no budget to run over.
      { category: "site_expenses", budget: null, actual: "1000.0000", committed: "0.0000", remaining: "0.0000", forecast: "1000.0000", variance: null, usedPercent: null, over: false },
    ]);
    expect(pnl.totals).toEqual({ budget: "58000.0000", actual: "46000.0000", committed: "7000.0000", remaining: "8000.0000", forecast: "61000.0000" });
    expect(pnl.margin).toEqual({ toDate: "-6000.0000", toDatePercent: "-15.0", forecast: "49000.0000", forecastPercent: "44.5", target: "25.0" });
    expect(pnl.flags).toEqual([{ code: "over_budget", category: "factory", amount: "2000.0000" }]);
  });

  it("flags a margin below the firm's target, a loss, and lines without a cost", () => {
    const tight = buildPnl(input({ committed: { materials: "5000", factory: "2000", other: "30000" }, estimate: { ...input().estimate, missing: 2 } }));
    // 110000 − 91000 = 19000, 17.3 % < 25 %.
    expect(tight.margin.forecastPercent).toBe("17.3");
    expect(tight.flags).toEqual([{ code: "over_budget", category: "factory", amount: "2000.0000" }, { code: "below_target", forecastPercent: "17.3", target: "25.0" },
      { code: "estimate_incomplete", count: 2 }]);
    const loss = buildPnl(input({ committed: { other: "80000" } }));
    // 40000 + 10000 + 8000 + 1000 + 80000 = 139000 expected against 110000 agreed.
    expect(loss.flags).toContainEqual({ code: "forecast_loss", amount: "29000.0000" });
    expect(loss.flags.some((flag) => flag.code === "below_target")).toBe(false);
    const unplanned = buildPnl(input({ estimate: { currency: "AED", byCategory: null, total: null, lines: 3, missing: 0 } }));
    expect(unplanned.flags).toEqual([{ code: "no_estimate" }]);
    expect(unplanned.totals.budget).toBeNull();
  });

  it("shows no margin or budget when the project and its costs are kept in different currencies", () => {
    const pnl = buildPnl(input({ contract: contract("USD") }));
    expect(pnl.comparable).toBe(false);
    expect(pnl.margin).toMatchObject({ toDate: null, forecast: null, forecastPercent: null });
    expect(pnl.categories.every((row) => row.budget === null)).toBe(true);
    expect(pnl.flags).toEqual([]);
  });

  it("hides the margin and the flags that would give it away", () => {
    const hidden = withoutMargin(buildPnl(input({ committed: { other: "80000" } })));
    expect(hidden.margin).toEqual({ toDate: null, toDatePercent: null, forecast: null, forecastPercent: null, target: null });
    expect(hidden.flags.map((flag) => flag.code)).toEqual([]);
    expect(percentOf("1", "0")).toBeNull();
  });
});

describe("the project's cash", () => {
  const move = (on: string, direction: "in" | "out", amount: string): CashMove => ({ key: `${on}:${direction}:${amount}`, on, direction, kind: direction === "in" ? "client_receipt" : "supplier_payment",
    amount, reference: null });

  it("buckets money in and out by month, keeps the empty months and runs the balance", () => {
    expect(cashByMonth([move("2026-09-03", "in", "52500.0000"), move("2026-09-20", "out", "10000.0000"), move("2026-11-02", "out", "2500.5000")],
      { from: "2026-08-15", to: "2026-11-11" })).toEqual([
      { month: "2026-08", in: "0.0000", out: "0.0000", net: "0.0000", cumulativeIn: "0.0000", cumulativeOut: "0.0000", balance: "0.0000" },
      { month: "2026-09", in: "52500.0000", out: "10000.0000", net: "42500.0000", cumulativeIn: "52500.0000", cumulativeOut: "10000.0000", balance: "42500.0000" },
      { month: "2026-10", in: "0.0000", out: "0.0000", net: "0.0000", cumulativeIn: "52500.0000", cumulativeOut: "10000.0000", balance: "42500.0000" },
      { month: "2026-11", in: "0.0000", out: "2500.5000", net: "-2500.5000", cumulativeIn: "52500.0000", cumulativeOut: "12500.5000", balance: "39999.5000" },
    ]);
    expect(cashByMonth([], { from: null, to: "2026-11-11" })).toEqual([]);
  });

  it("dates money on the workspace's calendar day, not the server's", () => {
    // 21:30 UTC on 30 September is already 1 October in a zone four hours ahead, and still 30 September five hours behind.
    expect(dayIn("2026-09-30T21:30:00Z", "Asia/Dubai")).toBe("2026-10-01");
    expect(dayIn("2026-09-30T21:30:00Z", "America/New_York")).toBe("2026-09-30");
    expect(cashByMonth([move(dayIn("2026-09-30T21:30:00Z", "Asia/Dubai"), "in", "100.0000")], { to: "2026-10-05" }).map((row) => row.month)).toEqual(["2026-10"]);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("splits what's due into overdue and the next 30, 60 and 90 days, and leaves out what's later", () => {
    const item = (key: string, direction: "in" | "out", due: string | null, amount = "100.0000"): UpcomingItem => ({ key, direction, kind: direction === "in" ? "milestone" : "bill",
      label: key, due, amount });
    const upcoming = upcomingBuckets([item("late", "in", "2026-10-01"), item("soon", "out", "2026-11-10", "40.0000"), item("next", "in", "2026-11-11"),
      item("later", "out", "2027-01-09"), item("far", "in", "2027-01-10"), item("undated", "out", null, "7.0000"), item("nothing", "in", "2026-10-20", "0.0000")], "2026-10-11");
    expect(upcoming.buckets).toEqual([
      { key: "overdue", from: null, to: "2026-10-10", in: "100.0000", out: "0.0000", net: "100.0000" },
      { key: "days_0_30", from: "2026-10-11", to: "2026-11-10", in: "0.0000", out: "40.0000", net: "-40.0000" },
      { key: "days_31_60", from: "2026-11-11", to: "2026-12-10", in: "100.0000", out: "0.0000", net: "100.0000" },
      { key: "days_61_90", from: "2026-12-11", to: "2027-01-09", in: "0.0000", out: "100.0000", net: "-100.0000" },
    ]);
    expect(upcoming.undated).toEqual({ in: "0.0000", out: "7.0000" });
    expect(upcoming.items.map((entry) => entry.key)).toEqual(["late", "soon", "next", "later", "undated"]);
  });

  it("says what the spending guard does with the next order", () => {
    expect(spendingLock("off", "-10.0000").state).toBe("off");
    expect(spendingLock("strict", "10.0000").state).toBe("clear");
    expect(spendingLock("strict", "0.0000").state).toBe("locked");
    expect(spendingLock("warn", "-5.0000").state).toBe("warn");
    expect(spendingLock("strict", null).state).toBe("clear");
  });
});
