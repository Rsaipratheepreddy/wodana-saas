import { describe, expect, it, vi } from "vitest";
import { AiToolRegistry, NEVER_PERMISSIONS, NEVER_TOOL_NAMES } from "../../ai-tools/ai-tools.registry";
import { toolContext } from "../../ai-tools/ai-tool-context";
import { validateToolInput } from "../../ai-tools/tool-kit";
import type { ToolServices } from "../../ai-tools/tool-services";
import { ageOpenItems, ageingBucket } from "./books-summary";
import { costBucket, marginVsQuote, projectFigures } from "./project-profit";
import { fiscalYearStart } from "./project-profit.service";

describe("project P&L from journal lines", () => {
  it("books each expense account by the first cost role it plays; labour absorbed is never a project cost", () => {
    expect(costBucket(["cost_materials"])).toBe("materials");
    expect(costBucket(["cost_site_expenses", "general_expense"])).toBe("siteExpenses");
    expect(costBucket(["cogs_goods"])).toBe("cogs");
    expect(costBucket(["general_expense"])).toBe("other");
    expect(costBucket([])).toBe("other");
    expect(costBucket(["labour_absorbed"])).toBeNull();
  });

  it("nets revenue and costs exactly, leaves balance-sheet lines out and gives the margin to two decimals", () => {
    const figures = projectFigures([
      { projectId: "p", accountType: "income", roles: ["revenue_project"], debit: "10000", credit: "100000" },
      { projectId: "p", accountType: "expense", roles: ["cost_materials"], debit: "15000.10", credit: "0.10" },
      { projectId: "p", accountType: "expense", roles: ["cost_labour"], debit: "8000", credit: "0" },
      { projectId: "p", accountType: "expense", roles: ["labour_absorbed"], debit: "0", credit: "8000" },
      { projectId: "p", accountType: "asset", roles: ["ar_control"], debit: "105000", credit: "0" },
      { projectId: "q", accountType: "expense", roles: ["cost_subcontract"], debit: "100", credit: "0" },
    ]);
    expect(figures.get("p")).toEqual({
      revenue: "90000.0000", totalCost: "23000.0000", profit: "67000.0000", marginPercent: "74.44",
      costs: { materials: "15000.0000", subcontract: "0.0000", labour: "8000.0000", siteExpenses: "0.0000", priceVariance: "0.0000", other: "0.0000", cogs: "0.0000" },
    });
    // Costs with nothing invoiced: a loss and no margin yet.
    expect(figures.get("q")).toMatchObject({ revenue: "0.0000", profit: "-100.0000", marginPercent: null });
    expect(marginVsQuote("49.72", "30.00")).toBe("19.72");
    expect(marginVsQuote(null, "30.00")).toBeNull();
  });
});

describe("the books summary", () => {
  it("ages open items first in first out by due date", () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91].map(ageingBucket)).toEqual(["current", "1_30", "1_30", "31_60", "31_60", "61_90", "61_90", "over_90"]);
    const ageing = ageOpenItems([
      { party: "a", amount: "105000", due: "2026-09-10" }, { party: "a", amount: "-60500", due: "2026-10-03" }, { party: "a", amount: "1000", due: "2026-11-05" },
      { party: "b", amount: "500", due: "2026-10-01" }, { party: "b", amount: "-700", due: "2026-10-02" },
    ], "2026-10-31");
    expect(ageing).toEqual({ current: "800.0000", "1_30": "0.0000", "31_60": "44500.0000", "61_90": "0.0000", over_90: "0.0000", total: "45300.0000" });
  });

  it("starts the financial year in its first month", () => {
    expect(fiscalYearStart("2026-10-08", 1)).toBe("2026-01-01");
    expect(fiscalYearStart("2026-10-08", 4)).toBe("2026-04-01");
    expect(fiscalYearStart("2026-02-08", 4)).toBe("2025-04-01");
  });
});

describe("Woddy's books tools", () => {
  const books = {
    findProjects: vi.fn(async () => [{ id: "p1", reference: "PRJ-1", name: "Villa 12", clientName: "Maya", status: "active" }, { id: "p2", reference: "PRJ-2", name: "Villa 14", clientName: "Omar", status: "active" }]),
    pnl: vi.fn(),
    summary: vi.fn(),
  };
  const registry = AiToolRegistry.catalogue({ books } as unknown as ToolServices);

  it("are read only, never named or permitted like money, and offered only with the Ledger or the Money tab's cost rights", () => {
    for (const name of ["project_profit", "books_report"]) {
      const tool = registry.get(name)!;
      expect(tool).toMatchObject({ kind: "read", confirmation: "none" });
      expect(NEVER_TOOL_NAMES.test(tool.name)).toBe(false);
      expect([...tool.permissions, ...(tool.anyPermissions ?? [])].filter((code) => NEVER_PERMISSIONS.test(code))).toEqual([]);
    }
    const names = (granted: string[]) => registry.offered(new Set(granted)).map((tool) => tool.name).filter((name) => ["project_profit", "books_report"].includes(name));
    expect(names([])).toEqual([]);
    expect(names(["projects.view", "receivables.view"])).toEqual([]);
    expect(names(["books.view"])).toEqual(["project_profit", "books_report"]);
    expect(names(["commercial.costs.view"])).toEqual(["project_profit"]);
    expect(names(["projects.costs.view"])).toEqual(["project_profit"]);
    expect(registry.permissionCodes).toEqual(expect.arrayContaining(["books.view", "projects.costs.view"]));
  });

  it("asks which project when a name matches more than one", async () => {
    const tool = registry.get("project_profit")!;
    const { context } = toolContext({ actor: { subject: "s", provider: "local", email: "s@example.com", displayName: "S" }, workspaceId: "w", runId: "r",
      asker: { userId: "u", membershipId: "m", permissions: new Set(["books.view"]), timeZone: "UTC", locale: "en" } });
    await expect(tool.run!(context, validateToolInput(tool.parameters, { project: "Villa" }))).rejects.toMatchObject({ name: "ToolQuestion", options: [{ label: "PRJ-1" }, { label: "PRJ-2" }] });
    await expect(tool.run!(context, validateToolInput(tool.parameters, {}))).rejects.toThrow(/which project/);
    expect(books.pnl).not.toHaveBeenCalled();
  });
});
