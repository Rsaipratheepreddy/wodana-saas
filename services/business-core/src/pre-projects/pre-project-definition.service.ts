import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { canonicalHash } from "../crm/shared/crm-types";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import type {
  PublishDefinitionBaselineDto,
  RecordDefinitionDecisionDto,
} from "./pre-project-definition.dto";
import {
  clientSafeSpecification,
  definitionIssues,
  definitionSnapshotHash,
  definitionSourceHash,
  type DefinitionBaselineStatus,
  type DefinitionDecision,
  type DefinitionSourceSnapshot,
} from "./pre-project-definition";

type DefinitionRow = {
  id: string;
  caseId: string;
  number: number;
  requestId: string;
  requestHash: string;
  sourceHash: string;
  snapshotHash: string;
  snapshot: Record<string, unknown>;
  message: string;
  supersedesId: string | null;
  publishedAt: Date | string;
  publishedBy: string;
  decisionId: string | null;
  decision: DefinitionDecision | null;
  decisionBy: string | null;
  decisionChannel: string | null;
  decisionNote: string | null;
  decisionEvidence: string | null;
  decidedAt: Date | string | null;
};

type DefinitionCapture = {
  snapshot: DefinitionSourceSnapshot;
  sourceHash: string;
  issues: ReturnType<typeof definitionIssues>;
  caseStatus: string;
};

export type CurrentDefinitionConfirmation = {
  sourceHash: string;
  readyToPublish: boolean;
  confirmed: boolean;
  latest: null | {
    id: string;
    number: number;
    sourceHash: string;
    snapshotHash: string;
    status: DefinitionBaselineStatus;
    current: boolean;
  };
};

const baselineSelect = `SELECT baseline.id,baseline.case_id AS "caseId",baseline.number,
 baseline.request_id AS "requestId",baseline.request_hash AS "requestHash",
 baseline.source_hash AS "sourceHash",baseline.snapshot_hash AS "snapshotHash",
 baseline.snapshot,baseline.message,baseline.supersedes_id AS "supersedesId",
 baseline.published_at AS "publishedAt",publisher.display_name AS "publishedBy",
 decision.id AS "decisionId",decision.decision,decision.decision_by AS "decisionBy",
 decision.channel AS "decisionChannel",decision.note AS "decisionNote",
 decision.evidence AS "decisionEvidence",decision.decided_at AS "decidedAt"
 FROM pre_project_definition_baselines baseline
 JOIN users publisher ON publisher.id=baseline.published_by
 LEFT JOIN pre_project_definition_decisions decision
   ON decision.workspace_id=baseline.workspace_id
  AND decision.case_id=baseline.case_id
  AND decision.baseline_id=baseline.id`;

