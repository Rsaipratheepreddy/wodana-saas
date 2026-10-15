import { ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { acceptedQuoteValue } from "../commercial/commercial.domain";
import type { Quote } from "../commercial/commercial.types";
import { canonicalHash } from "../crm/shared/crm-types";
import { tellScopeChanges } from "../factory/factory-changes";
import { tellOverOrdered } from "../purchasing/purchasing-changes";
import { acceptedScope } from "../quotation/quotation-builder.service";
import { boqChanged } from "./project-boq-state";
import { applyVariation } from "./project-scope";

type Db = Pick<PoolClient, "query">;

/**
 * Seals an accepted variation into its project as VO-n and changes the live scope with it (plan §6.10): the accepted
 * scope from the one pricing engine is frozen with the client's acceptance and hashed, each line changes the live BOQ
 * (removed, reduced, moved or added, each in its line's history), work orders it removes or reduces stop and the
 * factory hears which, and orders it leaves past what the project needs are flagged to the buyers. A variation is
 * sealed once; the caller decides whether it may be (the client's decision, the firm's payment rule).
 */
export async function sealVariation(db: Db, input: { workspaceId: string; projectId: string; caseId: string; quote: Quote; actorUserId: string }) {
  const { workspaceId, projectId, caseId, quote, actorUserId } = input;
  const decision = quote.clientDecision;
  if (quote.kind !== "variation" || quote.status !== "accepted" || decision?.decision !== "accept") throw new ConflictException("The client hasn't accepted this variation yet.");
  const applied = (await db.query<{ label: string }>(`SELECT revision_label AS label FROM project_scope_seals WHERE workspace_id = $1 AND project_id = $2 AND quote_id = $3`,
    [workspaceId, projectId, quote.id])).rows[0];
  if (applied) throw new ConflictException(`This variation is already applied as ${applied.label}.`);
  const scope = await acceptedScope(db as PoolClient, workspaceId, caseId, quote.id);
  const places = Math.min(2, scope.quote.decimals);
  const tolerance = Dec.of(places === 0 ? "1" : places === 1 ? "0.1" : "0.01");
  if (Dec.of(scope.pricing.total).sub(Dec.of(String(acceptedQuoteValue(quote)))).abs().cmp(tolerance) > 0)
    throw new ConflictException("The variation's lines no longer add up to the total the client accepted. Issue a new revision and record the client's decision again.");
  const count = (await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM project_scope_seals WHERE workspace_id = $1 AND project_id = $2 AND kind = 'variation'`,
    [workspaceId, projectId])).rows[0].count;
  const label = `VO-${count + 1}`;
  const snapshot = { ...scope, revisionLabel: label,
    acceptance: { decidedBy: decision.decidedBy, decidedAt: decision.decidedAt, method: decision.method ?? "portal", recordedBy: decision.recordedBy ?? null,
      note: decision.note ?? "", quoteHash: decision.quoteHash, acceptedTotal: String(decision.acceptedTotal ?? quote.total) }, agreement: null };
  const sealId = randomUUID();
  await db.query(
    `INSERT INTO project_scope_seals (id, workspace_id, project_id, kind, quote_id, quote_number, revision_label, quote_hash, snapshot, content_hash, currency, total,
       accepted_at, accepted_by_name, acceptance_method, recorded_by_name, agreement_reference, sealed_by)
     VALUES ($1, $2, $3, 'variation', $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, NULL, $16)`,
    [sealId, workspaceId, projectId, quote.id, quote.number, label, decision.quoteHash, JSON.stringify(snapshot), canonicalHash(snapshot), scope.quote.currency,
      scope.pricing.total, decision.decidedAt, decision.decidedBy, decision.method ?? "portal", decision.recordedBy ?? null, actorUserId]);
  await applyVariation(db, workspaceId, projectId, { id: sealId, label }, scope.lines, actorUserId);
  // PLM-167: the live BOQ changed, so a verified or approved BOQ goes back to draft for the technical check and the QS.
  await boqChanged(db, workspaceId, projectId, label, actorUserId);
  // Work orders the variation removed or reduced stop; the factory hears which.
  await tellScopeChanges(db as PoolClient, workspaceId, projectId, actorUserId, sealId);
  // Orders it leaves past what the project needs: the people who buy hear which (D-41).
  await tellOverOrdered(db as PoolClient, workspaceId, projectId, actorUserId, { id: sealId, label });
  return { sealId, label, total: scope.pricing.total, net: scope.pricing.net, currency: scope.quote.currency, lines: scope.lines };
}
