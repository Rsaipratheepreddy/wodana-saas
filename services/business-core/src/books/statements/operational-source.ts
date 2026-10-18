import { accruedCosts, cashBefore, cashCosts, cashRevenue, Converter, dueSoon, invoicedRevenue, paymentCash, receiptCash } from "./documents";
import {
  buildCashFlow, buildForecast, buildProfitAndLoss, NOTE_CASH_BASIS, NOTE_NO_RATE, NOTE_OPERATIONAL, NOTE_OPERATIONAL_OPENING, NOTE_UNCOSTED,
} from "./statement-builder";
import type {
  CashFlowStatement, FinancialStatementProvider, ProfitAndLossStatement, StatementColumn, StatementQuery, StatementSourceCapabilities,
} from "./statement-contract";
import { forecastBuckets, monthsOf } from "./statement-period";
import type { StatementSourceAdapter, StatementSourceContext } from "./statement-source";

/**
 * Operational cash: statements from what Wodana records without full books. Accrual reads tax invoices (less
 * credit notes) as revenue and the project costs the Money tab counts plus bills outside projects as costs; cash
 * reads client payments, supplier payments and petty cash as they moved. Its cash flow has no bank accounts: the
 * opening is the net of what was recorded before the period.
 */

export const OPERATIONAL_CAPABILITIES: StatementSourceCapabilities = { accrual: true, cash: true, drillDown: false, cashAccounts: false, forecast: true };

const header = (ctx: StatementSourceContext, query: StatementQuery, notes: string[]) => ({
  source: "operational_cash" as const, sourceLabel: null, basis: query.basis, currency: ctx.currency, legalEntityId: ctx.legalEntityId,
  projectId: query.projectId ?? null, generatedAt: new Date().toISOString(), notes,
});

export class OperationalStatementProvider implements FinancialStatementProvider {
  readonly source = "operational_cash" as const;
  constructor(private readonly ctx: StatementSourceContext) {}

  async capabilities() { return OPERATIONAL_CAPABILITIES; }

  async profitAndLoss(query: StatementQuery): Promise<ProfitAndLossStatement> {
    const columns: StatementColumn[] = [{ key: "current", from: query.from, to: query.to, role: "current" }];
    const convert = new Converter(this.ctx);
    const notes = [NOTE_OPERATIONAL];
    if (query.basis === "cash") {
      const facts = [...await cashRevenue(this.ctx, query, 0, convert), ...await cashCosts(this.ctx, query, 0, convert)];
      notes.push(NOTE_CASH_BASIS);
      if (convert.missing) notes.push(NOTE_NO_RATE);
      return buildProfitAndLoss(header(this.ctx, query, notes), columns, facts);
    }
    const revenue = await invoicedRevenue(this.ctx, query, 0, convert);
    const costs = await accruedCosts(this.ctx, query, 0);
    if (convert.missing) notes.push(NOTE_NO_RATE);
    if (costs.uncosted) notes.push(NOTE_UNCOSTED);
    return buildProfitAndLoss(header(this.ctx, query, notes), columns, [...revenue, ...costs.facts]);
  }

  async cashFlow(query: StatementQuery): Promise<CashFlowStatement> {
    const months = monthsOf(query);
    const columns: StatementColumn[] = months.map((month, index) => ({ key: `m${index}`, from: month.from, to: month.to, role: "month" }));
    const convert = new Converter(this.ctx);
    const facts = [...await receiptCash(this.ctx, months, convert), ...await paymentCash(this.ctx, months, convert)];
    const opening = await cashBefore(this.ctx, query.from, convert);
    const notes = [NOTE_OPERATIONAL, NOTE_OPERATIONAL_OPENING];
    const statement = buildCashFlow(header(this.ctx, { ...query, basis: "cash" }, notes), columns, { facts, accounts: [], opening });
    if (query.to >= this.ctx.today) {
      const buckets = forecastBuckets(this.ctx.today);
      const due = await dueSoon(this.ctx, buckets, convert);
      const today = await cashBefore(this.ctx, buckets[0].from, convert);
      statement.forecast = buildForecast(buckets.map((bucket, index) => ({ key: `f${index}`, from: bucket.from, to: bucket.to, role: "forecast" })),
        due.receipts, due.payments, today);
    }
    if (convert.missing && !statement.notes.includes(NOTE_NO_RATE)) statement.notes.push(NOTE_NO_RATE);
    return statement;
  }
}

export const operationalStatementSource: StatementSourceAdapter = {
  source: "operational_cash",
  availability: async () => ({ available: true, label: null }),
  provider: (ctx) => new OperationalStatementProvider(ctx),
};
