import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { CreateAiSuggestionDto, DecideAiSuggestionDto } from "./dto/ai-suggestions.dto";

type Row = Record<string, unknown>;

@Injectable()
export class AiSuggestionsService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
  ) {}

  create(actor: RequestActor, workspaceId: string, input: CreateAiSuggestionDto) {
    return this.access.withPermission(actor, workspaceId, "ai.suggestions.use", async (client, user) => {
      this.assertPayload(input);
      await this.assertEntity(client, workspaceId, input.entityType, input.entityId);
      const hash = this.hash(input);
      const replay = await client.query<Row>(
        `SELECT request_hash AS "requestHash",${this.projection()} FROM ai_suggestions WHERE workspace_id=$1 AND request_id=$2`,
        [workspaceId, input.requestId],
      );
      if (replay.rowCount) {
        if (replay.rows[0].requestHash !== hash) throw new ConflictException("Suggestion request ID was already used with different content");
        return replay.rows[0];
      }
      const inserted = await client.query<Row>(
        `INSERT INTO ai_suggestions(
          workspace_id,request_id,request_hash,entity_type,entity_id,title,suggestion_text,
          evidence,proposed_diff,uncertainty,provenance,created_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING ${this.projection()}`,
        [workspaceId, input.requestId, hash, input.entityType, input.entityId, input.title.trim(), input.suggestionText.trim(), input.evidence, input.proposedDiff, input.uncertainty, input.provenance, user.userId],
      );
      const record = inserted.rows[0];
      await this.events.record(client, {
        workspaceId, actorUserId: user.userId, source: "system", action: "ai.suggestion.created.v1",
        entityType: "ai_suggestion", entityId: String(record.id),
        after: { entityType: input.entityType, entityId: input.entityId, status: "pending", evidenceCount: input.evidence.length, proposedChangeCount: input.proposedDiff.length },
      });
      return record;
    });
  }

  decide(actor: RequestActor, workspaceId: string, id: string, input: DecideAiSuggestionDto) {
    return this.access.withPermission(actor, workspaceId, "ai.suggestions.use", async (client, user) => {
      if (input.action === "edited" && !input.editedText?.trim()) throw new BadRequestException("Add the edited suggestion before accepting it");
      if (input.action !== "edited" && input.editedText !== undefined) throw new BadRequestException("Edited text is only accepted with the edited decision");
      const hash = this.hash(input);
      const replay = await client.query<Row>(
        `SELECT decision.request_hash AS "requestHash",${this.projection("suggestion")}
         FROM ai_suggestion_decisions decision
         JOIN ai_suggestions suggestion ON suggestion.workspace_id=decision.workspace_id AND suggestion.id=decision.suggestion_id
         WHERE decision.workspace_id=$1 AND decision.request_id=$2`,
        [workspaceId, input.requestId],
      );
      if (replay.rowCount) {
        if (replay.rows[0].requestHash !== hash) throw new ConflictException("Decision request ID was already used with different content");
        return replay.rows[0];
      }
      const current = await client.query<Row>(`SELECT * FROM ai_suggestions WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [workspaceId, id]);
      if (!current.rowCount) throw new NotFoundException("AI suggestion not found");
      if (current.rows[0].status !== "pending") throw new ConflictException("This AI suggestion was already reviewed");
      if (Number(current.rows[0].version) !== input.version) throw new ConflictException("AI suggestion changed; reload and try again");
      await client.query(
        `INSERT INTO ai_suggestion_decisions(workspace_id,suggestion_id,request_id,request_hash,action,edited_text,reason,actor_user_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [workspaceId, id, input.requestId, hash, input.action, input.action === "edited" ? input.editedText?.trim() : null, input.reason?.trim() || null, user.userId],
      );
      const updated = await client.query<Row>(
        `UPDATE ai_suggestions SET status=$1,edited_text=$2,decided_by=$3,decided_at=now(),version=version+1
         WHERE workspace_id=$4 AND id=$5 AND version=$6 RETURNING ${this.projection()}`,
        [input.action, input.action === "edited" ? input.editedText?.trim() : null, user.userId, workspaceId, id, input.version],
      );
      if (!updated.rowCount) throw new ConflictException("AI suggestion changed; reload and try again");
      const record = updated.rows[0];
      await this.events.record(client, {
        workspaceId, actorUserId: user.userId, source: "user", action: `ai.suggestion.${input.action}.v1`,
        entityType: "ai_suggestion", entityId: id,
        before: { status: current.rows[0].status, version: current.rows[0].version },
        after: { status: input.action, version: record.version, sourceRecordChanged: false, reason: input.reason?.trim() || null },
      });
      return record;
    });
  }

  private assertPayload(input: CreateAiSuggestionDto) {
    if (Buffer.byteLength(JSON.stringify({ evidence: input.evidence, proposedDiff: input.proposedDiff, uncertainty: input.uncertainty, provenance: input.provenance })) > 48_000)
      throw new BadRequestException("AI suggestion evidence is too large");
  }

  private async assertEntity(client: PoolClient, workspaceId: string, type: CreateAiSuggestionDto["entityType"], id: string) {
    const queries = {
      lead: `SELECT 1 FROM crm_leads WHERE workspace_id=$1 AND id=$2`,
      opportunity: `SELECT 1 FROM crm_opportunities WHERE workspace_id=$1 AND id=$2`,
      commercial_case: `SELECT 1 FROM commercial_cases WHERE workspace_id=$1 AND case_id=$2`,
      project: `SELECT 1 FROM delivery_projects WHERE workspace_id=$1 AND id=$2`,
    } as const;
    if (!(await client.query(queries[type], [workspaceId, id])).rowCount) throw new NotFoundException("Source record not found");
  }

  private projection(alias?: string) {
    const prefix = alias ? `${alias}.` : "";
    return `${prefix}id,${prefix}entity_type AS "entityType",${prefix}entity_id AS "entityId",${prefix}title,${prefix}suggestion_text AS "suggestionText",${prefix}evidence,${prefix}proposed_diff AS "proposedDiff",${prefix}uncertainty,${prefix}provenance,${prefix}status,${prefix}edited_text AS "editedText",${prefix}created_at AS "createdAt",${prefix}decided_at AS "decidedAt",${prefix}version`;
  }

  private hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
}
