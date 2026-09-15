import { Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import {
  evaluatePreProjectReadiness,
  type EvaluatePreProjectReadinessOptions,
  type PreProjectDesignFact,
  type PreProjectItemFact,
  type PreProjectMeasurementFact,
  type PreProjectReadinessFacts,
} from "./pre-project-readiness";
import { PreProjectDefinitionService } from "./pre-project-definition.service";

type CaseRow = {
  id: string;
  status: string;
  phase: string;
  version: number;
};

type ItemRow = {
  id: string;
  title: string;
  roomId: string | null;
  roomName: string | null;
  version: number;
  scopeStatus: string;
  reviewStatus: string;
  archivedAt: Date | string | null;
  specificationVersion: number | null;
  specification: PreProjectItemFact["specification"];
};

type MeasurementRow = PreProjectMeasurementFact & { entryId: string };
type DesignRow = PreProjectDesignFact & {
  entryId: string;
  specificationVersion: number;
};

@Injectable()
export class PreProjectReadinessService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly definitions: PreProjectDefinitionService,
  ) {}

  get(
    actor: RequestActor,
    workspaceId: string,
    caseId: string,
    options: EvaluatePreProjectReadinessOptions = {},
  ) {
    return this.access.withPermission(
      actor,
      workspaceId,
      "pre_projects.view",
      (client) => this.evaluate(client, workspaceId, caseId, options),
    );
  }

  /**
   * Evaluate inside an already authorized transaction. Commercial uses this
   * path so its case lock and the Preparation facts share one transaction.
   */
  async evaluate(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    options: EvaluatePreProjectReadinessOptions = {},
  ) {
    const requireIncludedScope = options.requireIncludedScope ?? true;
    const requireConfirmedDefinition =
      options.requireConfirmedDefinition ?? requireIncludedScope;
    const caseResult = await client.query<CaseRow>(
      `SELECT id,status::text AS status,phase,version
       FROM pre_project_cases
       WHERE workspace_id=$1 AND id=$2`,
      [workspaceId, caseId],
    );
    if (!caseResult.rowCount)
      throw new NotFoundException("Pre-execution not found.");

    const itemResult = await client.query<ItemRow>(
      `SELECT entry.id,entry.title,entry.room_id AS "roomId",room.name AS "roomName",
              entry.version,entry.scope_status AS "scopeStatus",
              entry.review_status AS "reviewStatus",entry.archived_at AS "archivedAt",
              specification.version AS "specificationVersion",
              specification.content AS specification
       FROM pre_project_brief_entries entry
       LEFT JOIN pre_project_rooms room
         ON room.workspace_id=entry.workspace_id
        AND room.case_id=entry.case_id
        AND room.id=entry.room_id
       LEFT JOIN LATERAL (
         SELECT item.version,item.content
         FROM pre_project_item_specifications item
         WHERE item.workspace_id=entry.workspace_id
           AND item.case_id=entry.case_id
           AND item.entry_id=entry.id
         ORDER BY item.version DESC
         LIMIT 1
       ) specification ON true
       WHERE entry.workspace_id=$1
         AND entry.case_id=$2
         AND entry.kind='requirement'
       ORDER BY room.name NULLS FIRST,entry.title,entry.id`,
      [workspaceId, caseId],
    );

    const measurementResult = await client.query<MeasurementRow>(
      `SELECT record.entry_id AS "entryId",record.id,record.version,record.status,
              EXISTS(
                SELECT 1
                FROM pre_project_site_assets asset
                WHERE asset.workspace_id=record.workspace_id
                  AND asset.case_id=record.case_id
                  AND asset.record_id=record.id
                  AND asset.version=record.version
              ) AS "hasEvidence"
       FROM pre_project_site_records record
       WHERE record.workspace_id=$1
         AND record.case_id=$2
         AND record.kind='measurement'
         AND record.entry_id IS NOT NULL`,
      [workspaceId, caseId],
    );

    const designResult = await client.query<DesignRow>(
      `SELECT reference.entry_id AS "entryId",
              reference.version AS "specificationVersion",
              version.id AS "versionId",version.design_id AS "designId",
              version.number,version.status,reference.usage,
              EXISTS(
                SELECT 1
                FROM pre_project_design_threads thread
                WHERE thread.workspace_id=version.workspace_id
                  AND thread.case_id=version.case_id
                  AND thread.version_id=version.id
                  AND thread.blocking
                  AND thread.status='open'
              ) AS "blockingOpen",
              (
                SELECT max(candidate.number)::int
                FROM pre_project_design_versions candidate
                WHERE candidate.workspace_id=version.workspace_id
                  AND candidate.case_id=version.case_id
                  AND candidate.design_id=version.design_id
              ) AS "latestNumber"
       FROM pre_project_item_design_refs reference
       JOIN pre_project_design_versions version
         ON version.workspace_id=reference.workspace_id
        AND version.case_id=reference.case_id
        AND version.id=reference.design_version_id
       WHERE reference.workspace_id=$1 AND reference.case_id=$2
       ORDER BY reference.entry_id,version.design_id,version.number,version.id`,
      [workspaceId, caseId],
    );

    const caseCounts = await client.query<{
      sitePlanCount: number;
      openObservationCount: number;
    }>(
      `SELECT
         (
           SELECT count(*)::int
           FROM pre_project_brief_entries entry
           WHERE entry.workspace_id=$1
             AND entry.case_id=$2
             AND entry.kind='file'
             AND entry.archived_at IS NULL
             AND EXISTS(
               SELECT 1
               FROM pre_project_entry_assets asset
               WHERE asset.workspace_id=entry.workspace_id
                 AND asset.case_id=entry.case_id
                 AND asset.entry_id=entry.id
             )
         ) AS "sitePlanCount",
         (
           SELECT count(*)::int
           FROM pre_project_site_records record
           WHERE record.workspace_id=$1
             AND record.case_id=$2
             AND record.kind='observation'
             AND record.status='open'
         ) AS "openObservationCount"`,
      [workspaceId, caseId],
    );

    const measurements = new Map(
      measurementResult.rows.map((measurement) => [
        measurement.entryId,
        {
          id: measurement.id,
          version: Number(measurement.version),
          status: measurement.status,
          hasEvidence: measurement.hasEvidence,
        },
      ]),
    );
    const designs = new Map<string, DesignRow[]>();
    for (const design of designResult.rows) {
      const rows = designs.get(design.entryId) ?? [];
      rows.push(design);
      designs.set(design.entryId, rows);
    }

    const items: PreProjectItemFact[] = itemResult.rows.map((item) => {
      const specificationVersion =
        item.specificationVersion === null
          ? null
          : Number(item.specificationVersion);
      return {
        id: item.id,
        title: item.title,
        roomId: item.roomId,
        roomName: item.roomName,
        version: Number(item.version),
        scopeStatus: item.scopeStatus,
        reviewStatus: item.reviewStatus,
        archivedAt: item.archivedAt
          ? new Date(item.archivedAt).toISOString()
          : null,
        specificationVersion,
        specification: item.specification,
        measurement: measurements.get(item.id) ?? null,
        designs: (designs.get(item.id) ?? [])
          .filter(
            (design) =>
              specificationVersion !== null &&
              Number(design.specificationVersion) === specificationVersion,
          )
          .map((design) => ({
            versionId: design.versionId,
            designId: design.designId,
            number: Number(design.number),
            latestNumber: Number(design.latestNumber),
            status: design.status,
            usage: design.usage,
            blockingOpen: design.blockingOpen,
          })),
      };
    });
    const counts = caseCounts.rows[0] ?? {
      sitePlanCount: 0,
      openObservationCount: 0,
    };
    const row = caseResult.rows[0];
    const facts: PreProjectReadinessFacts = {
      case: {
        id: row.id,
        status: row.status,
        phase: row.phase,
        version: Number(row.version),
      },
      sitePlanCount: Number(counts.sitePlanCount),
      openObservationCount: Number(counts.openObservationCount),
      items,
      definitionConfirmation: requireConfirmedDefinition
        ? await this.definitions.currentConfirmation(
            client,
            workspaceId,
            caseId,
          )
        : null,
    };
    return evaluatePreProjectReadiness(facts, options);
  }
}
