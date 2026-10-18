import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { currencyDecimals } from "../purchasing/orders";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { moneyAccess, projectViewer } from "./project-access";
import { readProject } from "./project-core.store";
import { readBudgets, readPackageMoney, readProjectCommitted, readProjectCosts, readProjectIncome } from "./project-money";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMBER = /^\d{1,14}(\.\d{1,4})?$/;

/**
 * A project's money, for people who see costs: what was agreed and received from the client, what was
 * spent (entry by entry, from the records that caused it) and is still committed on open orders, and the
 * budget per package. Margin is shown when the project and the workspace keep the same currency.
 */
@Injectable()
export class ProjectMoneyService {
  constructor(private readonly access: WorkspaceAccessService) {}

  /** For people who see costs, and for a project's own team with `projects.costs.view` (then without margin). */
  read(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const viewer = await projectViewer(client, this.access, workspaceId, projectId, user.userId);
      const rights = await moneyAccess(client, this.access, workspaceId, user.userId, viewer);
      if (!rights.costs) throw new ForbiddenException("You don't see this project's costs.");
      const view = await this.view(client, workspaceId, projectId, user.userId);
      return rights.margin ? view : { ...view, margin: null, marginHidden: true };
    });
  }

  /** Sets one package's cost budget (or the budget for costs not in a package); version-checked, audited. */
  saveBudget(actor: RequestActor, workspaceId: string, projectId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "commercial.costs.manage", async (client, user) => {
      const project = await readProject(client, workspaceId, projectId, true);
      if (!project) throw new NotFoundException("Project not found.");
      if (!["active", "on_hold"].includes(project.status)) throw new ConflictException("A closed project's budget doesn't change.");
      const packageId = body.packageId === null || body.packageId === undefined || body.packageId === "" ? null : String(body.packageId);
      if (packageId !== null) {
        if (!UUID.test(packageId)) throw new BadRequestException("Package is not valid.");
        if (!(await client.query(`SELECT 1 FROM project_packages WHERE workspace_id = $1 AND project_id = $2 AND id = $3`, [workspaceId, projectId, packageId])).rowCount)
          throw new NotFoundException("Package not found.");
      }
      const home = (await client.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].currency;
      const amount = typeof body.amount === "number" ? String(body.amount) : typeof body.amount === "string" ? body.amount.trim() : "";
      if (!NUMBER.test(amount)) throw new BadRequestException("Enter the budget as an amount.");
      if (Dec.of(amount).round(currencyDecimals(home)).cmp(amount) !== 0) throw new BadRequestException(`The budget has more decimals than ${home} uses.`);
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
      const current = (await client.query<{ id: string; amount: string; version: number }>(
        `SELECT id, amount::text AS amount, version FROM project_budgets WHERE workspace_id = $1 AND project_id = $2 AND package_id IS NOT DISTINCT FROM $3::uuid FOR UPDATE`,
        [workspaceId, projectId, packageId])).rows[0];
      if ((current?.version ?? 0) !== body.version) throw new ConflictException("Someone else changed this budget. Reload to see their change.");
      if (current)
        await client.query(`UPDATE project_budgets SET amount = $3, note = $4, updated_by = $5, updated_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, current.id, amount, note, user.userId]);
      else
        await client.query(`INSERT INTO project_budgets (id, workspace_id, project_id, package_id, amount, currency, note, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [randomUUID(), workspaceId, projectId, packageId, amount, home, note, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "project.budget_set", entityType: "project", entityId: projectId,
        before: current ? { packageId, amount: current.amount } : undefined, after: { packageId, amount, note } });
      return this.view(client, workspaceId, projectId, user.userId);
    });
  }

  private async view(client: Db, workspaceId: string, projectId: string, userId: string) {
    const project = await readProject(client, workspaceId, projectId);
    if (!project) throw new NotFoundException("Project not found.");
    const [income, costs, committed, budgets] = [await readProjectIncome(client, workspaceId, project), await readProjectCosts(client, workspaceId, projectId),
      await readProjectCommitted(client, workspaceId, projectId), await readBudgets(client, workspaceId, projectId)];
    const rows = await readPackageMoney(client, workspaceId, projectId, costs, committed, budgets);
    const spent = Dec.of(costs.total), open = Dec.of(committed.total);
    const sameCurrency = income.currency === costs.currency;
    const budgetTotal = budgets.length ? budgets.reduce((sum, item) => sum.add(item.amount), Dec.ZERO).toFixed(4) : null;
    return {
      currency: costs.currency, income,
      spent: spent.toFixed(4), committed: open.toFixed(4), forecast: spent.add(open).toFixed(4), budget: budgetTotal,
      // Margin on the agreed value before tax, against what's spent and still committed.
      margin: sameCurrency ? Dec.of(income.agreedNet).sub(spent).sub(open).toFixed(4) : null,
      // Money in hand for more spending: what the client paid less what's spent and committed.
      available: sameCurrency ? Dec.of(income.received).sub(spent).sub(open).toFixed(4) : null,
      packages: rows, entries: costs.entries, uncosted: costs.uncosted + committed.unconverted,
      canManage: await this.access.hasPermission(client, workspaceId, userId, "commercial.costs.manage") && ["active", "on_hold"].includes(project.status),
    };
  }
}
