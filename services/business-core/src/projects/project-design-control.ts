import { ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type {
  ProjectData,
  ProjectDesignBaseline,
  ProjectDesignLink,
  ProjectDocument,
  Task,
} from "./execution.types";

export type DesignScopeReference = {
  scopeLineId: string;
  sourceScopeId?: string;
  sourceScopeVersion?: number;
  sourceSpecificationVersion?: number;
  title: string;
};

type DesignRow = Omit<ProjectDesignLink, "scopeLineId" | "sourceScopeId" | "sourceScopeVersion" | "sourceSpecificationVersion">;

/**
 * Reads the exact approved design revisions for released scope. A project must
 * never silently substitute a newer draft, an unapproved revision, or a
 * revision with an unresolved blocking design thread.
 */
export async function captureApprovedDesignBaseline(
  client: PoolClient,
  workspaceId: string,
  caseId: string,
  references: DesignScopeReference[],
  capturedAt: string,
  definitionBaseline?: ProjectDesignBaseline["definitionBaseline"],
  options: { includePackageDesigns?: boolean } = {},
): Promise<ProjectDesignBaseline> {
  const links: ProjectDesignLink[] = [];
  const packageReferences = options.includePackageDesigns
    ? references.filter((reference) => !reference.sourceScopeId)
    : [];
  if (packageReferences.length) {
    // A design the client chose in a presentation (a concept option) is approved by that choice, as the stage reads it;
    // the options they passed over are retired. Jobs decided before the choice settled the files read the same way.
    const packageDesigns = (await client.query<DesignRow & { status: string; hasBlockingThread: boolean; chosen: boolean; passedOver: boolean }>(
      `SELECT version.id AS "designVersionId",version.design_id AS "designId",
              design.title,design.document_type AS "documentType",
              version.number AS revision,
              asset.id AS "assetId",asset.original_name AS "fileName",
              asset.mime_type AS "mimeType",asset.byte_size AS "byteSize",
              asset.preview_key IS NOT NULL AS "hasPreview",
              coalesce(decision.decision_at,chosen.decided_at,version.created_at)::text AS "approvedAt",
              version.status,
              EXISTS(SELECT 1 FROM pre_project_design_threads thread
                WHERE thread.workspace_id=version.workspace_id AND thread.version_id=version.id
                  AND thread.blocking AND thread.status='open') AS "hasBlockingThread",
              chosen.decided_at IS NOT NULL AS chosen,
              EXISTS(SELECT 1 FROM design_presentations other
                JOIN design_presentation_options option ON option.workspace_id=other.workspace_id AND option.presentation_id=other.id
                WHERE option.workspace_id=design.workspace_id AND option.design_id=design.id
                  AND other.status='chosen' AND other.chosen_option_id<>option.id) AS "passedOver"
       FROM pre_project_designs design
       JOIN LATERAL (
         SELECT * FROM pre_project_design_versions
         WHERE workspace_id=design.workspace_id AND design_id=design.id
         ORDER BY number DESC LIMIT 1
       ) version ON true
       JOIN pre_project_brief_assets asset ON asset.workspace_id=version.workspace_id
         AND asset.case_id=version.case_id AND asset.id=version.asset_id
       LEFT JOIN LATERAL (
         SELECT activity.decision_at FROM pre_project_design_activity activity
         WHERE activity.workspace_id=version.workspace_id AND activity.version_id=version.id
           AND activity.action='approved'
         ORDER BY activity.decision_at DESC NULLS LAST,activity.created_at DESC LIMIT 1
       ) decision ON true
       LEFT JOIN LATERAL (
         SELECT presentation.decided_at FROM design_presentations presentation
         JOIN design_presentation_options option ON option.workspace_id=presentation.workspace_id AND option.presentation_id=presentation.id
         WHERE option.workspace_id=design.workspace_id AND option.design_id=design.id
           AND presentation.status='chosen' AND presentation.chosen_option_id=option.id
         ORDER BY presentation.decided_at DESC LIMIT 1
       ) chosen ON true
       WHERE design.workspace_id=$1 AND design.case_id=$2
         AND design.archived_at IS NULL AND design.scope_entry_id IS NULL
       ORDER BY design.title,version.number`,
      [workspaceId, caseId],
    )).rows;
    const current = packageDesigns.filter((design) => design.chosen || !design.passedOver);
    if (!current.length || current.some((design) =>
      (design.status !== "approved" && !design.chosen) || design.hasBlockingThread))
      throw new ConflictException("Approve the latest package-level designs and resolve blocking comments before the main quotation.");
    for (const reference of packageReferences)
      links.push(...current.map(({ status: _status, hasBlockingThread: _blocking, chosen: _chosen, passedOver: _passedOver, ...design }) => ({
        ...design,
        scopeLineId: reference.scopeLineId,
        sourceScopeId: "",
        sourceScopeVersion: 0,
        sourceSpecificationVersion: 0,
      })));
  }
  for (const reference of references) {
    if (!reference.sourceScopeId) continue;
    const source = (
      await client.query<{
        version: number;
        scope_status: string;
        archived_at: string | null;
        specification_version: number | null;
      }>(
        `SELECT entry.version,entry.scope_status,entry.archived_at,
                (SELECT max(specification.version)
                 FROM pre_project_item_specifications specification
                 WHERE specification.workspace_id=entry.workspace_id
                   AND specification.case_id=entry.case_id
                   AND specification.entry_id=entry.id) AS specification_version
         FROM pre_project_brief_entries entry
         WHERE entry.workspace_id=$1 AND entry.case_id=$2 AND entry.id=$3`,
        [workspaceId, caseId, reference.sourceScopeId],
      )
    ).rows[0];
    if (
      !source ||
      source.archived_at ||
      source.scope_status !== "included" ||
      Number(source.version) !== Number(reference.sourceScopeVersion) ||
      (reference.sourceSpecificationVersion !== undefined &&
        Number(source.specification_version) !==
          Number(reference.sourceSpecificationVersion))
    )
      throw new ConflictException(
        `Preparation changed for ${reference.title}. Review its approved quotation or Change Case before delivery.`,
      );
    const designs = (
      await client.query<DesignRow>(
        `SELECT version.id AS "designVersionId",version.design_id AS "designId",
                design.title,design.document_type AS "documentType",
                version.number AS revision,
                asset.id AS "assetId",asset.original_name AS "fileName",
                asset.mime_type AS "mimeType",asset.byte_size AS "byteSize",
                asset.preview_key IS NOT NULL AS "hasPreview",
                coalesce(decision.decision_at,version.created_at)::text AS "approvedAt"
         FROM pre_project_item_design_refs reference
         JOIN pre_project_design_versions version
           ON version.workspace_id=reference.workspace_id
          AND version.case_id=reference.case_id
          AND version.id=reference.design_version_id
         JOIN pre_project_designs design
           ON design.workspace_id=version.workspace_id
          AND design.case_id=version.case_id
          AND design.id=version.design_id
         LEFT JOIN LATERAL (
           SELECT activity.decision_at
           FROM pre_project_design_activity activity
           WHERE activity.workspace_id=version.workspace_id
             AND activity.version_id=version.id
             AND activity.action='approved'
           ORDER BY activity.decision_at DESC NULLS LAST,activity.created_at DESC
           LIMIT 1
         ) decision ON true
         JOIN pre_project_brief_assets asset
           ON asset.workspace_id=version.workspace_id
          AND asset.case_id=version.case_id
          AND asset.id=version.asset_id
         WHERE reference.workspace_id=$1 AND reference.case_id=$2
           AND reference.entry_id=$3 AND reference.version=$4
           AND version.status='approved'
           AND design.archived_at IS NULL
           AND NOT EXISTS(
             SELECT 1 FROM pre_project_design_threads thread
             WHERE thread.workspace_id=version.workspace_id
               AND thread.version_id=version.id
               AND thread.blocking AND thread.status='open'
           )
         ORDER BY design.title,version.number`,
        [
          workspaceId,
          caseId,
          reference.sourceScopeId,
          reference.sourceSpecificationVersion ?? 0,
        ],
      )
    ).rows;
    if (!designs.length)
      throw new ConflictException(
        `Complete the linked design approvals for ${reference.title} before delivery.`,
      );
    links.push(
      ...designs.map((design) => ({
        ...design,
        scopeLineId: reference.scopeLineId,
        sourceScopeId: reference.sourceScopeId!,
        sourceScopeVersion: reference.sourceScopeVersion ?? 0,
        sourceSpecificationVersion: reference.sourceSpecificationVersion ?? 0,
      })),
    );
  }
  return {
    capturedAt,
    ...(definitionBaseline ? { definitionBaseline } : {}),
    links,
  };
}

function documentKind(type: string): ProjectDocument["kind"] {
  if (type === "drawing") return "drawing";
  if (["specification", "schedule", "finish_schedule"].includes(type))
    return "specification";
  return "other";
}

/** Adds or widens the approved, read-only project document for every design revision. */
export function synchroniseApprovedDesignDocuments(
  data: ProjectData,
  baseline: ProjectDesignBaseline,
  now: string,
  createId: () => string,
) {
  for (const design of baseline.links) {
    const sameRevision = data.documents.find(
      (document) =>
        document.sourceDesignVersionId === design.designVersionId &&
        document.status === "approved",
    );
    if (sameRevision) {
      sameRevision.scopeLineIds = [
        ...new Set([...(sameRevision.scopeLineIds ?? []), design.scopeLineId]),
      ];
      continue;
    }
    data.documents.push({
      id: createId(),
      title: `${design.title} · Rev ${design.revision}`,
      kind: documentKind(design.documentType),
      revision: `D${design.revision}`,
      url: "",
      note: `Approved design revision captured from Pre-execution · ${design.fileName}`,
      status: "approved",
      replaces: "",
      published: false,
      approvedBy: "Approved in Pre-execution",
      sourceDesignVersionId: design.designVersionId,
      sourceDesignAssetId: design.assetId,
      scopeLineIds: [design.scopeLineId],
    });
  }
}

export function mergeDesignBaseline(
  current: ProjectDesignBaseline | undefined,
  addition: ProjectDesignBaseline,
): ProjectDesignBaseline {
  const links = [...(current?.links ?? [])];
  for (const link of addition.links) {
    const index = links.findIndex(
      (candidate) =>
        candidate.scopeLineId === link.scopeLineId &&
        candidate.designVersionId === link.designVersionId,
    );
    if (index < 0) links.push(link);
    else links[index] = link;
  }
  return {
    capturedAt: current?.capturedAt ?? addition.capturedAt,
    definitionBaseline: current?.definitionBaseline ?? addition.definitionBaseline,
    links,
  };
}

/** Compare contractual design evidence without treating the capture timestamp as content. */
export function sameDesignEvidence(
  expected: ProjectDesignBaseline | undefined,
  current: ProjectDesignBaseline,
) {
  if (!expected) return false;
  const definition = (value: ProjectDesignBaseline) =>
    value.definitionBaseline
      ? `${value.definitionBaseline.id}:${value.definitionBaseline.number}:${value.definitionBaseline.hash}`
      : "";
  const links = (value: ProjectDesignBaseline) =>
    value.links
      .map((link) => ({
        scopeLineId: link.scopeLineId,
        sourceScopeId: link.sourceScopeId,
        sourceScopeVersion: link.sourceScopeVersion,
        sourceSpecificationVersion: link.sourceSpecificationVersion,
        designVersionId: link.designVersionId,
        designId: link.designId,
        assetId: link.assetId,
        fileName: link.fileName,
        mimeType: link.mimeType,
        byteSize: link.byteSize,
        title: link.title,
        documentType: link.documentType,
        revision: link.revision,
        approvedAt: link.approvedAt,
      }))
      .sort((left, right) =>
        `${left.scopeLineId}:${left.designVersionId}`.localeCompare(
          `${right.scopeLineId}:${right.designVersionId}`,
        ),
      );
  return (
    definition(expected) === definition(current) &&
    JSON.stringify(links(expected)) === JSON.stringify(links(current))
  );
}

export function designReadinessForTask(data: ProjectData, task: Task) {
  const baseline = data.designBaseline;
  if (!baseline) return { ready: true, missingScopeLineIds: [], documentIds: [] };
  const expected = baseline.links.filter((link) =>
    task.scopeIds.includes(link.scopeLineId),
  );
  if (!expected.length)
    return { ready: true, missingScopeLineIds: [], documentIds: [] };
  const documents = data.documents.filter(
    (document) =>
      document.status === "approved" &&
      document.sourceDesignVersionId &&
      expected.some(
        (link) =>
          link.designVersionId === document.sourceDesignVersionId &&
          document.scopeLineIds?.includes(link.scopeLineId),
      ),
  );
  const missingScopeLineIds = [...new Set(
    expected
      .filter(
        (link) =>
          !documents.some(
            (document) =>
              document.sourceDesignVersionId === link.designVersionId &&
              document.scopeLineIds?.includes(link.scopeLineId),
          ),
      )
      .map((link) => link.scopeLineId),
  )];
  const primaryDocument = data.documents.find(
    (document) => document.id === task.drawingId,
  );
  const primaryIsCurrent = Boolean(
    primaryDocument &&
      documents.some((document) => document.id === primaryDocument.id),
  );
  return {
    ready: missingScopeLineIds.length === 0 && primaryIsCurrent,
    missingScopeLineIds,
    documentIds: documents.map((document) => document.id),
  };
}
