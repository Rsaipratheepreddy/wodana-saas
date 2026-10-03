import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { REFERENCE_MAX_BYTES, type ReferenceUpload } from "../../workspaces/reference-upload";
import { AttachPaymentProofDto, UpdateOpportunityFlowDto } from "./dto/opportunity-flow.dto";
import { OpportunityFlowService } from "./opportunity-flow.service";

@ApiTags("crm-opportunities")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/crm/opportunities/:opportunityId")
export class OpportunityFlowController {
  constructor(private readonly flow: OpportunityFlowService) {}

  @Put("flow")
  update(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string, @Body() input: UpdateOpportunityFlowDto) {
    return this.flow.update(actor, workspaceId, opportunityId, input);
  }

  @Post("payment-proofs")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 4 } }))
  attach(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string, @Body() input: AttachPaymentProofDto, @UploadedFile() file?: ReferenceUpload) {
    return this.flow.attachProof(actor, workspaceId, opportunityId, { version: Number(input.version), kind: input.kind, note: input.note }, file);
  }

  @Get("payment-proofs/:proofId")
  async download(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string, @Param("proofId", ParseUUIDPipe) proofId: string, @Query("preview") preview: string, @Res({ passthrough: true }) response: Response) {
    const file = await this.flow.proofFile(actor, workspaceId, opportunityId, proofId, preview === "1");
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    return new StreamableFile(file.body, { length: file.body.length, type: file.contentType, disposition: `${file.preview || file.contentType.startsWith("image/") || file.contentType === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}` });
  }
}
