import { addColumns, amountOf, labelKey, mergeColumns } from "./statement-math";
import { buildCashFlow, buildProfitAndLoss, type ActivitySection, type ReadSection } from "./statement-build";
import type { CashFlowStatement, Money, PnlSectionKey, ProfitAndLossStatement, StatementColumn, StatementHeader, StatementRow } from "./statement-types";

/**
 * Zoho Books reports (profitandloss, cashflow) mapped into the shared statement shapes. A report is a tree of named
 * groups ("Gross Profit" › "Operating Income" › accounts), each with its total and its children under
 * `account_transactions`. Zoho reads one period per call, so a cash flow by month is one report per month, merged
 * here into one column per month. Amounts arrive as exact decimal text.
 */

export type ZohoNode = Record<string, unknown> & { name?: unknown; account_name?: unknown; account_id?: unknown; account_code?: unknown; total?: unknown };
export type ZohoReport = Record<string, unknown>;

type Meta = Omit<StatementHeader, "columns" | "notes" | "source">;
const meta = (value: Meta) => ({ ...value, source: "zoho_books" as const });

const CHILDREN = ["account_transactions", "accounts", "sub_accounts", "children"] as const;
const AMOUNTS = ["total", "amount", "value"] as const;

const children = (node: ZohoNode): ZohoNode[] => {
  for (const key of CHILDREN) if (Array.isArray(node[key])) return (node[key] as unknown[]).filter((item): item is ZohoNode => Boolean(item) && typeof item === "object");
  return [];
};
const amountOfNode = (node: ZohoNode): Money => {
  for (const key of AMOUNTS) if (node[key] !== undefined && node[key] !== null && node[key] !== "") return amountOf(node[key]);
  return amountOf(0);
};
const nameOf = (node: ZohoNode) => String(node.name ?? node.account_name ?? "").trim();
const normal = (name: string) => name.toLocaleLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();

/** The report's top-level groups, under whichever key this Zoho version uses. */
function roots(report: ZohoReport, keys: readonly string[]): ZohoNode[] {
  for (const key of keys) if (Array.isArray(report[key])) return (report[key] as unknown[]).filter((item): item is ZohoNode => Boolean(item) && typeof item === "object");
  return [];
}

/** One node as a statement row (one column): an account, or a group with its children. */
export function zohoRow(node: ZohoNode): StatementRow {
  const label = nameOf(node);
  const id = node.account_id === undefined || node.account_id === null || node.account_id === "" ? "" : String(node.account_id);
  const code = typeof node.account_code === "string" && node.account_code ? node.account_code : null;
  const kids = children(node).map(zohoRow);
  return { key: id ? `account:${id}` : `group:${labelKey(label)}`, label, ...(code ? { code } : {}), amounts: [amountOfNode(node)], ...(kids.length ? { rows: kids } : {}) };
}

export function pnlSectionOf(name: string): PnlSectionKey | null {
  const value = normal(name);
  if (/^(non operating|other) income$/.test(value)) return "other_income";
  if (/^(non operating|other) expenses?$/.test(value)) return "other_expenses";
  if (/^(operating income|income|sales|revenue)$/.test(value)) return "revenue";
  if (/^(cost of goods sold|cost of sales|cogs)$/.test(value)) return "cost_of_sales";
  if (/^(operating expenses?|expenses?)$/.test(value)) return "operating_expenses";
  return null;
}

type CashFigure = "opening" | "closing" | "net";
export function cashGroupOf(name: string): ActivitySection | CashFigure | null {
  const value = normal(name);
  if (/beginning|opening/.test(value)) return "opening";
  if (/ending|closing/.test(value)) return "closing";
  if (/^net (change|increase|decrease)/.test(value)) return "net";
  if (/operating/.test(value)) return "operating_activities";
  if (/investing/.test(value)) return "investing_activities";
  if (/financing/.test(value)) return "financing_activities";
  return null;
}

/** One period's P&L: the sections it has and Zoho's own net profit (one column each). */
function readPnl(report: ZohoReport) {
  const sections = new Map<PnlSectionKey, { rows: StatementRow[]; total: Money }>();
  const provider: { net: Money | null } = { net: null };
  const visit = (nodes: ZohoNode[]) => {
    for (const node of nodes) {
      const name = nameOf(node);
      const key = pnlSectionOf(name);
      if (key) {
        const found = sections.get(key) ?? { rows: [], total: amountOf(0) };
        found.rows.push(...children(node).map(zohoRow));
        found.total = addColumns([found.total], [amountOfNode(node)])[0];
        sections.set(key, found);
        continue;
      }
      if (/^net (profit|loss)/.test(normal(name))) provider.net = amountOfNode(node);
      visit(children(node));
    }
  };
  visit(roots(report, ["profit_and_loss", "profitandloss", "profit_loss"]));
  return { sections, net: provider.net };
}

function readCash(report: ZohoReport) {
  const sections = new Map<ActivitySection, { rows: StatementRow[]; total: Money }>();
  const figures: Partial<Record<CashFigure, Money>> = {};
  const visit = (nodes: ZohoNode[]) => {
    for (const node of nodes) {
      const group = cashGroupOf(nameOf(node));
      if (group === "opening" || group === "closing" || group === "net") { figures[group] = amountOfNode(node); continue; }
      if (group) {
        const found = sections.get(group) ?? { rows: [], total: amountOf(0) };
        found.rows.push(...children(node).map(zohoRow));
        found.total = addColumns([found.total], [amountOfNode(node)])[0];
        sections.set(group, found);
        continue;
      }
      visit(children(node));
    }
  };
  visit(roots(report, ["cash_flow", "cashflow", "cash_flow_statement"]));
  return { sections, figures };
}

/** Per-period sections merged into one section per key with a column per period. */
function mergeSections<K extends string>(periods: Array<Map<K, { rows: StatementRow[]; total: Money }>>, keys: readonly K[]): ReadSection[] {
  return keys.filter((key) => periods.some((period) => period.has(key))).map((key) => ({
    key,
    rows: mergeColumns(periods.map((period) => period.get(key)?.rows ?? [])),
    total: periods.map((period) => period.get(key)?.total ?? amountOf(0)),
  }));
}

/** A P&L from one report per column (one for the period). */
export function mapZohoProfitAndLoss(reports: ZohoReport[], header: Meta, columns: StatementColumn[]): ProfitAndLossStatement {
  if (reports.length !== columns.length) throw new TypeError("The accounting system returned a different number of periods.");
  const read = reports.map(readPnl);
  const sections = mergeSections(read.map((item) => item.sections), ["revenue", "cost_of_sales", "operating_expenses", "other_income", "other_expenses"] as const);
  const net = read.every((item) => item.net !== null) ? read.map((item) => item.net as Money) : null;
  return buildProfitAndLoss(meta(header), columns, sections, net);
}

/** A cash flow from one report per month. */
export function mapZohoCashFlow(reports: ZohoReport[], header: Meta, columns: StatementColumn[]): CashFlowStatement {
  if (reports.length !== columns.length) throw new TypeError("The accounting system returned a different number of periods.");
  const read = reports.map(readCash);
  const sections = mergeSections(read.map((item) => item.sections), ["operating_activities", "investing_activities", "financing_activities"] as const);
  const figure = (key: CashFigure) => (read.every((item) => item.figures[key] !== undefined) ? read.map((item) => item.figures[key] as Money) : null);
  return buildCashFlow(meta(header), columns, sections, { net: figure("net"), opening: figure("opening"), closing: figure("closing") });
}
