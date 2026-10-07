import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { BooksPostingService } from "../posting/posting.service";
import type { PoolClient } from "pg";
import type { RequestActor } from "../../auth/actor";
import { moneyAccess, projectViewer } from "../../project-core/project-access";
import { membershipOf, readProject, readProjects } from "../../project-core/project-core.store";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { readBooksSettings } from "../ledger/ledger";
import { readBooksSummary } from "./books-summary";
import {
  companyToday, emptyFigures, ledgerCompanies, ledgerLinks, marginVsQuote, projectCompany, projectFigures, readCommitted, readProjectMovements,
  readQuotedPlans, reconcileSpent, type Company, type ProjectCosts,
} from "./project-profit";

const BOOKS_VIEW = "books.view";
/** Who may read project profit at all: the Ledger, or the Money tab's cost rights (plan §6.21b, reusing `moneyAccess`). */
export const PROJECT_PROFIT_PERMISSIONS = [BOOKS_VIEW, "commercial.costs.view", "projects.costs.view"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = PoolClient;
/** What the person may see of a project's profit: its costs, and (unless they only see a project's own costs) the margin. */
type Rights = { margin: boolean };

export type ProjectProfitFigures = {
  revenue: string; costs: ProjectCosts; totalCost: string;
  /** Hidden (null) for people who see a project's costs but not margins. */
  profit: string | null; marginPercent: string | null;
  quotedValue: string | null; quoteCurrency: string | null; quotedCost: string | null; quotedMarginPercent: string | null;
  /** Actual margin less the quoted margin, in percentage points. */
  marginVsQuote: string | null;
  /** On open orders, not yet received or billed (the Money tab's committed), in `committedCurrency`. */
  committed: string; committedCurrency: string;
};

export type ProjectPnlView =
  | { enabled: false; projectId: string; reference: string; name: string; company: { id: string; name: string } | null }
  | (ProjectProfitFigures & {
      enabled: true; projectId: string; reference: string; name: string; clientName: string; status: string;
      company: { id: string; name: string }; currency: string; asOf: string; marginHidden: boolean;
      /** The Ledger's cost against the Money tab's "spent" for the same project. */
      reconciliation: { moneySpent: string; moneyCurrency: string; uncosted: number; difference: string | null; matches: boolean | null };
      links: { project: string; journals: string };
    });

export type ProjectsProfitRow = ProjectProfitFigures & {
  projectId: string; reference: string; name: string; clientName: string; status: string; links: { project: string; journals: string };
};

const hideMargin = <T extends ProjectProfitFigures>(row: T): T => ({ ...row, profit: null, marginPercent: null, quotedCost: null, quotedMarginPercent: null, marginVsQuote: null });

function day(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} must be a date like 2026-10-01.`);
  return value;
}

/**
 * Live project profit (plan §6.21b, slice E): one project's P&L from the Ledger with its quoted margin, committed
 * spend and the reconciliation to the Money tab, and the Projects profit grid for one company and period. Read only;
 * permissions follow the Money tab (`moneyAccess`) plus the Ledger's `books.view`.
 */
@Injectable()
export class ProjectProfitService {
  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly posting?: BooksPostingService) {}

  /** Brings the Ledger up to date before it is read, so profit includes what happened a moment ago; a busy or failed sweep never blocks the read. */
  private async fresh(workspaceId: string) {
    await this.posting?.runSweepNow(workspaceId).catch(() => undefined);
  }

  /** One project's P&L so far, for people who see its costs; margin only for those who see margins. */
  async pnl(actor: RequestActor, workspaceId: string, projectId: string): Promise<ProjectPnlView> {
    if (!UUID.test(projectId)) throw new BadRequestException("Project is not valid.");
    await this.fresh(workspaceId);
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const rights = await this.projectRights(client, workspaceId, projectId, user.userId);
      return this.projectPnl(client, workspaceId, projectId, rights);
    });
  }

  /** Every project with Ledger postings in one company and period: revenue, costs by type, profit, margin against the quote, committed spend. */
  async projectsProfit(actor: RequestActor, workspaceId: string, query: { entity?: unknown; from?: unknown; to?: unknown }) {
    await this.fresh(workspaceId);
    return this.access.withAnyPermission(actor, workspaceId, PROJECT_PROFIT_PERMISSIONS, async (client, user) => {
      const companies = await ledgerCompanies(client, workspaceId);
      const choices = companies.map((item) => ({ id: item.legalEntityId, name: item.name }));
      const from = day(query.from, "From"), to = day(query.to, "To");
      if (from && to && from > to) throw new BadRequestException("From is after To.");
      if (!companies.length) return { enabled: false as const, companies: choices, rows: [] as ProjectsProfitRow[] };
      const entity = this.pickCompany(companies, query.entity);
      const asOf = to ?? await companyToday(client, workspaceId, entity.legalEntityId);
      const full = await this.seesEveryProject(client, workspaceId, user.userId);
      const figures = projectFigures(await readProjectMovements(client, workspaceId, entity.legalEntityId, null, { from, to: asOf }));
      let ids = [...figures.keys()];
      if (!full) {
        const visible = await this.ownCostProjects(client, workspaceId, user.userId);
        ids = ids.filter((id) => visible.has(id));
      }
      const facts = await this.projectFacts(client, workspaceId, ids);
      const plans = await readQuotedPlans(client, workspaceId, ids);
      const rows: ProjectsProfitRow[] = [];
      for (const fact of facts) {
        const figure = figures.get(fact.id) ?? emptyFigures();
        const plan = plans.get(fact.id);
        const committed = await readCommitted(client, workspaceId, fact.id);
        const row: ProjectsProfitRow = {
          projectId: fact.id, reference: fact.reference, name: fact.name, clientName: fact.clientName, status: fact.status, ...figure,
          quotedValue: plan?.value ?? null, quoteCurrency: plan?.currency ?? null, quotedCost: plan?.cost ?? null, quotedMarginPercent: plan?.marginPercent ?? null,
          marginVsQuote: marginVsQuote(figure.marginPercent, plan?.marginPercent ?? null),
          committed: committed.amount, committedCurrency: committed.currency,
          links: { project: ledgerLinks.projectMoney(fact.id), journals: ledgerLinks.projectJournals(fact.id) },
        };
        rows.push(full ? row : hideMargin(row));
      }
      return {
        enabled: true as const, companies: choices, company: { id: entity.legalEntityId, name: entity.name }, currency: entity.currency,
        from, to: asOf, marginHidden: !full, rows,
      };
    });
  }

  /** Projects whose profit the person may read, by name, reference or client (Woddy's `project_profit`). */
  findProjects(actor: RequestActor, workspaceId: string, text: string) {
    const words = text.toLocaleLowerCase().split(/\s+/).map((word) => word.replace(/[%_\\]/g, "")).filter((word) => word.length > 0).slice(0, 6);
    return this.access.withAnyPermission(actor, workspaceId, PROJECT_PROFIT_PERMISSIONS, async (client, user) => {
      if (!words.length) return [];
      const full = await this.seesEveryProject(client, workspaceId, user.userId);
      const visible = full ? null : [...await this.ownCostProjects(client, workspaceId, user.userId)];
      return (await client.query<{ id: string; reference: string; name: string; clientName: string; status: string }>(
        `SELECT project.id, project.reference, project.name, coalesce(party.display_name, opportunity.title) AS "clientName", project.status
           FROM delivery_projects project
           JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
           JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
           LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
          WHERE project.workspace_id = $1 AND project.started_at IS NOT NULL AND ($2::uuid[] IS NULL OR project.id = ANY($2::uuid[]))
            AND (SELECT bool_and(lower(project.name || ' ' || coalesce(project.reference, '') || ' ' || coalesce(party.display_name, opportunity.title, '')) LIKE '%' || word || '%')
                   FROM unnest($3::text[]) word)
          ORDER BY CASE WHEN lower(project.reference) = $4 OR lower(project.name) = $4 THEN 0 ELSE 1 END, project.status = 'active' DESC, project.started_at DESC
          LIMIT 6`, [workspaceId, visible, words, text.trim().toLocaleLowerCase()])).rows;
    });
  }

  /** The Ledger at a glance for one company and period (Woddy's `books_report`): P&L, cash, receivables, payables, VAT due and ageing. */
  async summary(actor: RequestActor, workspaceId: string, query: { entity?: unknown; from?: unknown; to?: unknown }) {
    await this.fresh(workspaceId);
    return this.access.withPermission(actor, workspaceId, BOOKS_VIEW, async (client) => {
      const companies = await ledgerCompanies(client, workspaceId);
      if (!companies.length) return { enabled: false as const, companies: [] };
      const entity = this.pickCompany(companies, query.entity);
      const settings = await readBooksSettings(client, workspaceId, entity.legalEntityId);
      const today = await companyToday(client, workspaceId, entity.legalEntityId);
      const to = day(query.to, "To") ?? today;
      const from = day(query.from, "From") ?? fiscalYearStart(to, settings?.fiscalYearStartMonth ?? 1);
      if (from > to) throw new BadRequestException("From is after To.");
      const scope = { entity: entity.legalEntityId, from, to };
      return {
        enabled: true as const, company: { id: entity.legalEntityId, name: entity.name }, currency: entity.currency, from, to,
        companies: companies.map((item) => ({ id: item.legalEntityId, name: item.name })),
        ...await readBooksSummary(client, workspaceId, entity.legalEntityId, { from, to }),
        links: {
          profitAndLoss: ledgerLinks.report("profit-and-loss", scope), balanceSheet: ledgerLinks.report("balance-sheet", { entity: entity.legalEntityId, to }),
          vat: ledgerLinks.report("vat", scope), receivablesAgeing: ledgerLinks.report("ar-ageing", { entity: entity.legalEntityId, to }),
          payablesAgeing: ledgerLinks.report("ap-ageing", { entity: entity.legalEntityId, to }),
        },
      };
    });
  }

  private pickCompany(companies: Company[], wanted: unknown) {
    if (wanted === undefined || wanted === null || wanted === "") return companies[0];
    const found = companies.find((item) => item.legalEntityId === wanted);
    if (!found) throw new BadRequestException("The Ledger isn't on for this company.");
    return found;
  }

  /** Ledger readers and people who see costs and margins see every project's profit. */
  private async seesEveryProject(client: Db, workspaceId: string, userId: string) {
    return await this.access.hasPermission(client, workspaceId, userId, BOOKS_VIEW) || await this.access.hasPermission(client, workspaceId, userId, "commercial.costs.view");
  }

  /** The projects whose own costs (without margin) the person sees: theirs (or all, with projects.manage) with projects.costs.view. */
  private async ownCostProjects(client: Db, workspaceId: string, userId: string): Promise<Set<string>> {
    if (!(await this.access.hasPermission(client, workspaceId, userId, "projects.costs.view"))) return new Set();
    const all = await this.access.hasPermission(client, workspaceId, userId, "projects.manage");
    if (!all && !(await this.access.hasPermission(client, workspaceId, userId, "projects.view"))) return new Set();
    return new Set((await readProjects(client, workspaceId, await membershipOf(client, workspaceId, userId), all)).map((project) => project.id));
  }

  /** Ledger readers see a project's profit in full; anyone else as the Money tab allows (costs required, margin per `moneyAccess`). */
  private async projectRights(client: Db, workspaceId: string, projectId: string, userId: string): Promise<Rights> {
    if (await this.access.hasPermission(client, workspaceId, userId, BOOKS_VIEW)) {
      if (!(await readProject(client, workspaceId, projectId))) throw new NotFoundException("Project not found.");
      return { margin: true };
    }
    const viewer = await projectViewer(client, this.access, workspaceId, projectId, userId);
    const rights = await moneyAccess(client, this.access, workspaceId, userId, viewer);
    if (!rights.costs) throw new ForbiddenException("You don't see this project's costs.");
    return { margin: rights.margin };
  }

  private async projectPnl(client: Db, workspaceId: string, projectId: string, rights: Rights): Promise<ProjectPnlView> {
    const project = await readProject(client, workspaceId, projectId);
    if (!project) throw new NotFoundException("Project not found.");
    const company = await projectCompany(client, workspaceId, projectId);
    if (!company?.enabled)
      return { enabled: false, projectId, reference: project.reference, name: project.name, company: company ? { id: company.legalEntityId, name: company.name } : null };
    const asOf = await companyToday(client, workspaceId, company.legalEntityId);
    const figure = projectFigures(await readProjectMovements(client, workspaceId, company.legalEntityId, [projectId], { to: asOf })).get(projectId) ?? emptyFigures();
    const plan = (await readQuotedPlans(client, workspaceId, [projectId])).get(projectId);
    const committed = await readCommitted(client, workspaceId, projectId);
    const view: Extract<ProjectPnlView, { enabled: true }> = {
      enabled: true, projectId, reference: project.reference, name: project.name, clientName: project.clientName, status: project.status,
      company: { id: company.legalEntityId, name: company.name }, currency: company.currency, asOf, marginHidden: !rights.margin,
      ...figure,
      quotedValue: plan?.value ?? null, quoteCurrency: plan?.currency ?? null, quotedCost: plan?.cost ?? null, quotedMarginPercent: plan?.marginPercent ?? null,
      marginVsQuote: marginVsQuote(figure.marginPercent, plan?.marginPercent ?? null),
      committed: committed.amount, committedCurrency: committed.currency,
      reconciliation: await reconcileSpent(client, workspaceId, projectId, figure.totalCost, company.currency),
      links: { project: ledgerLinks.projectMoney(projectId), journals: ledgerLinks.projectJournals(projectId) },
    };
    return rights.margin ? view : hideMargin(view);
  }

  private async projectFacts(client: Db, workspaceId: string, ids: string[]) {
    if (!ids.length) return [];
    return (await client.query<{ id: string; reference: string; name: string; clientName: string; status: string }>(
      `SELECT project.id, project.reference, project.name, coalesce(party.display_name, opportunity.title) AS "clientName", project.status
         FROM delivery_projects project
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
        WHERE project.workspace_id = $1 AND project.id = ANY($2::uuid[])
        ORDER BY project.reference`, [workspaceId, ids])).rows;
  }
}

/** The first day of the fiscal year `day` falls in. */
export function fiscalYearStart(day: string, startMonth: number) {
  const [year, month] = day.split("-").map(Number);
  const startYear = month >= startMonth ? year : year - 1;
  return `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
}
