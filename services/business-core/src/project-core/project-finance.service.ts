import { ForbiddenException, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { emptyFigures, ledgerLinks, projectCompany, projectFigures, readProjectMovements } from "../books/project/project-profit";
import { Dec } from "../catalog-core/decimal";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { cashByMonth, cashContext, cashConverter, readCashIn, readCashOut, readSpendingGuard, readUpcoming, spendingLock, type CashMonth, type SpendingLock,
  type Upcoming } from "./project-cash-flow";
import { moneyAccess, projectViewer } from "./project-access";
import { membershipOf, readProjects, type ProjectRow } from "./project-core.store";
import { COST_CATEGORIES, readProjectCommitted, readProjectCosts, readProjectIncome, type CostCategory } from "./project-money";
import { buildPnl, readContract, readInvoiced, readQuotedEstimate, readTargetMargin, withoutMargin, type PnlFigures } from "./project-pnl";

type Db = PoolClient;
const fixed = (value: Dec) => value.toFixed(4);

/**
 * Which figures the P&L is read from: always Wodana's own records; when the Ledger is on for the project's company, its
 * journals tagged with the project are compared with them (a difference means events still waiting to post).
 */
export type PnlBasis = {
  source: "operational";
  ledger: null | {
    company: string; currency: string; revenue: string; cost: string;
    /** Ledger less Wodana's records; null when kept in another currency. */
    revenueDifference: string | null; costDifference: string | null;
    matches: boolean | null; journals: string;
  };
};

export type ProjectPnlView = PnlFigures & {
  projectId: string; reference: string; name: string; asOf: string;
  estimate: { lines: number; missing: number };
  /** Costs without a price, labour rate or exchange rate (not counted). */
  uncosted: number;
  basis: PnlBasis;
  marginHidden: boolean;
};

export type ProjectCashFlowView = {
  projectId: string; currency: string; timeZone: string; asOf: string;
  months: CashMonth[];
  /** The project wallet: client money received less what was paid out for the project. */
  wallet: { received: string; paid: string; balance: string };
  upcoming: Upcoming;
  spendingLock: SpendingLock;
  /** Moves in another currency without an exchange rate (left out). */
  unconverted: number;
};

export type ProfitabilityRow = {
  projectId: string; reference: string; name: string; clientName: string; status: ProjectRow["status"]; href: string;
  contractCurrency: string; contractNet: string; variationsNet: string; revenue: string; received: string;
  cost: string; committed: string; forecastCost: string; budget: string | null;
  margin: string | null; marginPercent: string | null; forecastMargin: string | null; forecastMarginPercent: string | null;
  flags: PnlFigures["flags"]; comparable: boolean;
};

/** Every project's P&L figures from the records that caused them (shared by one project and the profitability report). */
export async function projectPnlFigures(db: Db, workspaceId: string, project: ProjectRow) {
  const costs = await readProjectCosts(db, workspaceId, project.id);
  const committed = await readProjectCommitted(db, workspaceId, project.id);
  const actual: Partial<Record<CostCategory, Dec>> = {};
  for (const entry of costs.entries) actual[entry.category] = (actual[entry.category] ?? Dec.ZERO).add(entry.amount);
  const context = await cashContext(db, workspaceId, project);
  const client = await readCashIn(db, context, cashConverter(db, context));
  const received = [...client.paid.values()].reduce((sum, amount) => sum.add(amount), Dec.ZERO);
  const estimate = await readQuotedEstimate(db, workspaceId, project);
  const figures = buildPnl({
    currency: costs.currency, contract: await readContract(db, workspaceId, project), invoiced: await readInvoiced(db, workspaceId, project.id), received: fixed(received),
    actual, committed: Object.fromEntries(committed.byCategory) as Partial<Record<CostCategory, Dec>>, estimate, targetMarginPercent: await readTargetMargin(db, workspaceId),
  });
  return { figures, costs, committed, context, estimate };
}

/** The Ledger's view of the same project, when the Ledger is on for its company. */
async function ledgerBasis(db: Db, workspaceId: string, projectId: string, figures: PnlFigures): Promise<PnlBasis> {
  const company = await projectCompany(db, workspaceId, projectId);
  if (!company?.enabled) return { source: "operational", ledger: null };
  const ledger = projectFigures(await readProjectMovements(db, workspaceId, company.legalEntityId, [projectId])).get(projectId) ?? emptyFigures();
  const revenueDifference = company.currency === figures.contractCurrency ? fixed(Dec.of(ledger.revenue).sub(figures.revenue.invoicedNet)) : null;
  const costDifference = company.currency === figures.currency ? fixed(Dec.of(ledger.totalCost).sub(figures.totals.actual)) : null;
  return {
    source: "operational",
    ledger: { company: company.name, currency: company.currency, revenue: ledger.revenue, cost: ledger.totalCost, revenueDifference, costDifference,
      matches: revenueDifference === null || costDifference === null ? null : Dec.of(revenueDifference).isZero() && Dec.of(costDifference).isZero(),
      journals: ledgerLinks.projectJournals(projectId) },
  };
}

/**
 * Project P&L and cash flow (plan §6.10 Money, §6.21), for the people who see a project's costs; margins only for those
 * who see margins (`moneyAccess`). Read only: every figure is worked out from the records that caused it.
 */
@Injectable()
export class ProjectFinanceService {
  constructor(private readonly access: WorkspaceAccessService) {}

  private async rights(client: Db, workspaceId: string, projectId: string, userId: string) {
    const viewer = await projectViewer(client, this.access, workspaceId, projectId, userId);
    const rights = await moneyAccess(client, this.access, workspaceId, userId, viewer);
    if (!rights.costs) throw new ForbiddenException("You don't see this project's costs.");
    return { project: viewer.project, margin: rights.margin };
  }

  pnl(actor: RequestActor, workspaceId: string, projectId: string): Promise<ProjectPnlView> {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const { project, margin } = await this.rights(client, workspaceId, projectId, user.userId);
      const { figures, costs, committed, context, estimate } = await projectPnlFigures(client, workspaceId, project);
      const view: ProjectPnlView = {
        ...figures, projectId, reference: project.reference, name: project.name, asOf: context.today, estimate: { lines: estimate.lines, missing: estimate.missing },
        uncosted: costs.uncosted + committed.unconverted, basis: await ledgerBasis(client, workspaceId, projectId, figures), marginHidden: !margin,
      };
      return margin ? view : { ...view, ...withoutMargin(view) };
    });
  }

  cashFlow(actor: RequestActor, workspaceId: string, projectId: string): Promise<ProjectCashFlowView> {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const { project } = await this.rights(client, workspaceId, projectId, user.userId);
      const context = await cashContext(client, workspaceId, project);
      const convert = cashConverter(client, context);
      const costs = await readProjectCosts(client, workspaceId, projectId);
      const committed = await readProjectCommitted(client, workspaceId, projectId);
      const cashIn = await readCashIn(client, context, convert);
      const cashOut = await readCashOut(client, context, convert, costs);
      const moves = [...cashIn.moves, ...cashOut.moves].sort((a, b) => a.on.localeCompare(b.on) || a.key.localeCompare(b.key));
      const received = moves.filter((move) => move.direction === "in").reduce((sum, move) => sum.add(move.amount), Dec.ZERO);
      const paid = moves.filter((move) => move.direction === "out").reduce((sum, move) => sum.add(move.amount), Dec.ZERO);
      const upcoming = await readUpcoming(client, context, convert, cashIn, cashOut.advancePaid);
      // The spending guard's own figure: money in hand = received − spent − committed (same currency only).
      const income = await readProjectIncome(client, workspaceId, project);
      const available = project.currency === context.home ? fixed(Dec.of(income.received).sub(costs.total).sub(committed.total)) : null;
      const start = project.startDate ?? new Date(project.startedAt).toISOString().slice(0, 10);
      return {
        projectId, currency: context.home, timeZone: context.timeZone, asOf: context.today,
        months: cashByMonth(moves, { from: start, to: context.today }),
        wallet: { received: fixed(received), paid: fixed(paid), balance: fixed(received.sub(paid)) },
        upcoming, spendingLock: spendingLock(await readSpendingGuard(client, workspaceId), available), unconverted: convert.unconverted,
      };
    });
  }

  /**
   * Projects profitability: every started project the person may see the costs of, with its agreed value, revenue,
   * cost, margin so far and expected margin and its flags. Margins only for people who see margins.
   */
  profitability(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const margin = await this.access.hasPermission(client, workspaceId, user.userId, "commercial.costs.view");
      let projects: ProjectRow[];
      if (margin) projects = await readProjects(client, workspaceId, null, true);
      else {
        if (!(await this.access.hasPermission(client, workspaceId, user.userId, "projects.costs.view"))) throw new ForbiddenException("You don't see project costs.");
        const all = await this.access.hasPermission(client, workspaceId, user.userId, "projects.manage");
        if (!all && !(await this.access.hasPermission(client, workspaceId, user.userId, "projects.view"))) throw new ForbiddenException("You don't see project costs.");
        projects = await readProjects(client, workspaceId, await membershipOf(client, workspaceId, user.userId), all);
      }
      const rows: ProfitabilityRow[] = [];
      let currency = "";
      for (const project of projects) {
        const { figures: full } = await projectPnlFigures(client, workspaceId, project);
        const figures = margin ? full : withoutMargin(full);
        currency = figures.currency;
        rows.push({
          projectId: project.id, reference: project.reference, name: project.name, clientName: project.clientName, status: project.status,
          href: `/workspace/projects/${project.id}/money`, contractCurrency: figures.contractCurrency, contractNet: figures.contract.net, variationsNet: figures.contract.variationsNet,
          revenue: figures.revenue.invoicedNet, received: figures.revenue.received, cost: figures.totals.actual, committed: figures.totals.committed,
          forecastCost: figures.totals.forecast, budget: figures.totals.budget, margin: figures.margin.toDate, marginPercent: figures.margin.toDatePercent,
          forecastMargin: figures.margin.forecast, forecastMarginPercent: figures.margin.forecastPercent, flags: figures.flags, comparable: figures.comparable,
        });
      }
      if (!currency) currency = (await client.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].currency;
      return { currency, marginHidden: !margin, target: margin ? await readTargetMargin(client, workspaceId) : null, categories: COST_CATEGORIES, rows };
    });
  }
}
