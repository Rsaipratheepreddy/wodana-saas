import { ForbiddenException, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { viewAsPermissionsFor } from "../auth/view-as/view-as.context";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { DASHBOARD_ACCESS, REPORT_PERMISSIONS, dashboardName, readDashboard, readFilterOptions, readRecords } from "./management-reports";
import { readTargets, saveTargets } from "./report-targets";

/** Management dashboards are for the System Owner for now (owner/admin); managers get the permission later, per dashboard and team. */
export const VIEW = "reports.management.view";
/** Entering the KPI targets in Settings. */
export const TARGETS = "reports.management.targets";

@Injectable()
export class ManagementReportsService {
  constructor(private readonly access: WorkspaceAccessService) {}

  /**
   * What the member may see beyond opening the dashboards: a dashboard needs one of its area's read permissions
   * (DASHBOARD_ACCESS), and some figures one more (margins). Narrowed to a view-as session's permissions.
   */
  private async can(client: PoolClient, workspaceId: string, userId: string, dashboard: string) {
    const granted = await this.access.grantedPermissions(client, workspaceId, userId, REPORT_PERMISSIONS);
    const viewing = viewAsPermissionsFor(workspaceId, userId);
    const can = (permission: string) => granted.has(permission) && (!viewing || viewing.has(permission));
    const needs = DASHBOARD_ACCESS[dashboardName(dashboard)];
    if (needs && !needs.some(can)) throw new ForbiddenException("You don't have access to this dashboard.");
    return can;
  }

  dashboard(actor: RequestActor, workspaceId: string, name: string, query: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) =>
      readDashboard(client, workspaceId, name, query, new Date(), await this.can(client, workspaceId, user.userId, name)));
  }

  records(actor: RequestActor, workspaceId: string, name: string, query: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) =>
      readRecords(client, workspaceId, name, query, new Date(), await this.can(client, workspaceId, user.userId, name)));
  }

  options(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, (client) => readFilterOptions(client, workspaceId));
  }

  targets(actor: RequestActor, workspaceId: string, year: unknown) {
    return this.access.withPermission(actor, workspaceId, TARGETS, async (client) => ({
      ...(await readTargets(client, workspaceId, Number(year ?? new Date().getUTCFullYear()))),
      accountManagers: (await readFilterOptions(client, workspaceId)).accountManagers,
    }));
  }

  saveTargets(actor: RequestActor, workspaceId: string, body: unknown) {
    return this.access.withPermission(actor, workspaceId, TARGETS, (client, user) => saveTargets(client, workspaceId, user.userId, body));
  }
}
