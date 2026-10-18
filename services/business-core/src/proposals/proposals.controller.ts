import { BadRequestException, Body, Controller, Get, Headers, Injectable, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { Public } from "../auth/public.decorator";
import { readSettings } from "../quotation/quotation-builder.service";
import { TaxNumberingService } from "../workspaces/tax-numbering.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { EsignService } from "./esign.service";
import { introFacts, introPagePdf } from "./intro-deck";
import { clientPresentation, taxLabel } from "./proposal-data";
import { ProposalDocumentsService } from "./proposal-documents.service";
import { ProposalPrintService } from "./proposal-print.service";
import { MAX_FILE_BYTES, type UploadedFile as Upload } from "./proposal-files";
import { QsReviewService } from "./qs-review.service";

const QUOTE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const upload = FileInterceptor("file", { limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 12 } });

function pdf(response: Response, file: { body: Buffer; contentType: string; name: string }, inline = true) {
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  return new StreamableFile(file.body, { type: file.contentType, disposition: `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}` });
}

function quoteId(value: string) {
  if (!QUOTE_ID.test(value)) throw new BadRequestException("Quote id is invalid.");
  return value;
}

/**
 * Quotation numbering in Sales settings (second client's #13): each active legal entity's QUOTATION sequence with
 * the next number it will give, read through the same service Finance uses (so both screens show one truth).
 */
@Injectable()
export class QuotationNumberingService {
  constructor(private readonly access: WorkspaceAccessService, private readonly numbering: TaxNumberingService) {}
  list(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["legal_entities.view", "finance.settings.manage", "workspace.settings.manage"], async (client, user) => {
      const entities = (await client.query<{ id: string; code: string; name: string }>(
        `SELECT id, code, display_name AS name FROM legal_entities WHERE workspace_id = $1 AND status = 'active' ORDER BY created_at`, [workspaceId])).rows;
      return {
        canManage: await this.access.hasPermission(client, workspaceId, user.userId, "finance.settings.manage"),
        entities: entities.map((entity) => ({ ...entity })),
      };
    }).then(async (result) => ({
      ...result,
      entities: await Promise.all(result.entities.map(async (entity) => ({
        ...entity, quotation: (await this.numbering.get(actor, workspaceId, entity.id)).numbering.find((row) => row.documentType === "QUOTATION") ?? null,
      }))),
    }));
  }
}

/** PLM-106: the firm's intro deck link and the opportunity's filled-in page 3. */
@Injectable()
export class IntroDeckService {
  constructor(private readonly access: WorkspaceAccessService) {}
  link(actor: RequestActor, workspaceId: string, opportunityId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.view", async (client) => {
      await introFacts(client, workspaceId, opportunityId);
      return { url: (await readSettings(client, workspaceId)).introDeckUrl };
    });
  }
  page(actor: RequestActor, workspaceId: string, opportunityId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.view", async (client) => {
      const facts = await introFacts(client, workspaceId, opportunityId);
      return { body: Buffer.from(await introPagePdf(facts)), contentType: "application/pdf", name: `${facts.clientName} - About your project.pdf` };
    });
  }
  /** The quote as the client reads it (R3), for the builder's client view. */
  clientView(actor: RequestActor, workspaceId: string, caseId: string, quote: string) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client) => {
      const { presentation, snapshot } = await clientPresentation(client, workspaceId, caseId, quote);
      return { presentation, currency: snapshot.quote.currency, decimals: snapshot.decimals, taxLabel: await taxLabel(client, workspaceId, caseId) };
    });
  }
}

/** Proposals (PLM-085), quotation documents and numbering, the QS hand-off (PLM-082/084), e-sign (R8) and the intro deck (PLM-106). */
@ApiTags("proposals")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/proposals")
export class ProposalsController {
  constructor(private readonly documents: ProposalDocumentsService, private readonly esign: EsignService, private readonly qs: QsReviewService, private readonly intro: IntroDeckService,
    private readonly numbering: QuotationNumberingService) {}

  @Get("numbering")
  quotationNumbering(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.numbering.list(actor, workspaceId); }

  @Get("template")
  template(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.documents.template(actor, workspaceId); }

  @Put("template/pages/:slot") @UseInterceptors(upload)
  setPage(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("slot") slot: string, @Body() body: { version?: string }, @UploadedFile() file?: Upload) {
    return this.documents.setTemplatePage(actor, workspaceId, slot, body ?? {}, file);
  }

  @Post("template/pages/:slot/remove")
  removePage(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("slot") slot: string, @Body() body: { version?: unknown }) {
    return this.documents.removeTemplatePage(actor, workspaceId, slot, body ?? {});
  }

  @Get("template/pages/:slot/file")
  async pageFile(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("slot") slot: string, @Res({ passthrough: true }) response: Response) {
    return pdf(response, await this.documents.templatePageFile(actor, workspaceId, slot));
  }

  @Get("cases/:caseId/documents")
  caseDocuments(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string) {
    return this.documents.documents(actor, workspaceId, caseId);
  }

