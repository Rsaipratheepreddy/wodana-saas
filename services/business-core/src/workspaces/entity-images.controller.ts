import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, PayloadTooLargeException, Post, Req, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeController, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { Public } from "../auth/public.decorator";
import { COMPANY_LOGO_MAX_BYTES } from "./dto/company-logo.dto";
import { EntityImagesService } from "./entity-images.service";

/** A business's logo and letterhead header (PLM-112). Bodies are validated in the service. */
@ApiTags("workspaces")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/legal-entities/:entityId/images/:kind")
export class EntityImagesController {
  constructor(private readonly images: EntityImagesService) {}

  @Post("uploads")
  start(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("entityId", ParseUUIDPipe) entityId: string,
    @Param("kind") kind: string, @Body() body: Record<string, unknown>) {
    return this.images.start(actor, workspaceId, entityId, kind, body ?? {});
  }

  @Post("uploads/:assetId/content")
  async content(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("entityId", ParseUUIDPipe) entityId: string,
    @Param("kind") kind: string, @Param("assetId", ParseUUIDPipe) assetId: string, @Req() request: Request) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > COMPANY_LOGO_MAX_BYTES) throw new PayloadTooLargeException("The image must be 5 MB or smaller.");
      chunks.push(buffer);
    }
    return this.images.content(actor, workspaceId, entityId, kind, assetId, String(request.headers["content-type"] ?? "").split(";")[0], Buffer.concat(chunks));
  }

  @Post("uploads/:assetId/complete")
  complete(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("entityId", ParseUUIDPipe) entityId: string,
    @Param("kind") kind: string, @Param("assetId", ParseUUIDPipe) assetId: string) {
    return this.images.complete(actor, workspaceId, entityId, kind, assetId);
  }

  @Delete()
  remove(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("entityId", ParseUUIDPipe) entityId: string, @Param("kind") kind: string) {
    return this.images.remove(actor, workspaceId, entityId, kind);
  }
}

/** What a business's documents print: its letterhead (PLM-112). */
@ApiTags("workspaces")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/legal-entities/:entityId/letterhead")
export class EntityLetterheadController {
  constructor(private readonly images: EntityImagesService) {}

  @Get()
  letterhead(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("entityId", ParseUUIDPipe) entityId: string) {
    return this.images.letterhead(actor, workspaceId, entityId);
  }
}

/** The image as documents print it (staff and client portal alike), like the public workspace logo. */
@ApiExcludeController()
@Public()
@Controller("public/entity-images")
export class PublicEntityImagesController {
  constructor(private readonly images: EntityImagesService) {}

  @Get(":workspaceId/:assetId")
  @Header("Cross-Origin-Resource-Policy", "cross-origin")
  async image(@Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("assetId", ParseUUIDPipe) assetId: string, @Res() response: Response) {
    const image = await this.images.read(workspaceId, assetId);
    response.set({ "cache-control": "public, max-age=3600, stale-while-revalidate=86400", "content-type": image.contentType, etag: `"${image.etag}"` });
    response.send(image.body);
  }
}
