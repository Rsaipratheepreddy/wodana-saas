import { Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";

export const CONFIGURATION_RESOURCE_TYPES = [
  "workspace_terminology",
  "project_workflow_template",
  "crm_taxonomy",
  "crm_custom_field",
  "crm_qualification_form",
  "quotation_template",
  "payment_template",
  "workspace_team",
] as const;

export type ConfigurationResourceType = (typeof CONFIGURATION_RESOURCE_TYPES)[number];
export type ConfigurationRevisionAction =
  | "baseline"
  | "created"
  | "saved"
  | "archived"
  | "restored_default"
  | "rolled_back";

export type ConfigurationSnapshot = Record<string, unknown>;

export type ConfigurationRevision = {
  id: string;
  resourceType: ConfigurationResourceType;
  resourceId: string;
  revisionNumber: number;
  sourceVersion: number;
  action: ConfigurationRevisionAction;
  snapshot: ConfigurationSnapshot;
  sourceRevisionId: string | null;
  createdBy: string | null;
  createdAt: Date | string;
};

export type ConfigurationChange = {
  path: string;
  before: unknown;
  after: unknown;
};

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function configurationChanges(
  before: ConfigurationSnapshot | null,
  after: ConfigurationSnapshot,
  prefix = "",
): ConfigurationChange[] {
  if (!before) return Object.keys(after).sort().map((key) => ({
    path: prefix ? `${prefix}.${key}` : key,
    before: undefined,
    after: after[key],
  }));
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].sort().flatMap((key) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const left = before[key];
    const right = after[key];
    if (same(left, right)) return [];
    if (plainObject(left) && plainObject(right)) return configurationChanges(left, right, path);
    return [{ path, before: left, after: right }];
  });
}

@Injectable()
export class ConfigurationRevisionsService {
  async ensureBaseline(
    client: PoolClient,
    input: {
      workspaceId: string;
      resourceType: ConfigurationResourceType;
      resourceId: string;
      sourceVersion: number;
      snapshot: ConfigurationSnapshot;
      actorUserId: string;
    },
  ) {
    const exists = await client.query(
      `SELECT 1 FROM workspace_configuration_revisions
       WHERE workspace_id=$1 AND resource_type=$2 AND resource_id=$3 LIMIT 1`,
      [input.workspaceId, input.resourceType, input.resourceId],
    );
    if (exists.rowCount) return null;
    return this.record(client, { ...input, action: "baseline" });
  }

  async record(
    client: PoolClient,
    input: {
      workspaceId: string;
      resourceType: ConfigurationResourceType;
      resourceId: string;
      sourceVersion: number;
      action: ConfigurationRevisionAction;
      snapshot: ConfigurationSnapshot;
      actorUserId: string;
      sourceRevisionId?: string | null;
    },
  ) {
    const result = await client.query<ConfigurationRevision>(
      `INSERT INTO workspace_configuration_revisions
        (workspace_id,resource_type,resource_id,revision_number,source_version,action,snapshot,source_revision_id,created_by)
       SELECT $1::uuid,$2::varchar(64),$3::varchar(160),COALESCE(max(revision_number),0)+1,
              $4::integer,$5::varchar(32),$6::jsonb,$7::uuid,$8::uuid
       FROM workspace_configuration_revisions
       WHERE workspace_id=$1::uuid AND resource_type=$2::varchar(64) AND resource_id=$3::varchar(160)
       RETURNING id,resource_type AS "resourceType",resource_id AS "resourceId",
                 revision_number AS "revisionNumber",source_version AS "sourceVersion",action,snapshot,
                 source_revision_id AS "sourceRevisionId",created_by AS "createdBy",created_at AS "createdAt"`,
      [
        input.workspaceId,
        input.resourceType,
        input.resourceId,
        input.sourceVersion,
        input.action,
        JSON.stringify(input.snapshot),
        input.sourceRevisionId ?? null,
        input.actorUserId,
      ],
    );
    return result.rows[0];
  }

  async history(
    client: PoolClient,
    workspaceId: string,
    resourceType: ConfigurationResourceType,
    resourceId: string,
  ) {
    const result = await client.query<ConfigurationRevision>(
      `SELECT id,resource_type AS "resourceType",resource_id AS "resourceId",
              revision_number AS "revisionNumber",source_version AS "sourceVersion",action,snapshot,
              source_revision_id AS "sourceRevisionId",created_by AS "createdBy",created_at AS "createdAt"
       FROM workspace_configuration_revisions
       WHERE workspace_id=$1 AND resource_type=$2 AND resource_id=$3
       ORDER BY revision_number`,
      [workspaceId, resourceType, resourceId],
    );
    return result.rows.map((revision, index) => ({
      ...revision,
      changes: configurationChanges(result.rows[index - 1]?.snapshot ?? null, revision.snapshot),
    })).reverse();
  }

  async requireRevision(
    client: PoolClient,
    workspaceId: string,
    resourceType: ConfigurationResourceType,
    resourceId: string,
    revisionId: string,
  ) {
    const result = await client.query<ConfigurationRevision>(
      `SELECT id,resource_type AS "resourceType",resource_id AS "resourceId",
              revision_number AS "revisionNumber",source_version AS "sourceVersion",action,snapshot,
              source_revision_id AS "sourceRevisionId",created_by AS "createdBy",created_at AS "createdAt"
       FROM workspace_configuration_revisions
       WHERE workspace_id=$1 AND resource_type=$2 AND resource_id=$3 AND id=$4`,
      [workspaceId, resourceType, resourceId, revisionId],
    );
    if (!result.rowCount) throw new NotFoundException("Configuration revision not found");
    return result.rows[0];
  }
}