  @Post("cases/:caseId/documents/external") @UseInterceptors(upload)
  external(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Body() body: Record<string, unknown>, @UploadedFile() file?: Upload) {
    return this.documents.uploadExternal(actor, workspaceId, caseId, body ?? {}, file);
  }

  @Post("cases/:caseId/documents/:documentId/versions") @UseInterceptors(upload)
  addVersion(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("documentId", ParseUUIDPipe) documentId: string, @Body() body: Record<string, unknown>, @UploadedFile() file?: Upload) {
    return this.documents.addVersion(actor, workspaceId, caseId, documentId, body ?? {}, file);
  }

  @Get("cases/:caseId/documents/:documentId/versions/:number/file")
  async versionFile(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("documentId", ParseUUIDPipe) documentId: string, @Param("number") number: string, @Query("download") download: string, @Res({ passthrough: true }) response: Response) {
    return pdf(response, await this.documents.file(actor, workspaceId, caseId, documentId, number), download !== "1");
  }

  @Get("cases/:caseId/quotes/:quoteId/proposal.pdf")
  async preview(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("quoteId") quote: string, @Res({ passthrough: true }) response: Response) {
    return pdf(response, await this.documents.preview(actor, workspaceId, caseId, quoteId(quote)));
  }

  @Post("cases/:caseId/quotes/:quoteId/proposal")
  issue(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("quoteId") quote: string) {
    return this.documents.issue(actor, workspaceId, caseId, quoteId(quote));
  }

  @Get("cases/:caseId/quotes/:quoteId/client-view")
  clientView(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("quoteId") quote: string) {
    return this.intro.clientView(actor, workspaceId, caseId, quoteId(quote));
  }

  @Post("cases/:caseId/quotes/:quoteId/signature")
  requestSignature(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("quoteId") quote: string, @Body() body: { commandId?: unknown }) {
    return this.esign.request(actor, workspaceId, caseId, quoteId(quote), body ?? {});
  }

  @Post("cases/:caseId/signatures/:requestId/revoke")
  revokeSignature(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string, @Body() body: { version?: unknown }) {
    return this.esign.revoke(actor, workspaceId, caseId, requestId, body ?? {});
  }

  @Get("cases/:caseId/quotes/:quoteId/qs")
  qsState(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("quoteId") quote: string) {
    return this.qs.state(actor, workspaceId, caseId, quoteId(quote));
  }

  @Post("cases/:caseId/quotes/:quoteId/qs/send")
  qsSend(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("quoteId") quote: string, @Body() body: { assigneeUserId?: unknown; note?: unknown }) {
    return this.qs.send(actor, workspaceId, caseId, quoteId(quote), body ?? {});
  }

  @Post("cases/:caseId/quotes/:quoteId/qs/decide")
  qsDecide(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("quoteId") quote: string, @Body() body: { decision?: unknown; note?: unknown; version?: unknown; commandId?: unknown }) {
    return this.qs.decide(actor, workspaceId, caseId, quoteId(quote), body ?? {});
  }

  @Get("opportunities/:opportunityId/intro-deck")
  introDeck(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string) {
    return this.intro.link(actor, workspaceId, opportunityId);
  }

  @Get("opportunities/:opportunityId/intro-page.pdf")
  async introPage(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string,
    @Res({ passthrough: true }) response: Response) {
    return pdf(response, await this.intro.page(actor, workspaceId, opportunityId), false);
  }
}

/** The portal print page's data for a print link (the link is the key; three minutes, one quotation snapshot). */
@Public()
@ApiTags("proposals")
@Controller("print")
export class ProposalPrintController {
  constructor(private readonly print: ProposalPrintService) {}

  @Get("proposals/:token")
  view(@Param("token") token: string) { return this.print.view(token); }
}

/** The signing page's API: no account, the link's token is the key (R8). */
@Public()
@ApiTags("esign")
@Controller("esign")
export class EsignController {
  constructor(private readonly esign: EsignService) {}

  @Get(":token")
  view(@Param("token") token: string) { return this.esign.view(token); }

  @Get(":token/document")
  async document(@Param("token") token: string, @Query("copy") copy: string, @Res({ passthrough: true }) response: Response) {
    return pdf(response, await this.esign.document(token, copy === "signed"), copy !== "signed");
  }

  @Post(":token/code")
  sendCode(@Param("token") token: string, @Body() body: unknown) { return this.esign.sendCode(token, body && typeof body === "object" ? body as Record<string, unknown> : {}); }

  @Post(":token/code/verify")
  verifyCode(@Param("token") token: string, @Body() body: unknown) { return this.esign.verifyCode(token, body && typeof body === "object" ? body as Record<string, unknown> : {}); }

  @Post(":token/sign")
  sign(@Param("token") token: string, @Body() body: unknown, @Headers("x-signer-ip") ip?: string, @Headers("x-signer-agent") agent?: string, @Headers("user-agent") userAgent?: string) {
    return this.esign.sign(token, body && typeof body === "object" ? body as Record<string, unknown> : {}, { ip, userAgent: agent || userAgent });
  }
}