const iso = (value: Date | string | null) =>
  value ? new Date(value).toISOString() : null;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const array = (value: unknown) => (Array.isArray(value) ? value : []);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class PreProjectDefinitionService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
  ) {}

  get(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withPermission(
      actor,
      workspaceId,
      "pre_projects.view",
      async (client, user) => {
        const result = await this.state(client, workspaceId, caseId);
        const active = result.caseStatus === "active";
        return {
          ...result,
          canPublish:
            active &&
            (await this.access.hasPermission(
              client,
              workspaceId,
              user.userId,
              "pre_projects.publish_definition",
            )),
          canRecordClientDecision:
            active &&
            (await this.access.hasPermission(
              client,
              workspaceId,
              user.userId,
              "pre_projects.record_client_definition_decisions",
            )),
        };
      },
    );
  }

  publish(
    actor: RequestActor,
    workspaceId: string,
    caseId: string,
    input: PublishDefinitionBaselineDto,
  ) {
    return this.access.withPermissions(
      actor,
      workspaceId,
      ["pre_projects.view", "pre_projects.edit", "pre_projects.publish_definition"],
      async (client, user) => {
        const caseRow = await this.lockCase(client, workspaceId, caseId);
        const requestHash = canonicalHash({ caseId, ...input });
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `${workspaceId}:definition:${input.requestId}`,
        ]);
        const replay = await this.commandReplay(
          client,
          workspaceId,
          caseId,
          input.requestId,
          requestHash,
        );
        if (replay) return { ...replay, replayed: true };
        if (caseRow.status !== "active")
          throw new ConflictException(
            "Resume or reopen this Preparation before publishing its definition.",
          );
        const capture = await this.capture(client, workspaceId, caseId);
        if (capture.sourceHash !== input.sourceHash)
          throw new ConflictException(
            "The requirements changed after this review. Reload the current definition before publishing.",
          );
        if (capture.issues.length)
          throw new ConflictException(capture.issues[0].detail);
        const latest = await this.latest(client, workspaceId, caseId);
        if (latest?.sourceHash === capture.sourceHash) {
          if (latest.decision === "changes_requested")
            throw new ConflictException(
              "Apply the requested changes before publishing a new definition.",
            );
          const response = {
            ...this.present(latest, capture.sourceHash, latest.id),
            unchanged: true,
          };
          await this.saveCommand(
            client,
            workspaceId,
            caseId,
            input.requestId,
            requestHash,
            response,
            user.userId,
          );
          return response;
        }
        const id = randomUUID();
        const number = (latest?.number ?? 0) + 1;
        const snapshot = {
          definition: capture.snapshot,
          publication: { message: input.message },
        };
        const snapshotHash = definitionSnapshotHash(capture.snapshot, {
          message: input.message,
        });
        const inserted = await client.query<DefinitionRow>(
          `INSERT INTO pre_project_definition_baselines
           (id,workspace_id,case_id,number,request_id,request_hash,source_hash,snapshot_hash,snapshot,message,supersedes_id,published_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING id,case_id AS "caseId",number,request_id AS "requestId",request_hash AS "requestHash",
             source_hash AS "sourceHash",snapshot_hash AS "snapshotHash",snapshot,message,
             supersedes_id AS "supersedesId",published_at AS "publishedAt"`,
          [
            id,
            workspaceId,
            caseId,
            number,
            input.requestId,
            requestHash,
            capture.sourceHash,
            snapshotHash,
            snapshot,
            input.message,
            latest?.id ?? null,
            user.userId,
          ],
        );
        const row: DefinitionRow = {
          ...inserted.rows[0],
          publishedBy: user.displayName,
          decisionId: null,
          decision: null,
          decisionBy: null,
          decisionChannel: null,
          decisionNote: null,
          decisionEvidence: null,
          decidedAt: null,
        };
        await this.events.record(client, {
          workspaceId,
          actorUserId: user.userId,
          source: "user",
          action: "pre_project.definition_baseline_published.v1",
          entityType: "pre_project_definition_baseline",
          entityId: id,
          correlationId: input.requestId,
          after: {
            caseId,
            number,
            sourceHash: capture.sourceHash,
            snapshotHash,
            supersedesId: latest?.id ?? null,
          },
        });
        const response = this.present(row, capture.sourceHash, id);
        await this.saveCommand(
          client,
          workspaceId,
          caseId,
          input.requestId,
          requestHash,
          response,
          user.userId,
        );
        return response;
      },
    );
  }

  recordDecision(
    actor: RequestActor,
    workspaceId: string,
    caseId: string,
    baselineId: string,
    input: RecordDefinitionDecisionDto,
  ) {
    return this.access.withPermissions(
      actor,
      workspaceId,
      ["pre_projects.view", "pre_projects.record_client_definition_decisions"],
      async (client, user) => {
        const caseRow = await this.lockCase(client, workspaceId, caseId);
        const requestHash = canonicalHash({ baselineId, ...input });
        const replay = await this.decisionById(
          client,
          workspaceId,
          input.requestId,
        );
        if (replay) {
          if (replay.requestHash !== requestHash)
            throw new ConflictException(
              "This decision request was already used with different information.",
            );
          return { ok: true, replayed: true, decision: replay.decision };
        }
        if (caseRow.status !== "active")
          throw new ConflictException(
            "Resume or reopen this Preparation before recording a client decision.",
          );
        if (input.decision === "changes_requested" && !input.note.trim())
          throw new BadRequestException("Describe the changes required.");
        const decidedAt = this.decisionTime(input.decidedAt);
        const current = await this.assertDecisionAvailable(
          client,
          workspaceId,
          caseId,
          baselineId,
        );
        if (decidedAt < new Date(current.publishedAt))
          throw new BadRequestException(
            "The client decision cannot predate the published definition.",
          );
        await this.insertDecision(client, {
          id: randomUUID(),
          workspaceId,
          caseId,
          baselineId,
          requestId: input.requestId,
          requestHash,
          decision: input.decision,
          decisionBy: input.decisionBy,
          channel: input.channel,
          note: input.note,
          evidence: input.evidence,
          decidedAt,
          recordedBy: user.userId,
          clientGrantId: null,
          challengeId: null,
        });
        await this.recordDecisionEvent(
          client,
          workspaceId,
          caseId,
          baselineId,
          input.decision,
          input.decisionBy,
          user.userId,
          input.requestId,
        );
        return { ok: true, replayed: false, decision: input.decision };
      },
    );
  }

  async currentConfirmation(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
  ): Promise<CurrentDefinitionConfirmation> {
    const capture = await this.capture(client, workspaceId, caseId);
    const latest = await this.latest(client, workspaceId, caseId);
    if (!latest)
      return {
        sourceHash: capture.sourceHash,
        readyToPublish: capture.issues.length === 0,
        confirmed: false,
        latest: null,
      };
    const current = latest.sourceHash === capture.sourceHash;
    const status = this.status(latest, current, true);
    return {
      sourceHash: capture.sourceHash,
      readyToPublish: capture.issues.length === 0,
      confirmed: current && status === "confirmed",
      latest: {
        id: latest.id,
        number: Number(latest.number),
        sourceHash: latest.sourceHash,
        snapshotHash: latest.snapshotHash,
        status,
        current,
      },
    };
  }

  async portalData(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    grant: { id: string; role: string },
  ) {
    const capture = await this.capture(client, workspaceId, caseId);
    const latest = await this.latest(client, workspaceId, caseId);
    if (!latest) return null;
    const presented = this.present(
      latest,
      capture.sourceHash,
      latest.id,
    );
    const portalDecision = presented.decision
      ? {
          id: presented.decision.id,
          decision: presented.decision.decision,
          decisionBy: presented.decision.decisionBy,
          channel: presented.decision.channel,
          note: presented.decision.note,
          decidedAt: presented.decision.decidedAt,
        }
      : null;
    return {
      ...presented,
      decision: portalDecision,
      canDecide:
        grant.role === "approver" &&
        capture.caseStatus === "active" &&
        presented.current &&
        presented.status === "awaiting_confirmation",
    };
  }

  async assertPortalDecisionAvailable(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    baselineId: string,
  ) {
    if (!uuid.test(baselineId))
      throw new BadRequestException("Choose a valid definition version.");
    await this.assertDecisionAvailable(
      client,
      workspaceId,
      caseId,
      baselineId,
    );
  }

  async decidePortal(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    grant: { id: string; name: string; role: string },
    input: {
      baselineId: string;
      decision: "accept" | "changes";
      note: string;
      challengeId: string;
    },
    verify: () => Promise<string | null>,
  ) {
    if (grant.role !== "approver")
      throw new ForbiddenException(
        "Only the designated approver can confirm this definition.",
      );
    if (!uuid.test(input.baselineId))
      throw new BadRequestException("Choose a valid definition version.");
    const decision: DefinitionDecision =
      input.decision === "accept" ? "confirmed" : "changes_requested";
    if (decision === "changes_requested" && !input.note.trim())
      throw new BadRequestException("Describe the changes required.");
    const requestHash = canonicalHash({
      caseId,
      grantId: grant.id,
      ...input,
      decision,
    });
    await this.lockCase(client, workspaceId, caseId);
    const replay = await client.query<{
      requestHash: string;
      decision: DefinitionDecision;
    }>(
      `SELECT request_hash AS "requestHash",decision
       FROM pre_project_definition_decisions
       WHERE workspace_id=$1 AND challenge_id=$2`,
      [workspaceId, input.challengeId],
    );
    if (replay.rowCount) {
      if (replay.rows[0].requestHash !== requestHash)
        throw new ConflictException(
          "This approval code was already used for another decision.",
        );
      return { ok: true, replayed: true, decision: replay.rows[0].decision };
    }
    await this.assertDecisionAvailable(
      client,
      workspaceId,
      caseId,
      input.baselineId,
    );
    if (!(await verify())) return { invalidCode: true as const };
    const id = randomUUID();
    await this.insertDecision(client, {
      id,
      workspaceId,
      caseId,
      baselineId: input.baselineId,
      requestId: null,
      requestHash,
      decision,
      decisionBy: grant.name,
      channel: "client_portal",
      note: input.note,
      evidence: `Verified client portal OTP challenge ${input.challengeId}`,
      decidedAt: new Date(),
      recordedBy: null,
      clientGrantId: grant.id,
      challengeId: input.challengeId,
    });
    await this.recordDecisionEvent(
      client,
      workspaceId,
      caseId,
      input.baselineId,
      decision,
      grant.name,
      null,
      input.challengeId,
    );
    return { ok: true, replayed: false, decision };
  }

  private async state(client: PoolClient, workspaceId: string, caseId: string) {
    const capture = await this.capture(client, workspaceId, caseId);
    const history = await client.query<DefinitionRow>(
      `${baselineSelect}
       WHERE baseline.workspace_id=$1 AND baseline.case_id=$2
       ORDER BY baseline.number DESC LIMIT 50`,
      [workspaceId, caseId],
    );
    const latestId = history.rows[0]?.id ?? null;
    const baselines = history.rows.map((row) =>
      this.present(row, capture.sourceHash, latestId),
    );
    const current = baselines[0] ?? null;
    const nextAction =
      capture.caseStatus !== "active"
        ? "RESUME_ENGAGEMENT"
        : capture.issues.length
          ? "COMPLETE_DEFINITION"
          : !current?.current
            ? "PUBLISH_DEFINITION"
            : current.status === "awaiting_confirmation"
              ? "REQUEST_DEFINITION_CONFIRMATION"
              : current.status === "changes_requested"
                ? "APPLY_DEFINITION_CHANGES"
                : null;
    return {
      caseStatus: capture.caseStatus,
      draft: {
        sourceHash: capture.sourceHash,
        readyToPublish: capture.issues.length === 0,
        issues: capture.issues,
      },
      current,
      history: baselines,
      confirmed: Boolean(current?.current && current.status === "confirmed"),
      nextAction,
    };
  }

  private async capture(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
  ): Promise<DefinitionCapture> {
    const caseResult = await client.query<{ id: string; status: string }>(
      `SELECT id,status::text AS status FROM pre_project_cases
       WHERE workspace_id=$1 AND id=$2`,
      [workspaceId, caseId],
    );
    if (!caseResult.rowCount)
      throw new NotFoundException("Pre-execution not found.");
    const brief = await client.query<{ version: number; content: unknown }>(
      `SELECT version,content FROM pre_project_briefs
       WHERE workspace_id=$1 AND case_id=$2`,
      [workspaceId, caseId],
    );
    const rooms = await client.query<{
      id: string;
      version: number;
      name: string;
    }>(
      `SELECT id,version,name FROM pre_project_rooms
       WHERE workspace_id=$1 AND case_id=$2 ORDER BY lower(name),id`,
      [workspaceId, caseId],
    );
    const items = await client.query<Record<string, unknown>>(
      `SELECT entry.id,entry.version,entry.title,entry.room_id AS "roomId",
              room.name AS "roomName",entry.category,entry.priority,
              entry.scope_status AS "scopeStatus",entry.review_status AS "reviewStatus",
              entry.source,entry.quantity::text AS quantity,entry.unit,entry.note,
              entry.note_document AS document,
              entry.avoid,entry.reference_url AS "referenceUrl",
              specification.version AS "specificationVersion",
              specification.content AS specification,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'role',link.role,'recordId',link.record_id,'version',link.snapshot->'version',
                  'name',link.snapshot->>'name','code',link.snapshot->>'code',
                  'catalogId',link.snapshot->>'catalogId'
                ) ORDER BY link.role,link.record_id)
                FROM pre_project_scope_links link
                WHERE link.workspace_id=entry.workspace_id
                  AND link.case_id=entry.case_id AND link.entry_id=entry.id
              ),'[]'::jsonb) AS catalog,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id',asset.id,'name',asset.original_name,'mimeType',asset.mime_type,
                  'sha256',asset.sha256
                ) ORDER BY asset.id)
                FROM pre_project_entry_assets attached
                JOIN pre_project_brief_assets asset
                  ON asset.workspace_id=attached.workspace_id
                 AND asset.case_id=attached.case_id AND asset.id=attached.asset_id
                WHERE attached.workspace_id=entry.workspace_id
                  AND attached.case_id=entry.case_id AND attached.entry_id=entry.id
              ),'[]'::jsonb) AS "evidenceFiles"
       FROM pre_project_brief_entries entry
       LEFT JOIN pre_project_rooms room
         ON room.workspace_id=entry.workspace_id
        AND room.case_id=entry.case_id AND room.id=entry.room_id
       LEFT JOIN LATERAL(
         SELECT candidate.version,candidate.content
         FROM pre_project_item_specifications candidate
         WHERE candidate.workspace_id=entry.workspace_id
           AND candidate.case_id=entry.case_id AND candidate.entry_id=entry.id
         ORDER BY candidate.version DESC LIMIT 1
       ) specification ON true
       WHERE entry.workspace_id=$1 AND entry.case_id=$2
         AND entry.kind='requirement' AND entry.archived_at IS NULL
       ORDER BY room.name NULLS FIRST,entry.title,entry.id`,
      [workspaceId, caseId],
    );
    const designs = await client.query<Record<string, unknown>>(
      `SELECT reference.entry_id AS "entryId",reference.version AS "specificationVersion",
              version.id AS "versionId",version.design_id AS "designId",version.number,
              design.title,design.document_type AS "documentType",version.status,
              reference.usage,reference.sheet,
              asset.original_name AS "fileName",asset.mime_type AS "mimeType",asset.sha256
       FROM pre_project_item_design_refs reference
       JOIN pre_project_design_versions version
         ON version.workspace_id=reference.workspace_id
        AND version.case_id=reference.case_id AND version.id=reference.design_version_id
       JOIN pre_project_designs design
         ON design.workspace_id=version.workspace_id
        AND design.case_id=version.case_id AND design.id=version.design_id
       JOIN pre_project_brief_assets asset
         ON asset.workspace_id=version.workspace_id
        AND asset.case_id=version.case_id AND asset.id=version.asset_id
       WHERE reference.workspace_id=$1 AND reference.case_id=$2
       ORDER BY reference.entry_id,reference.version,version.design_id,version.number,version.id`,
      [workspaceId, caseId],
    );
    const designMap = new Map<string, Array<Record<string, unknown>>>();
    for (const design of designs.rows) {
      const key = `${design.entryId}:${Number(design.specificationVersion)}`;
      const values = designMap.get(key) ?? [];
      values.push(design);
      designMap.set(key, values);
    }
    const briefContent = object(brief.rows[0]?.content);
    const snapshot: DefinitionSourceSnapshot = {
      schemaVersion: 1,
      caseId,
      brief: {
        version: Number(brief.rows[0]?.version ?? 0),
        goals: text(briefContent.goals),
        propertyType: text(briefContent.propertyType),
        location: text(briefContent.location),
        area: text(briefContent.area),
        budget: text(briefContent.budget),
        budgetAmount: text(briefContent.budgetAmount),
        currencyCode: text(briefContent.currencyCode),
        timeline: text(briefContent.timeline),
        decisionMakers: text(briefContent.decisionMakers),
        people: text(briefContent.people),
        preferences: text(briefContent.preferences),
        retainedItems: text(briefContent.retainedItems),
        exclusions: text(briefContent.exclusions),
        constraints: text(briefContent.constraints),
      },
      rooms: rooms.rows.map((room) => ({
        id: room.id,
        version: Number(room.version),
        name: room.name,
      })),
      items: items.rows.map((item) => {
        const specificationVersion = item.specificationVersion
          ? Number(item.specificationVersion)
          : null;
        const parsedQuantity = item.quantity === null ? null : Number(item.quantity);
        return {
          id: String(item.id),
          version: Number(item.version),
          title: String(item.title),
          roomId: item.roomId ? String(item.roomId) : null,
          roomName: item.roomName ? String(item.roomName) : null,
          category: String(item.category),
          priority: String(item.priority),
          scopeStatus: String(item.scopeStatus),
          reviewStatus: String(item.reviewStatus),
          source: String(item.source),
          quantity: Number.isFinite(parsedQuantity) ? parsedQuantity : null,
          unit: String(item.unit),
          requirement: text(item.note),
          document: item.document ? object(item.document) : null,
          avoid: text(item.avoid),
          referenceUrl: text(item.referenceUrl),
          catalog: array(item.catalog).map(object),
          evidenceFiles: array(item.evidenceFiles).map(object),
          specification:
            specificationVersion === null
              ? null
              : clientSafeSpecification(
                  specificationVersion,
                  item.specification,
                  designMap.get(`${item.id}:${specificationVersion}`) ?? [],
                ),
        };
      }),
    };
    return {
      snapshot,
      sourceHash: definitionSourceHash(snapshot),
      issues: definitionIssues(snapshot),
      caseStatus: caseResult.rows[0].status,
    };
  }

  private async latest(client: PoolClient, workspaceId: string, caseId: string) {
    return (
      await client.query<DefinitionRow>(
        `${baselineSelect}
         WHERE baseline.workspace_id=$1 AND baseline.case_id=$2
         ORDER BY baseline.number DESC LIMIT 1`,
        [workspaceId, caseId],
      )
    ).rows[0] ?? null;
  }

  private present(
    row: DefinitionRow,
    currentSourceHash: string,
    latestId: string | null,
  ) {
    const current = row.id === latestId && row.sourceHash === currentSourceHash;
    return {
      id: row.id,
      number: Number(row.number),
      sourceHash: row.sourceHash,
      snapshotHash: row.snapshotHash,
      snapshot: row.snapshot,
      message: row.message,
      supersedesId: row.supersedesId,
      publishedAt: iso(row.publishedAt),
      publishedBy: row.publishedBy,
      status: this.status(row, current, row.id === latestId),
      current,
      decision: row.decisionId
        ? {
            id: row.decisionId,
            decision: row.decision,
            decisionBy: row.decisionBy,
            channel: row.decisionChannel,
            note: row.decisionNote,
            evidence: row.decisionEvidence,
            decidedAt: iso(row.decidedAt),
          }
        : null,
    };
  }

  private status(
    row: DefinitionRow,
    current: boolean,
    latest: boolean,
  ): DefinitionBaselineStatus {
    if (!current || !latest) return "superseded";
    return row.decision ?? "awaiting_confirmation";
  }

  private async assertDecisionAvailable(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    baselineId: string,
  ) {
    const capture = await this.capture(client, workspaceId, caseId);
    if (capture.caseStatus !== "active")
      throw new ConflictException(
        "This Preparation is no longer open for client definition decisions.",
      );
    const latest = await this.latest(client, workspaceId, caseId);
    if (!latest || latest.id !== baselineId)
      throw new ConflictException(
        "This definition is no longer the current published version.",
      );
    if (latest.sourceHash !== capture.sourceHash)
      throw new ConflictException(
        "The requirements changed after publication. Publish the updated definition before client confirmation.",
      );
    if (latest.decision)
      throw new ConflictException(
        "This definition already has a client decision.",
      );
    return latest;
  }

  private async lockCase(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
  ) {
    const result = await client.query<{ status: string }>(
      `SELECT status::text AS status FROM pre_project_cases
       WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
      [workspaceId, caseId],
    );
    if (!result.rowCount)
      throw new NotFoundException("Pre-execution not found.");
    return result.rows[0];
  }

  private decisionTime(value: string) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now() + 300_000)
      throw new BadRequestException("Choose a valid client decision time.");
    return date;
  }

  private async decisionById(
    client: PoolClient,
    workspaceId: string,
    requestId: string,
  ) {
    return (
      await client.query<{
        requestHash: string;
        decision: DefinitionDecision;
      }>(
        `SELECT request_hash AS "requestHash",decision
         FROM pre_project_definition_decisions
         WHERE workspace_id=$1 AND request_id=$2`,
        [workspaceId, requestId],
      )
    ).rows[0] ?? null;
  }

  private insertDecision(
    client: PoolClient,
    input: {
      id: string;
      workspaceId: string;
      caseId: string;
      baselineId: string;
      requestId: string | null;
      requestHash: string;
      decision: DefinitionDecision;
      decisionBy: string;
      channel: string;
      note: string;
      evidence: string;
      decidedAt: Date;
      recordedBy: string | null;
      clientGrantId: string | null;
      challengeId: string | null;
    },
  ) {
    return client.query(
      `INSERT INTO pre_project_definition_decisions
       (id,workspace_id,case_id,baseline_id,request_id,request_hash,decision,decision_by,channel,note,evidence,decided_at,recorded_by,client_grant_id,challenge_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        input.id,
        input.workspaceId,
        input.caseId,
        input.baselineId,
        input.requestId,
        input.requestHash,
        input.decision,
        input.decisionBy,
        input.channel,
        input.note,
        input.evidence,
        input.decidedAt,
        input.recordedBy,
        input.clientGrantId,
        input.challengeId,
      ],
    );
  }

  private recordDecisionEvent(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    baselineId: string,
    decision: DefinitionDecision,
    decisionBy: string,
    actorUserId: string | null,
    correlationId: string,
  ) {
    return this.events.record(client, {
      workspaceId,
      actorUserId,
      source: "user",
      action: "pre_project.definition_baseline_decided.v1",
      entityType: "pre_project_definition_baseline",
      entityId: baselineId,
      correlationId,
      after: { caseId, decision, decisionBy },
    });
  }

  private async commandReplay(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    requestId: string,
    requestHash: string,
  ) {
    const result = await client.query<{
      caseId: string;
      action: string;
      requestHash: string;
      responseBody: Record<string, unknown>;
    }>(
      `SELECT case_id AS "caseId",action,request_hash AS "requestHash",
              response_body AS "responseBody"
       FROM pre_project_definition_commands
       WHERE workspace_id=$1 AND request_id=$2`,
      [workspaceId, requestId],
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    if (
      row.caseId !== caseId ||
      row.action !== "publish" ||
      row.requestHash !== requestHash
    )
      throw new ConflictException(
        "This publication request was already used with different information.",
      );
    return row.responseBody;
  }

  private saveCommand(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    requestId: string,
    requestHash: string,
    responseBody: Record<string, unknown>,
    actorUserId: string,
  ) {
    return client.query(
      `INSERT INTO pre_project_definition_commands
       (workspace_id,request_id,case_id,action,request_hash,response_body,actor_user_id)
       VALUES($1,$2,$3,'publish',$4,$5,$6)`,
      [
        workspaceId,
        requestId,
        caseId,
        requestHash,
        responseBody,
        actorUserId,
      ],
    );
  }
}
