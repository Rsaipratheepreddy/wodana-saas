import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { membershipOf, readProject, type ProjectRow } from "./project-core.store";

/** Who someone is on a project: whether they see every project, are on its team, or lead it. */
export type ProjectViewer = { project: ProjectRow; all: boolean; membershipId: string | null; onTeam: boolean; lead: boolean };

/**
 * The project as this person may see it: everyone with `projects.manage` sees every project; someone with
 * `projects.view` sees the projects they're on. Anyone else gets "not found" (or "no access" without either).
 */
export async function projectViewer(client: PoolClient, access: WorkspaceAccessService, workspaceId: string, projectId: string, userId: string): Promise<ProjectViewer> {
  const project = await readProject(client, workspaceId, projectId);
  if (!project) throw new NotFoundException("Project not found.");
  const all = await access.hasPermission(client, workspaceId, userId, "projects.manage");
  if (!all && !(await access.hasPermission(client, workspaceId, userId, "projects.view"))) throw new ForbiddenException("You don't have access to projects.");
  const membershipId = await membershipOf(client, workspaceId, userId);
  const assignment = (await client.query<{ lead: boolean }>(
    `SELECT is_manager AS lead FROM project_assignments WHERE workspace_id = $1 AND project_id = $2 AND membership_id = $3 AND active`,
    [workspaceId, projectId, membershipId])).rows[0];
  if (!all && !assignment) throw new NotFoundException("Project not found.");
  return { project, all, membershipId, onTeam: Boolean(assignment), lead: Boolean(assignment?.lead) };
}

/**
 * Who sees what of a project's money. Costs and margin: `commercial.costs.view` (every project). A project's
 * own money without margin — received, spent, committed, budgets, cash in hand — also for someone with
 * `projects.costs.view` who runs it or is on its team. The client side (milestones, invoices, receipts) also
 * for the people who keep receivables or verify payments.
 */
export async function moneyAccess(client: PoolClient, access: WorkspaceAccessService, workspaceId: string, userId: string, viewer: Pick<ProjectViewer, "all" | "onTeam">) {
  const margin = await access.hasPermission(client, workspaceId, userId, "commercial.costs.view");
  const own = !margin && (viewer.all || viewer.onTeam) && await access.hasPermission(client, workspaceId, userId, "projects.costs.view");
  const costs = margin || own;
  const client_ = costs || await access.hasPermission(client, workspaceId, userId, "receivables.view")
    || await access.hasPermission(client, workspaceId, userId, "commercial.finance.verify");
  return { costs, margin, client: client_ };
}
