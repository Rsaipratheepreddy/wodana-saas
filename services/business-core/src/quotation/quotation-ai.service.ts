import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { RequestActor } from "../auth/actor";
import { AiGatewayService } from "../ai-gateway/ai-gateway.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { draftPrompt, editPrompt, QUOTE_DRAFT_SYSTEM, QUOTE_PROMPT_SYSTEM, quoteAiContext, validateProposal } from "./quote-ai";

/**
 * The quotation assistant: a first draft from the planning record, and changes asked for in plain
 * words. It only proposes; the estimator accepts what they want and the builder applies it. Prices
 * always come from the catalog, never from the model.
 */
@Injectable()
export class QuotationAiService {
  constructor(private readonly access: WorkspaceAccessService, private readonly ai: AiGatewayService) {}

  async draft(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string) {
    const context = await this.context(actor, workspaceId, caseId, quoteId);
    if (!context.requirements.length && !context.designs.length && !context.measurements.length)
      throw new UnprocessableEntityException("Add requirements, site measurements or designs in Planning first; the draft is built from them.");
    return this.ai.run(actor, workspaceId, { feature: "quotation.draft", system: QUOTE_DRAFT_SYSTEM, prompt: draftPrompt(context), maxTokens: 12000, validate: (value) => validateProposal(value, context, ["add"]) });
  }

  async edit(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string, input: { request?: unknown }) {
    const request = typeof input.request === "string" ? input.request.trim().slice(0, 1000) : "";
    if (!request) throw new UnprocessableEntityException("Say what to change.");
    const context = await this.context(actor, workspaceId, caseId, quoteId);
    return this.ai.run(actor, workspaceId, { feature: "quotation.edit", system: QUOTE_PROMPT_SYSTEM, prompt: editPrompt(context, request), maxTokens: 6000, validate: (value) => validateProposal(value, context, ["add", "update", "move", "remove"]) });
  }

  private context(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string) {
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.edit"], async (client) => {
      const quote = (await client.query<{ status: string; currency: string }>(`SELECT status, currency FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, quoteId])).rows[0];
      if (!quote) throw new NotFoundException("Quote not found.");
      if (quote.status !== "draft") throw new ConflictException("This quote has been sent. Start a new revision to change it.");
      return quoteAiContext(client, workspaceId, caseId, quoteId, quote.currency);
    });
  }
}
