import { ConflictException, Injectable, OnModuleInit } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { CrmActivitiesService } from "../../crm/activities/crm-activities.service";
import { ProjectWorkService } from "../../project-core/project-work.service";
import { ReminderSourceRegistryService } from "../sources/registry.service";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/**
 * My day's "Mark done" and "Reassign" run the module's own commands (plan §6.24a: subjects close only through the
 * done predicate; nobody marks one done by hand). This binds them to the sources at start-up:
 * - a follow-up is completed and reassigned through the CRM activity commands (crm.activities.manage);
 * - project work is marked done and reassigned through the project work command (the project's team).
 * Each reads the record's current version first; the command checks its own permissions and audits itself.
 */
@Injectable()
export class ReminderModuleCommands implements OnModuleInit {
  constructor(
    private readonly registry: ReminderSourceRegistryService,
    private readonly db: DatabaseService,
    private readonly activities: CrmActivitiesService,
    private readonly work: ProjectWorkService,
  ) {}

  private async version(workspaceId: string, sql: string, id: string) {
    const row = (await this.db.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, (client) => client.query<{ version: number; projectId?: string }>(sql, [workspaceId, id]))).rows[0];
    if (!row) throw new ConflictException("The record is gone.");
    return row;
  }

  onModuleInit() {
    this.registry.attachCommands("crm.follow_up", {
      complete: {
        label: "Mark done", permission: "crm.activities.manage",
        run: async ({ workspaceId, subject, actor }) => {
          const { version } = await this.version(workspaceId, `SELECT version FROM crm_activities WHERE workspace_id = $1 AND id = $2`, subject.sourceId);
          await this.activities.complete(actor.request, workspaceId, subject.sourceId, { version: Number(version) });
        },
      },
      reassign: {
        permission: "crm.activities.manage",
        run: async ({ workspaceId, subject, actor, toMembershipId }) => {
          const { version } = await this.version(workspaceId, `SELECT version FROM crm_activities WHERE workspace_id = $1 AND id = $2`, subject.sourceId);
          await this.activities.update(actor.request, workspaceId, subject.sourceId, { version: Number(version), ownerMembershipId: toMembershipId });
        },
      },
    });
    const itemSql = `SELECT version, project_id AS "projectId" FROM work_items WHERE workspace_id = $1 AND id = $2`;
    this.registry.attachCommands("work.due", {
      complete: {
        label: "Mark done", permission: "projects.view",
        run: async ({ workspaceId, subject, actor }) => {
          const item = await this.version(workspaceId, itemSql, subject.sourceId);
          await this.work.command(actor.request, workspaceId, item.projectId!, { action: "update", itemId: subject.sourceId, version: Number(item.version), status: "done" });
        },
      },
      reassign: {
        permission: "projects.view",
        run: async ({ workspaceId, subject, actor, toMembershipId }) => {
          const item = await this.version(workspaceId, itemSql, subject.sourceId);
          await this.work.command(actor.request, workspaceId, item.projectId!, { action: "update", itemId: subject.sourceId, version: Number(item.version), assigneeId: toMembershipId });
        },
      },
    });
  }
}
