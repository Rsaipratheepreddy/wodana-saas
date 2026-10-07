import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Dec } from "../../catalog-core/decimal";
import { ToolInputError, ToolQuestion, type AiTool, type AiToolContext } from "../ai-tool";
import { PROJECT_PROFIT_PERMISSIONS, type ProjectPnlView } from "../../books/project/project-profit.service";
import { clip, ref } from "../tool-kit";
import type { ToolServices } from "../tool-services";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A module's refusal said plainly to the model. */
async function plainly<T>(what: string, work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof ForbiddenException) throw new ForbiddenException(`No access: this person can't see ${what}.`);
    if (error instanceof BadRequestException) throw new ToolInputError(error.message);
    throw error;
  }
}

function verdict(profit: string | null) {
  if (profit === null) return null;
  const sign = Dec.of(profit).cmp(0);
  return sign > 0 ? "made money" : sign < 0 ? "lost money" : "broke even";
}

function profitFacts(context: AiToolContext, pnl: Extract<ProjectPnlView, { enabled: true }>) {
  const project = { reference: pnl.reference, name: clip(pnl.name, 160), client: clip(pnl.clientName, 160), status: pnl.status };
  const facts: Record<string, unknown> = {
    source: context.cite({ type: "project", id: pnl.projectId, label: pnl.reference || pnl.name, href: pnl.links.project }),
    journals: context.cite({ type: "ledger_journals", id: pnl.projectId, label: `Ledger journals · ${pnl.reference || pnl.name}`, href: pnl.links.journals }),
    project, company: pnl.company.name, currency: pnl.currency, asOf: pnl.asOf,
    costs: Object.fromEntries(Object.entries(pnl.costs).filter(([, amount]) => !Dec.of(amount).isZero())), totalCost: pnl.totalCost,
    committedOnOpenOrders: { amount: pnl.committed, currency: pnl.committedCurrency, note: "Ordered and not yet received or billed: not in the costs yet." },
  };
  if (pnl.marginHidden)
    return { ...facts, marginHidden: true, note: "This person sees the project's costs but not its revenue, profit or margin. Give the costs only and say they can't see the margin; never work profit out." };
  return {
    ...facts,
    revenue: pnl.revenue, profit: pnl.profit, marginPercent: pnl.marginPercent, result: verdict(pnl.profit),
    quoted: pnl.quotedValue === null ? null : { value: pnl.quotedValue, currency: pnl.quoteCurrency, cost: pnl.quotedCost, marginPercent: pnl.quotedMarginPercent },
    marginVsQuotePoints: pnl.marginVsQuote,
    ...(pnl.quotedMarginPercent === null ? { quoteNote: "The quote has no planned cost, so there's no planned margin to compare with." } : {}),
    ...(Dec.of(pnl.revenue).isZero() ? { revenueNote: "Nothing invoiced yet, so there's no margin yet." } : {}),
  };
}

/**
 * Woddy's Ledger reads (plan §6.21b): a project's live profit and the books at a glance. Both run through the Ledger's
 * own service as the person, so the Money tab's cost and margin rules, the Ledger's `books.view` and the workspace's
 * RLS apply. Read only.
 */
