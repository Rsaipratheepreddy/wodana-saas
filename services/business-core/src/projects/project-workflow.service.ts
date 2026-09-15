import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { HrmsAccessService } from "../hrms/hrms-access.service";
import {
  PROJECT_WORKFLOW_GATE_KEYS,
  builtInProjectWorkflow,
  parseProjectWorkflowTemplate,
  parseWorkflowVersion,
  type ProjectWorkflowStage,
  type ProjectWorkflowTemplate,
} from "./project-workflow";

type WorkflowRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  status: "active" | "archived";
  isDefault: boolean;
  version: number;
  stages: ProjectWorkflowStage[];
  updatedAt: Date | string;
};

function workflow(row: WorkflowRow): ProjectWorkflowTemplate {
  const parsed = parseProjectWorkflowTemplate({
    version: row.version,
    code: row.code,
    name: row.name,
    description: row.description,
    isDefault: row.isDefault,
    stages: row.stages,
  });
  return {
    id: row.id,
    ...parsed,
    status: row.status,
    source: "workspace",
    updatedAt: row.updatedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505",
  );
}

@Injectable()
export class ProjectWorkflowService {
  constructor(
    private readonly access: HrmsAccessService,
    private readonly events: CrmEventsService,
  ) {}

  list(actor: RequestActor, workspaceId: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "projects.view", "projects.manage");
      const rows = await this.activeRows(ctx.client, workspaceId);
      const templates = rows.map(workflow);
      return {
        defaultTemplate:
          templates.find((template) => template.isDefault) ??
          builtInProjectWorkflow(),
        templates,
        supportedExitGates: [...PROJECT_WORKFLOW_GATE_KEYS],
      };
    });
  }

  save(
    actor: RequestActor,
    workspaceId: string,
    templateId: string,
    input: unknown,
  ) {
    const next = parseProjectWorkflowTemplate(input);
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "projects.manage");
      await this.lock(ctx.client, workspaceId);
      const current = await ctx.client.query<WorkflowRow>(
        `SELECT id,code,name,description,status,is_default AS "isDefault",version,stages,
                updated_at AS "updatedAt"
         FROM project_workflow_templates
         WHERE workspace_id=$1 AND id=$2
         FOR UPDATE`,
        [workspaceId, templateId],
      );
      const before = current.rowCount ? workflow(current.rows[0]) : null;
      if (current.rowCount && current.rows[0].status !== "active")
        throw new ConflictException("Archived workflow templates cannot be changed.");
      if ((current.rows[0]?.version ?? 0) !== next.version)
        throw new ConflictException(
          "This workflow template changed. Refresh before saving.",
        );

      try {
        let displacedBefore: WorkflowRow[] = [];
        let displacedAfter: WorkflowRow[] = [];
        if (next.isDefault) {
          displacedBefore = (
            await ctx.client.query<WorkflowRow>(
              `SELECT id,code,name,description,status,is_default AS "isDefault",version,stages,
                      updated_at AS "updatedAt"
               FROM project_workflow_templates
               WHERE workspace_id=$1 AND status='active' AND is_default AND id<>$2
               FOR UPDATE`,
              [workspaceId, templateId],
            )
          ).rows;
          displacedAfter = (
            await ctx.client.query<WorkflowRow>(
            `UPDATE project_workflow_templates
             SET is_default=false,version=version+1,updated_by=$1,updated_at=now()
             WHERE workspace_id=$2 AND status='active' AND is_default AND id<>$3
             RETURNING id,code,name,description,status,is_default AS "isDefault",version,stages,
                       updated_at AS "updatedAt"`,
            [ctx.userId, workspaceId, templateId],
            )
          ).rows;
        }
        const result = current.rowCount
          ? await ctx.client.query<WorkflowRow>(
              `UPDATE project_workflow_templates
               SET code=$1,name=$2,description=$3,is_default=$4,stages=$5,
                   version=version+1,updated_by=$6,updated_at=now()
               WHERE workspace_id=$7 AND id=$8 AND status='active' AND version=$9
               RETURNING id,code,name,description,status,is_default AS "isDefault",version,stages,
                         updated_at AS "updatedAt"`,
              [
                next.code,
                next.name,
                next.description,
                next.isDefault,
                JSON.stringify(next.stages),
                ctx.userId,
                workspaceId,
                templateId,
                next.version,
              ],
            )
          : await ctx.client.query<WorkflowRow>(
              `INSERT INTO project_workflow_templates
                (id,workspace_id,code,name,description,is_default,stages,created_by,updated_by)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)
               RETURNING id,code,name,description,status,is_default AS "isDefault",version,stages,
                         updated_at AS "updatedAt"`,
              [
                templateId,
                workspaceId,
                next.code,
                next.name,
                next.description,
                next.isDefault,
                JSON.stringify(next.stages),
                ctx.userId,
              ],
            );
        if (!result.rowCount)
          throw new ConflictException(
            "This workflow template changed. Refresh before saving.",
          );
        const saved = workflow(result.rows[0]);
        await this.events.record(ctx.client, {
          workspaceId,
          actorUserId: ctx.userId,
          source: "user",
          action: "project.workflow_template_saved.v1",
          entityType: "project_workflow_template",
          entityId: templateId,
          before: before ?? undefined,
          after: saved,
        });
        for (const displaced of displacedAfter) {
          await this.events.record(ctx.client, {
            workspaceId,
            actorUserId: ctx.userId,
            source: "user",
            action: "project.workflow_template_default_replaced.v1",
            entityType: "project_workflow_template",
            entityId: displaced.id,
            before: workflow(
              displacedBefore.find((candidate) => candidate.id === displaced.id)!,
            ),
            after: workflow(displaced),
          });
        }
        return saved;
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ConflictException(
            "Another active workflow template already uses this code or default position.",
          );
        throw error;
      }
    });
  }

  archive(
    actor: RequestActor,
    workspaceId: string,
    templateId: string,
    input: unknown,
  ) {
    const version = parseWorkflowVersion(input);
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "projects.manage");
      await this.lock(ctx.client, workspaceId);
      const current = await ctx.client.query<WorkflowRow>(
        `SELECT id,code,name,description,status,is_default AS "isDefault",version,stages,
                updated_at AS "updatedAt"
         FROM project_workflow_templates
         WHERE workspace_id=$1 AND id=$2
         FOR UPDATE`,
        [workspaceId, templateId],
      );
      if (!current.rowCount || current.rows[0].status !== "active")
        throw new NotFoundException("Active workflow template not found.");
      if (current.rows[0].version !== version)
        throw new ConflictException(
          "This workflow template changed. Refresh before archiving.",
        );
      const before = workflow(current.rows[0]);
      const result = await ctx.client.query<WorkflowRow>(
        `UPDATE project_workflow_templates
         SET status='archived',is_default=false,version=version+1,updated_by=$1,updated_at=now()
         WHERE workspace_id=$2 AND id=$3 AND status='active' AND version=$4
         RETURNING id,code,name,description,status,is_default AS "isDefault",version,stages,
                   updated_at AS "updatedAt"`,
        [ctx.userId, workspaceId, templateId, version],
      );
      if (!result.rowCount)
        throw new ConflictException(
          "This workflow template changed. Refresh before archiving.",
        );
      const archived = workflow(result.rows[0]);
      await this.events.record(ctx.client, {
        workspaceId,
        actorUserId: ctx.userId,
        source: "user",
        action: "project.workflow_template_archived.v1",
        entityType: "project_workflow_template",
        entityId: templateId,
        before,
        after: archived,
      });
      return archived;
    });
  }

  private activeRows(client: PoolClient, workspaceId: string) {
    return client.query<WorkflowRow>(
      `SELECT id,code,name,description,status,is_default AS "isDefault",version,stages,
              updated_at AS "updatedAt"
       FROM project_workflow_templates
       WHERE workspace_id=$1 AND status='active'
       ORDER BY is_default DESC,name,id`,
      [workspaceId],
    ).then((result) => result.rows);
  }

  private lock(client: PoolClient, workspaceId: string) {
    return client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `project-workflows:${workspaceId}`,
    ]);
  }
}
