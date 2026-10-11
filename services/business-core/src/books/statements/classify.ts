import type { PnlCostCategory, PnlRevenueCategory, PnlSectionKey } from "./statement-contract";

/**
 * Where an account's amounts go on the P&L: its section, and for revenue and cost of sales its category, from the
 * posting role it plays (or the template key it was created from), never from its code or name.
 */

export type AccountClass = { type: string; subtype: string; roles: readonly string[]; templateKey: string | null };

const has = (account: AccountClass, ...keys: string[]) => keys.some((key) => account.roles.includes(key) || account.templateKey === key);

/** A revenue line by the quotation it was invoiced from: variations, the design round, else production and fit-out. */
export function revenueCategoryOfQuote(quote: { kind: string | null; round: string | null } | null): PnlRevenueCategory {
  if (quote?.kind === "variation") return "variations";
  if (quote?.round === "design") return "design_fees";
  return "production";
}

export type PnlPlace = { section: PnlSectionKey; category: PnlRevenueCategory | PnlCostCategory | null };

/**
 * The section and category of an income or expense account. `hint` is what the journal knows about the line:
 * the revenue category of the quotation it was invoiced from, or `factory` for labour reported on a work order.
 */
export function placeOfAccount(account: AccountClass, hint: string | null): PnlPlace | null {
  if (account.type === "income") {
    if (account.subtype === "other_income") return { section: "other_income", category: null };
    if (has(account, "revenue_project", "project_revenue")) {
      return { section: "revenue", category: hint === "design_fees" || hint === "variations" || hint === "production" ? hint : "production" };
    }
    if (has(account, "design_fees")) return { section: "revenue", category: "design_fees" };
    return { section: "revenue", category: "other_revenue" };
  }
  if (account.type !== "expense") return null;
  if (account.subtype === "other_expense") return { section: "other_expenses", category: null };
  if (account.subtype !== "cost_of_sales") return { section: "operating_expenses", category: null };
  if (has(account, "cost_materials", "cogs_goods", "cost_price_variance", "project_materials", "cogs", "price_variance")) return { section: "cost_of_sales", category: "materials" };
  if (has(account, "cost_labour", "labour")) return { section: "cost_of_sales", category: hint === "factory" ? "factory" : "subcontract_labour" };
  if (has(account, "cost_subcontract", "subcontract", "labour_absorbed")) return { section: "cost_of_sales", category: "subcontract_labour" };
  return { section: "cost_of_sales", category: "other_costs" };
}
