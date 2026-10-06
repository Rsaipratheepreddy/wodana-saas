import { Injectable } from "@nestjs/common";
import type { RequestActor } from "../auth/actor";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { readDashboard, readFilterOptions, readRecords } from "./management-reports";
import { readTargets, saveTargets } from "./report-targets";

/** Management dashboards are for the System Owner for now (owner/admin); managers get the permission later, per dashboard and team. */
export const VIEW = "reports.management.view";
/** Entering the KPI targets in Settings. */
export const TARGETS = "reports.management.targets";

@Injectable()
export class ManagementReportsService {
  constructor(private readonly access: WorkspaceAccessService) {}

  dashboard(actor: RequestActor, workspaceId: string, name: string, query: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, VIEW, (client) => readDashboard(client, workspaceId, name, query));
  }

  records(actor: RequestActor, workspaceId: string, name: string, query: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, VIEW, (client) => readRecords(client, workspaceId, name, query));
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
