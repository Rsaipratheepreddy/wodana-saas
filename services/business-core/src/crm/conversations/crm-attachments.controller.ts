import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { IsUUID } from "class-validator";
import { ApiBearerAuth, ApiExcludeController, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { InternalServiceGuard } from "../../auth/internal-service.guard";
import { Public } from "../../auth/public.decorator";
import type { ReferenceUpload } from "../../workspaces/reference-upload";
import { noteMediaRange } from "../leads/requirement-note-assets.controller";
import { CrmAttachmentsService } from "./crm-attachments.service";
import { AttachmentFetchFailedDto, ClaimAttachmentFetchesDto } from "./dto/conversations.dto";
import { ATTACHMENT_MAX_BYTES } from "./inbox/attachment-rules";

type StoredFile = { body: Buffer; contentType: string; inline: boolean; name: string };

/** Sends a stored file privately: never cached, sandboxed, inline only for images, audio and video (with ranges for players). */
function send(file: StoredFile, response: Response, range?: string) {
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  const media = /^(audio|video)\//.test(file.contentType);
  if (media) response.setHeader("Accept-Ranges", "bytes");
  const requested = media && range ? noteMediaRange(range, file.body.length) : undefined;
  if (requested === null) { response.status(416); response.setHeader("Content-Range", `bytes */${file.body.length}`); return new StreamableFile(Buffer.alloc(0)); }
  const body = requested ? file.body.subarray(requested.start, requested.end + 1) : file.body;
  if (requested) { response.status(206); response.setHeader("Content-Range", `bytes ${requested.start}-${requested.end}/${file.body.length}`); }
  return new StreamableFile(body, { length: body.length, type: file.contentType, disposition: `${file.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}` });
}

class SaveAttachmentToCaseDto {
  @IsUUID() caseId!: string;
  @IsUUID() fileId!: string;
}

@ApiTags("crm-inbox") @ApiBearerAuth()
@Controller("workspaces/:workspaceId/crm/conversations/:conversationId/save-targets")
export class CrmAttachmentTargetsController {
  constructor(private readonly attachments: CrmAttachmentsService) {}
  @Get() targets(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("conversationId", ParseUUIDPipe) conversationId: string) {
    return this.attachments.saveTargets(actor, workspaceId, conversationId);
  }
}

@ApiTags("crm-inbox") @ApiBearerAuth()
@Controller("workspaces/:workspaceId/crm/conversations/:conversationId/attachments/:attachmentId")
export class CrmAttachmentsController {
  constructor(private readonly attachments: CrmAttachmentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1, fields: 0 } }))
  upload(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("conversationId", ParseUUIDPipe) conversationId: string,
    @Param("attachmentId", ParseUUIDPipe) attachmentId: string, @UploadedFile() file?: ReferenceUpload) {
    return this.attachments.upload(actor, workspaceId, conversationId, attachmentId, file);
  }

  /** Save to project (IN-18): file this chat file into one of the client's cases. */
  @Post("save")
  save(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("conversationId", ParseUUIDPipe) conversationId: string,
    @Param("attachmentId", ParseUUIDPipe) attachmentId: string, @Body() input: SaveAttachmentToCaseDto) {
    return this.attachments.saveToCase(actor, workspaceId, conversationId, attachmentId, input);
  }

  @Get()
  async content(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("conversationId", ParseUUIDPipe) conversationId: string,
    @Param("attachmentId", ParseUUIDPipe) attachmentId: string, @Res({ passthrough: true }) response: Response, @Headers("range") range?: string) {
    return send(await this.attachments.content(actor, workspaceId, conversationId, attachmentId), response, range);
  }
}

@ApiExcludeController() @Public() @UseGuards(InternalServiceGuard)
@Controller("internal/crm/workspaces/:workspaceId/attachments")
export class InternalCrmAttachmentsController {
  constructor(private readonly attachments: CrmAttachmentsService) {}

  @Post("due") due(@Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: ClaimAttachmentFetchesDto) { return this.attachments.claimFetchesInternal(workspaceId, input.limit); }

  @Put(":attachmentId/content")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1, fields: 0 } }))
  store(@Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("attachmentId", ParseUUIDPipe) attachmentId: string, @UploadedFile() file?: ReferenceUpload) {
    return this.attachments.storeFetchedInternal(workspaceId, attachmentId, file);
  }

  @Post(":attachmentId/failed") failed(@Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("attachmentId", ParseUUIDPipe) attachmentId: string, @Body() input: AttachmentFetchFailedDto) {
    return this.attachments.failedFetchInternal(workspaceId, attachmentId, input);
  }

  @Get(":attachmentId/content")
  async content(@Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("attachmentId", ParseUUIDPipe) attachmentId: string, @Res({ passthrough: true }) response: Response) {
    return send(await this.attachments.outboundContentInternal(workspaceId, attachmentId), response);
  }
}