export function booksTools(services: ToolServices): AiTool[] {
  const projectProfit: AiTool = {
    name: "project_profit",
    description: "Did a project make money? Its live profit from the Ledger (the firm's books), found by the project's name, reference or client (e.g. \"Villa 12\"), or the project the person is on: revenue invoiced (after credit notes, before tax), costs so far by type (materials, subcontract, labour, site expenses, price variance, other, cost of goods), profit, margin %, the margin the accepted quote planned and the difference in points, and spend still committed on open orders. Use it for every question about a project's profit, margin, losses or costs so far. Answer with the numbers and their currency, say whether it made or lost money, compare with the quote, and cite the project and its Ledger journals.",
    kind: "read",
    confirmation: "none",
    calls: "ProjectProfitService.pnl",
    permissions: [],
    anyPermissions: PROJECT_PROFIT_PERMISSIONS,
    parameters: {
      type: "object",
      properties: { project: { type: "string", description: "The project's name, reference or client, e.g. \"Villa 12\". Leave out for the project the person is on.", maxLength: 120 } },
    },
    async run(context, input) {
      const text = typeof input.project === "string" ? input.project.trim() : "";
      let projectId: string | null = null;
      if (text) {
        if (text.length < 2) throw new ToolInputError("Name the project with at least 2 characters");
        const found = await plainly("project costs", () => services.books.findProjects(context.actor, context.workspaceId, text));
        if (!found.length) return { data: { found: 0, note: `No project this person may see the costs of matches "${clip(text, 80)}".` } };
        const exact = found.filter((item) => [item.reference, item.name].some((value) => value?.toLocaleLowerCase() === text.toLocaleLowerCase()));
        if (found.length > 1 && exact.length !== 1)
          throw new ToolQuestion(`Which project do you mean?`, found.map((item) => ({ ...ref("project", item.id, item.reference || item.name), detail: [item.name, item.clientName].filter(Boolean).join(" · ") })));
        projectId = (exact[0] ?? found[0]).id;
      } else if (context.record?.type === "project") projectId = context.record.id;
      else throw new ToolInputError("Say which project, e.g. \"Villa 12\"");
      const id = projectId;
      const pnl = await plainly("this project's costs", async () => {
        try { return await services.books.pnl(context.actor, context.workspaceId, id); } catch (error) {
          if (error instanceof NotFoundException) throw new ToolInputError("That project wasn't found among the projects this person may see");
          throw error;
        }
      });
      if (!pnl.enabled)
        return { data: { source: context.cite(ref("project", pnl.projectId, pnl.reference || pnl.name)), project: { reference: pnl.reference, name: clip(pnl.name, 160) },
          ledger: "off", note: "The Ledger isn't on for this project's company, so there is no profit from the books. The project's Money tab shows what was spent." } };
      return { data: profitFacts(context, pnl) };
    },
  };

  const booksReport: AiTool = {
    name: "books_report",
    description: "The firm's Ledger (books) at a glance for one company and period (default: this financial year to today): the P&L summary (income, cost of sales, gross profit, operating expenses, net profit), cash, receivables (what clients owe) and payables (what we owe suppliers) at the period end, VAT due for the period (output less input), and receivables and payables ageing totals by days overdue (current, 1-30, 31-60, 61-90, over 90). Use it for questions like \"how much VAT do we owe for October?\", \"how much cash do we have?\", \"how much are clients overdue?\" or \"are we profitable this year?\". Quote the numbers with the currency and period and cite the report. For one project's profit use project_profit.",
    kind: "read",
    confirmation: "none",
    calls: "ProjectProfitService.summary",
    permissions: ["books.view"],
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "First day of the period, like 2026-10-01 (default: the start of this financial year)", maxLength: 10 },
        to: { type: "string", description: "Last day of the period, like 2026-10-31 (default: today)", maxLength: 10 },
        company: { type: "string", description: "The company's name, when the firm keeps books for more than one", maxLength: 120 },
      },
    },
    async run(context, input) {
      for (const key of ["from", "to"] as const) if (input[key] !== undefined && !DAY.test(String(input[key]))) throw new ToolInputError(`${key} must be a date like 2026-10-01`);
      const period = { from: input.from, to: input.to };
      let summary = await plainly("the Ledger", () => services.books.summary(context.actor, context.workspaceId, period));
      if (!summary.enabled) return { data: { ledger: "off", note: "The Ledger isn't on for any company yet." } };
      const wanted = typeof input.company === "string" ? input.company.trim().toLocaleLowerCase() : "";
      if (wanted) {
        const matches = summary.companies.filter((item) => item.name.toLocaleLowerCase().includes(wanted));
        if (!matches.length) throw new ToolInputError(`No company with the Ledger on is called "${clip(input.company, 80)}". They are: ${summary.companies.map((item) => item.name).join(", ")}`);
        if (matches.length > 1) throw new ToolQuestion("Which company do you mean?", matches.map((item) => ({ type: "company", id: item.id, label: item.name })));
        if (matches[0].id !== summary.company.id) {
          summary = await plainly("the Ledger", () => services.books.summary(context.actor, context.workspaceId, { ...period, entity: matches[0].id }));
          if (!summary.enabled) return { data: { ledger: "off" } };
        }
      }
      const scope = `${summary.company.id}:${summary.from}:${summary.to}`;
      return {
        data: {
          source: context.cite({ type: "ledger_report", id: `profit-and-loss:${scope}`, label: `P&L ${summary.from} to ${summary.to}`, href: summary.links.profitAndLoss }),
          company: summary.company.name, currency: summary.currency, period: { from: summary.from, to: summary.to },
          ...(summary.companies.length > 1 ? { otherCompanies: summary.companies.filter((item) => item.id !== summary.company.id).map((item) => item.name) } : {}),
          profitAndLoss: summary.profitAndLoss,
          balancesAtEnd: { ...summary.balances, source: context.cite({ type: "ledger_report", id: `balance-sheet:${summary.company.id}:${summary.to}`, label: `Balance sheet at ${summary.to}`, href: summary.links.balanceSheet }) },
          vat: { ...summary.vat, source: context.cite({ type: "ledger_report", id: `vat:${scope}`, label: `VAT ${summary.from} to ${summary.to}`, href: summary.links.vat }) },
          receivablesAgeing: { ...summary.receivablesAgeing, source: context.cite({ type: "ledger_report", id: `ar-ageing:${summary.company.id}:${summary.to}`, label: `Receivables ageing at ${summary.to}`, href: summary.links.receivablesAgeing }) },
          payablesAgeing: { ...summary.payablesAgeing, source: context.cite({ type: "ledger_report", id: `ap-ageing:${summary.company.id}:${summary.to}`, label: `Payables ageing at ${summary.to}`, href: summary.links.payablesAgeing }) },
        },
      };
    },
  };

  return [projectProfit, booksReport];
}
