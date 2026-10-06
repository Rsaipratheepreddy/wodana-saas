import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { approvalStatus, decideApproval, requestApproval } from "../approvals/approval-engine.api";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { quotePricingSnapshot } from "../quotation/quotation-builder.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { pricingHash, qsStage, type QsReviewState } from "./qs-review.domain";
import { quotationReference } from "./quote-issue";
import { qsRequirement } from "./qs-requirement";

type Db = PoolClient;
const VIEW = "pre_projects.view", EDIT = "pre_projects.edit", QS = "commercial.estimate";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REVIEW_SELECT = `SELECT review.id, review.status, review.assignee_user_id AS "assigneeUserId", assignee.display_name AS "assigneeName",
  review.requested_by AS "requestedBy", requester.display_name AS "requestedByName", review.requested_at AS "requestedAt", review.note,
  review.decided_by AS "decidedBy", decider.display_name AS "decidedByName", review.decided_at AS "decidedAt", review.decision_note AS "decisionNote",
  review.pricing_hash AS "pricingHash", review.version, review.approval_id AS "approvalId"
  FROM quote_qs_reviews review
  LEFT JOIN users assignee ON assignee.id = review.assignee_user_id
  LEFT JOIN users requester ON requester.id = review.requested_by
  LEFT JOIN users decider ON decider.id = review.decided_by`;

/**
 * PLM-082/084, the quotation hand-off: Sales admin sends a quotation to a named QS ("With QS"); the QS prices it and
 * confirms or returns it. The confirmation is an E3 approval decision (kind `quote_qs`, the policy's QS step, never
 * the requester), recorded with who and when and the exact pricing it covers. Sending to the client waits for a
 * confirmation that still matches (quote-issue.ts); while with the QS only a QS edits the quotation.
 */
@Injectable()
export class QsReviewService {
  constructor(private readonly access: WorkspaceAccessService) {}

