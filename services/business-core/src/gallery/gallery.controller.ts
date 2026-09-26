import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { Public } from "../auth/public.decorator";
import { REFERENCE_MAX_BYTES, type ReferenceUpload } from "../workspaces/reference-upload";
import { GalleryService } from "./gallery.service";

/** The firm edits its gallery here. Bodies are validated in the service. */
@ApiTags("gallery")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/gallery")
export class GalleryController {
  constructor(private readonly gallery: GalleryService) {}

  @Get()
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.gallery.get(actor, workspaceId); }

  @Put()
  save(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) { return this.gallery.saveSettings(actor, workspaceId, input ?? {}); }

  @Get("catalog")
  catalog(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query("q") query = "") { return this.gallery.catalogChoices(actor, workspaceId, String(query)); }

  @Post("items")
  saveItem(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: Record<string, unknown>) { return this.gallery.saveItem(actor, workspaceId, input ?? {}); }

  @Post("items/order")
  reorder(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: { kind?: unknown; ids?: unknown }) { return this.gallery.reorder(actor, workspaceId, input ?? {}); }

  @Post("items/from-catalog")
  importCatalog(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: { itemIds?: unknown }) { return this.gallery.importCatalog(actor, workspaceId, input ?? {}); }

  @Delete("items/:itemId")
  removeItem(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("itemId", ParseUUIDPipe) itemId: string) { return this.gallery.removeItem(actor, workspaceId, itemId); }

  @Post("images/:imageId")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 1 } }))
  upload(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("imageId", ParseUUIDPipe) imageId: string, @Query("itemId") itemId: string | undefined, @UploadedFile() file: ReferenceUpload) {
    return this.gallery.uploadImage(actor, workspaceId, imageId, itemId && /^[0-9a-f-]{36}$/i.test(itemId) ? itemId : null, file);
  }

  @Delete("images/:imageId")
  removeImage(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("imageId", ParseUUIDPipe) imageId: string) { return this.gallery.removeImage(actor, workspaceId, imageId); }

  @Get("images/:imageId")
  async image(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("imageId", ParseUUIDPipe) imageId: string, @Query("preview") preview: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.gallery.ownerImage(actor, workspaceId, imageId, preview === "1");
    response.setHeader("Cache-Control", "private, max-age=300");
    return sendMedia(file, request, response);
  }
}

/** The published gallery by its link: no sign-in. */
@ApiTags("gallery-public")
@Public()
@Controller("public/gallery/:slug")
export class PublicGalleryController {
  constructor(private readonly gallery: GalleryService) {}

  @Get()
  get(@Param("slug") slug: string) { return this.gallery.publicGallery(slug); }

  @Get("images/:imageId")
  async image(@Param("slug") slug: string, @Param("imageId") imageId: string, @Query("preview") preview: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const file = await this.gallery.publicImage(slug, imageId, preview === "1");
    response.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    return sendMedia(file, request, response);
  }

  @Post("enquiries")
  enquire(@Param("slug") slug: string, @Body() input: Record<string, unknown>) { return this.gallery.publicEnquiry(slug, input ?? {}); }
}

/** A picture or a video; videos answer byte ranges so they can play and seek on every browser. */
export function sendMedia(file: { body: Buffer | Uint8Array; contentType: string }, request: Request, response: Response) {
  const body = Buffer.isBuffer(file.body) ? file.body : Buffer.from(file.body);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Accept-Ranges", "bytes");
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range ?? ""));
  if (range && (range[1] || range[2])) {
    const size = body.length;
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    if (start >= size || start > end) { response.status(416); response.setHeader("Content-Range", `bytes */${size}`); return new StreamableFile(Buffer.alloc(0), { type: file.contentType }); }
    end = Math.min(end, size - 1); start = Math.max(0, start);
    response.status(206);
    response.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    return new StreamableFile(body.subarray(start, end + 1), { type: file.contentType, disposition: "inline", length: end - start + 1 });
  }
  return new StreamableFile(body, { type: file.contentType, disposition: "inline", length: body.length });
}
