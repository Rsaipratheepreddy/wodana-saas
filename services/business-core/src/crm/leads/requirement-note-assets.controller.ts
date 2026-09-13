import { BadRequestException, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { RequestActor } from '../../auth/actor';
import { REFERENCE_MAX_BYTES, type ReferenceUpload } from '../../workspaces/reference-upload';
import { RequirementNotesService } from './requirement-notes.service';

@Controller('workspaces/:workspaceId/requirement-notes/:kind/:targetId/:noteId/assets/:assetId')
export class RequirementNoteAssetsController {
  constructor(private readonly notes: RequirementNotesService) {}

  private target(kind: string, id: string) {
    if (kind === 'lead') return { leadId: id };
    if (kind === 'case') return { caseId: id };
    throw new BadRequestException('Invalid requirement note target.');
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 0 } }))
  upload(@CurrentActor() actor: RequestActor, @Param('workspaceId', ParseUUIDPipe) workspace: string, @Param('kind') kind: string, @Param('targetId', ParseUUIDPipe) target: string, @Param('noteId', ParseUUIDPipe) note: string, @Param('assetId', ParseUUIDPipe) asset: string, @UploadedFile() file?: ReferenceUpload) {
    return this.notes.upload(actor, workspace, this.target(kind, target), note, asset, file);
  }

  @Get()
  async download(@CurrentActor() actor: RequestActor, @Param('workspaceId', ParseUUIDPipe) workspace: string, @Param('kind') kind: string, @Param('targetId', ParseUUIDPipe) target: string, @Param('noteId', ParseUUIDPipe) note: string, @Param('assetId', ParseUUIDPipe) asset: string, @Query('preview') preview: string, @Res({ passthrough: true }) response: Response, @Headers('range') range?: string) {
    const file = await this.notes.asset(actor, workspace, this.target(kind, target), note, asset, preview === '1');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    const video = file.contentType.startsWith('video/');
    if (video) response.setHeader('Accept-Ranges', 'bytes');
    const requested = video && range ? noteMediaRange(range, file.body.length) : undefined;
    if (requested === null) { response.status(416); response.setHeader('Content-Range', `bytes */${file.body.length}`); return new StreamableFile(Buffer.alloc(0)); }
    const body = requested ? file.body.subarray(requested.start, requested.end + 1) : file.body;
    if (requested) { response.status(206); response.setHeader('Content-Range', `bytes ${requested.start}-${requested.end}/${file.body.length}`); }
    return new StreamableFile(body, { length: body.length, type: file.contentType, disposition: `${file.preview || video ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}` });
  }
}

export function noteMediaRange(range: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < size && end >= start ? { start, end } : null;
}
