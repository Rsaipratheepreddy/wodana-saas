import { describe, expect, it } from "vitest";
import * as shared from "../../../../../packages/contracts/src/financial-statements";
import * as local from "./statement-contract";

describe("financial statements contract", () => {
  it("is the same in business-core as in packages/contracts", () => {
    expect(local.FINANCIAL_STATEMENT_SOURCES).toEqual(shared.FINANCIAL_STATEMENT_SOURCES);
    expect(local.STATEMENT_BASES).toEqual(shared.STATEMENT_BASES);
    expect(local.STATEMENT_COMPARISONS).toEqual(shared.STATEMENT_COMPARISONS);
    expect(local.PNL_SECTIONS).toEqual(shared.PNL_SECTIONS);
    expect(local.PNL_REVENUE_CATEGORIES).toEqual(shared.PNL_REVENUE_CATEGORIES);
    expect(local.PNL_COST_CATEGORIES).toEqual(shared.PNL_COST_CATEGORIES);
    expect(local.CASH_FLOW_SECTIONS).toEqual(shared.CASH_FLOW_SECTIONS);
    expect(local.CASH_IN_ROWS).toEqual(shared.CASH_IN_ROWS);
    expect(local.CASH_OUT_ROWS).toEqual(shared.CASH_OUT_ROWS);
  });

  it("has structurally identical statements", () => {
    const pnl: shared.ProfitAndLossStatement = {} as local.ProfitAndLossStatement;
    const back: local.ProfitAndLossStatement = {} as shared.ProfitAndLossStatement;
    const flow: shared.CashFlowStatement = {} as local.CashFlowStatement;
    const flowBack: local.CashFlowStatement = {} as shared.CashFlowStatement;
    const settings: shared.StatementSourceSettings = {} as local.StatementSourceSettings;
    expect([pnl, back, flow, flowBack, settings]).toHaveLength(5);
  });
});