  state(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, (client, user) => this.read(client, workspaceId, caseId, quoteId, user.userId));
  }

  /** Hands the quotation to a QS. Sending again to another QS moves it to them; the same QS again changes nothing. */
  async send(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string, input: { assigneeUserId?: unknown; note?: unknown }) {
    const assignee = typeof input.assigneeUserId === "string" && UUID.test(input.assigneeUserId) ? input.assigneeUserId.toLowerCase() : null;
    if (!assignee) throw new BadRequestException("Choose the QS.");
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 2000) : "";
    return this.access.withPermissions(actor, workspaceId, [VIEW, EDIT], async (client, user) => {
      const quote = await this.quote(client, workspaceId, caseId, quoteId, true);
      if (quote.kind !== "quotation") throw new ConflictException("Only a quotation goes to the QS.");
      if (quote.status !== "draft") throw new ConflictException("This quotation was already sent. Start a new revision to price it again.");
      if (assignee === user.userId) throw new ForbiddenException("Send it to another QS: nobody confirms their own quotation.");
      if (!(await this.access.hasPermission(client, workspaceId, assignee, QS))) throw new BadRequestException("Choose someone who prices quotations (QS).");
      const open = (await client.query<QsReviewState & { approvalId: string | null }>(`${REVIEW_SELECT} WHERE review.workspace_id = $1 AND review.case_id = $2 AND review.quote_id = $3 AND review.status = 'with_qs' FOR UPDATE OF review`,
        [workspaceId, caseId, quoteId])).rows[0];
      if (open?.assigneeUserId === assignee) return this.read(client, workspaceId, caseId, quoteId, user.userId);
      const title = await this.title(client, workspaceId, caseId, quote, quoteId);
      if (open) {
        await client.query(`UPDATE quote_qs_reviews SET assignee_user_id = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, open.id, assignee]);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "quotation.qs_reassigned.v1", entityType: "pre_project_case", entityId: caseId,
          before: { reviewId: open.id, assignee: open.assigneeUserId }, after: { reviewId: open.id, assignee, quoteId } });
        await this.tell(client, workspaceId, caseId, quoteId, [assignee], "quotation.with_qs", { title, actor: user.displayName, note: open.note }, `${open.id}:${assignee}`, true);
        return this.read(client, workspaceId, caseId, quoteId, user.userId);
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO quote_qs_reviews (workspace_id, id, case_id, quote_id, assignee_user_id, status, requested_by, note, requested_at) VALUES ($1, $2, $3, $4, $5, 'with_qs', $6, $7, clock_timestamp())`,
        [workspaceId, id, caseId, quoteId, assignee, user.userId, note]);
      // The engine owns who may confirm (the QS step, never the requester); this module tells the named QS itself.
      const approval = await requestApproval(client, { workspaceId, kind: "quote_qs", subjectId: id, title, amount: quote.total, currency: quote.currency,
        requesterUserId: user.userId, href: this.href(caseId, quoteId), notify: false });
      await client.query(`UPDATE quote_qs_reviews SET approval_id = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, approval.id]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "quotation.sent_to_qs.v1", entityType: "pre_project_case", entityId: caseId,
        after: { reviewId: id, quoteId, assignee, approvalId: approval.id, note } });
      await this.tell(client, workspaceId, caseId, quoteId, [assignee], "quotation.with_qs", { title, actor: user.displayName, note }, `${id}:${assignee}`, true);
      return this.read(client, workspaceId, caseId, quoteId, user.userId);
    });
  }

  /** The QS confirms the pricing as it stands now (who, when and exactly which pricing), or returns it with a note. */
  async decide(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string, input: { decision?: unknown; note?: unknown; version?: unknown; commandId?: unknown }) {
    const decision = input.decision === "confirm" ? "confirm" : input.decision === "return" ? "return" : null;
    if (!decision) throw new BadRequestException("Confirm the pricing or return it.");
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 2000) : "";
    if (decision === "return" && !note) throw new BadRequestException("Say what needs to change.");
    const commandId = typeof input.commandId === "string" && UUID.test(input.commandId) ? input.commandId.toLowerCase() : null;
    return this.access.withPermissions(actor, workspaceId, [VIEW, QS], async (client, user) => {
      const quote = await this.quote(client, workspaceId, caseId, quoteId, true);
      const review = (await client.query<QsReviewState & { approvalId: string | null }>(
        `${REVIEW_SELECT} WHERE review.workspace_id = $1 AND review.case_id = $2 AND review.quote_id = $3 ORDER BY review.requested_at DESC, review.id DESC LIMIT 1 FOR UPDATE OF review`,
        [workspaceId, caseId, quoteId])).rows[0];
      if (!review) throw new NotFoundException("This quotation wasn't sent to the QS.");
      if (review.status !== "with_qs") {
        // The same decision again (a retry) returns where it stands; anything else was decided already.
        if ((review.status === "confirmed" && decision === "confirm") || (review.status === "returned" && decision === "return")) return this.read(client, workspaceId, caseId, quoteId, user.userId);
        throw new ConflictException(`This was already ${review.status === "confirmed" ? "confirmed" : "returned"} by ${review.decidedByName ?? "the QS"}.`);
      }
      if (input.version !== undefined && Number(input.version) !== review.version) throw new ConflictException("This changed while you were looking. Reload to see the latest.");
      if (quote.status !== "draft") throw new ConflictException("This quotation was already sent.");
      const snapshot = await quotePricingSnapshot(client, workspaceId, caseId, quoteId);
      if (decision === "confirm" && (!snapshot.lines.length || snapshot.lines.some((line) => !line.optional && Number(line.rate) <= 0 && line.kind !== "client_supplied")))
        throw new ConflictException("Price every line before confirming.");
      // The engine decides who may (separation of duties, delegation, escalation) and records the decision.
      const approval = await decideApproval(client, { workspaceId, kind: "quote_qs", subjectId: review.id, deciderUserId: user.userId,
        decision: decision === "confirm" ? "approve" : "return", note: note || null, commandId, notify: false });
      const done = decision === "return" || approval.status === "approved";
      if (!done) return this.read(client, workspaceId, caseId, quoteId, user.userId); // a later step (the policy has more than one) still decides
      const hash = pricingHash(snapshot.lines);
      await client.query(
        `UPDATE quote_qs_reviews SET status = $3, decided_by = $4, decided_at = now(), decision_note = $5, pricing_hash = $6, version = version + 1 WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, review.id, decision === "confirm" ? "confirmed" : "returned", user.userId, note, decision === "confirm" ? hash : null]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: decision === "confirm" ? "quotation.qs_confirmed.v1" : "quotation.qs_returned.v1",
        entityType: "pre_project_case", entityId: caseId, after: { reviewId: review.id, quoteId, approvalId: approval.id, pricingHash: decision === "confirm" ? hash : null, total: snapshot.pricing.total, note } });
      const owner = (await client.query<{ userId: string | null }>(
        `SELECT owner.user_id AS "userId" FROM pre_project_cases pre_case JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
           LEFT JOIN workspace_memberships owner ON owner.workspace_id = opportunity.workspace_id AND owner.id = opportunity.owner_membership_id AND owner.status = 'active'
          WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0]?.userId ?? null;
      await this.tell(client, workspaceId, caseId, quoteId, [review.requestedBy, owner], decision === "confirm" ? "quotation.qs_confirmed" : "quotation.qs_returned",
        { title: await this.title(client, workspaceId, caseId, quote, quoteId), actor: user.displayName, note }, review.id, decision === "confirm", user.userId);
      return this.read(client, workspaceId, caseId, quoteId, user.userId);
    });
  }

  private async read(client: Db, workspaceId: string, caseId: string, quoteId: string, userId: string) {
    const quote = await this.quote(client, workspaceId, caseId, quoteId, false);
    // Whether this quotation needs the QS, and why (the firm's switch and rules; shown in the quote flow).
    const requirement = await qsRequirement(client, workspaceId, caseId, quoteId);
    const required = requirement.required;
    const review = (await client.query<QsReviewState & { approvalId: string | null }>(
      `${REVIEW_SELECT} WHERE review.workspace_id = $1 AND review.case_id = $2 AND review.quote_id = $3 ORDER BY review.requested_at DESC, review.id DESC LIMIT 1`,
      [workspaceId, caseId, quoteId])).rows[0] ?? null;
    const snapshot = await quotePricingSnapshot(client, workspaceId, caseId, quoteId);
    const stage = qsStage(required, review, pricingHash(snapshot.lines));
    const approval = review ? await approvalStatus(client, workspaceId, "quote_qs", review.id) : null;
    const isQs = await this.access.hasPermission(client, workspaceId, userId, QS);
    return {
      required, reason: requirement.reason, stage,
      review: review ? { ...review, approvalId: undefined, approval: approval ? { id: approval.id, status: approval.status, waitingFor: approval.waitingFor, steps: approval.steps } : null } : null,
      reference: (await quotationReference(client, workspaceId, caseId, quote.familyId ?? quoteId))?.reference ?? null,
      // Who can do what next: Sales sends (or moves it to another QS); a QS other than the requester decides.
      canSend: quote.kind === "quotation" && quote.status === "draft" && await this.access.hasPermission(client, workspaceId, userId, EDIT),
      canDecide: Boolean(review && review.status === "with_qs" && isQs && review.requestedBy !== userId),
      people: (await client.query<{ userId: string; name: string }>(
        `SELECT DISTINCT membership.user_id AS "userId", account.display_name AS name
           FROM workspace_memberships membership
           JOIN users account ON account.id = membership.user_id AND account.status = 'active'
           JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
           JOIN role_permissions granted ON granted.role_id = assigned.role_id
           JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = $2
          WHERE membership.workspace_id = $1 AND membership.status = 'active' AND membership.user_id <> $3
          ORDER BY account.display_name LIMIT 50`, [workspaceId, QS, userId])).rows,
    };
  }

  private async quote(client: Db, workspaceId: string, caseId: string, quoteId: string, lock: boolean) {
    const quote = (await client.query<{ kind: string; status: string; number: number; title: string; total: string; currency: string; familyId: string | null }>(
      `SELECT kind, status, number, title, total::text AS total, currency, family_id AS "familyId" FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3 ${lock ? "FOR UPDATE" : ""}`,
      [workspaceId, caseId, quoteId])).rows[0];
    if (!quote) throw new NotFoundException("Quote not found.");
    return quote;
  }

  private async title(client: Db, workspaceId: string, caseId: string, quote: { number: number; title: string; familyId: string | null }, quoteId: string) {
    const reference = await quotationReference(client, workspaceId, caseId, quote.familyId ?? quoteId);
    return `${reference?.reference ?? `Q-${quote.number}`} · ${quote.title}`;
  }

  private href(caseId: string, quoteId: string) {
    return `/workspace/pre-projects/cases/${caseId}/quotations?quote=${encodeURIComponent(quoteId)}`;
  }

  private async tell(client: Db, workspaceId: string, caseId: string, quoteId: string, recipients: Array<string | null>, code: string,
    values: { title: string; actor: string; note: string }, key: string, email: boolean, except?: string) {
    const clientName = (await client.query<{ name: string }>(
      `SELECT coalesce(party.display_name, opportunity.title) AS name FROM pre_project_cases pre_case
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
        WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0]?.name ?? "";
    const variables = { ...values, clientName };
    for (const userId of [...new Set(recipients.filter((id): id is string => Boolean(id) && id !== except))]) {
      const message = { workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink: this.href(caseId, quoteId) };
      await notifyUserInApp(client, { ...message, idempotencyKey: `${code}:${key}:${userId}` });
      if (email) await queueUserEmail(client, { ...message, idempotencyKey: `${code}:${key}:${userId}:email` });
    }
  }
}
