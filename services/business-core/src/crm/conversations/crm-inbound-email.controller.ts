import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiExcludeController, ApiTags } from "@nestjs/swagger";
import { IsInt, IsUUID, Max, Min } from "class-validator";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { Public } from "../../auth/public.decorator";
import { CrmInboundEmailService } from "./crm-inbound-email.service";
import { ATTACHMENT_MAX_BYTES } from "./inbox/attachment-rules";

export class SetInboundEmailAddressDto {
  @IsInt() @Min(0) @Max(1_000_000) version!: number;
  @IsUUID() commandId!: string;
}

@ApiTags("crm-inbox") @ApiBearerAuth()
@Controller("workspaces/:workspaceId/crm/inbox/email-address")
export class CrmInboundEmailAddressController {
  constructor(private readonly inbound: CrmInboundEmailService) {}
  @Get() address(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.inbound.address(actor, workspaceId); }
  /** Make the address, or replace it with a new one. */
  @Post() set(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: SetInboundEmailAddressDto) { return this.inbound.setAddress(actor, workspaceId, input); }
}

/**
 * Mailgun Routes post each received email here (`forward("https://<host>/api/v1/inbound/email/mailgun")`). No
 * session: the request proves itself with Mailgun's signature. The body is Mailgun's form (fields, and the files as
 * attachment-1…n), so it is read as is rather than through a DTO; the service validates every field it uses.
 */
@ApiExcludeController() @Public()
@Controller("inbound/email")
export class InboundEmailWebhookController {
  constructor(private readonly inbound: CrmInboundEmailService) {}
  @Post("mailgun") @HttpCode(200)
  // A file over our limit is still received (and listed as not kept) rather than failing the whole email.
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: ATTACHMENT_MAX_BYTES + 6 * 1024 * 1024, files: 50, fieldSize: 8 * 1024 * 1024, fields: 200 } }))
  mailgun(@Body() body: Record<string, unknown>, @UploadedFiles() files?: Array<{ fieldname?: string; originalname?: string; mimetype?: string; buffer?: Buffer }>) {
    return this.inbound.receiveMailgun(body, files ?? []);
  }
}
