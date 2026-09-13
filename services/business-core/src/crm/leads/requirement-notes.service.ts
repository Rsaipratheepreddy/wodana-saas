import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, IsUUID, IsUrl, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PoolClient } from 'pg';
import { isDeepStrictEqual } from 'node:util';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { BrandAssetStorageService } from '../../workspaces/brand-asset-storage.service';
import { prepareReferenceUpload, type ReferenceUpload } from '../../workspaces/reference-upload';
import { RequestActor } from '../../auth/actor';
import { WorkspaceAccessService } from '../../workspaces/workspace-access.service';
import { CrmEventsService } from '../shared/crm-events.service';
import { noteDocumentText, validateNoteDocument, type NoteDocument } from './note-document';

import { BriefService } from '../../pre-projects/brief.service';
import { SaveBriefEntryDto } from '../../pre-projects/brief.dto';

export const REQUIREMENT_NOTES_KEY = 'requirement_notes';
export class SaveRequirementNoteDto {
  @IsOptional() @ValidateNested() @Type(() => SaveBriefEntryDto) scope?: SaveBriefEntryDto;
  @IsUUID() id!: string;
  @IsInt() @Min(0) version!: number;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(240) title!: string;
  @IsString() @MaxLength(60000) note!: string;
  @IsBoolean() archived!: boolean;
  @IsOptional() @IsBoolean() pinned?: boolean;
  @IsOptional() @IsObject() document?: NoteDocument;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsUUID('all', { each: true }) assetIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ArrayUnique() @MaxLength(2000, { each: true }) @IsUrl({ protocols: ['http', 'https'], require_protocol: true, disallow_auth: true }, { each: true }) links?: string[];
}
export const REQUIREMENT_ASSET_PREFIX = 'requirement_asset_';
export type NoteAsset = { id: string; name: string; mimeType: string; byteSize: number; hasPreview: boolean };
type StoredAsset = NoteAsset & { noteId: string; digest: string; key: string };
type NoteTarget = { leadId: string } | { caseId: string };
export type RequirementNote = SaveRequirementNoteDto & { updatedAt?: string; updatedByName?: string; caseScopes?: Record<string, string> };

@Injectable()
export class RequirementNotesService {
  constructor(private readonly access: WorkspaceAccessService, private readonly events: CrmEventsService, private readonly storage: BrandAssetStorageService, private readonly brief: BriefService) {}

  private withTarget<T>(actor: RequestActor, workspaceId: string, target: NoteTarget, write: boolean, work: (client: PoolClient, userId: string, leadId: string, lead: { enquiryId: string; summary?: string }, canEdit: boolean) => Promise<T>, emptyResult?: T) {
    const caseTarget = 'caseId' in target;
    const view = caseTarget ? 'pre_projects.view' : 'crm.leads.view';
    const edit = caseTarget ? 'pre_projects.edit' : 'crm.leads.manage';
    const input = write;
    return this.access.withPermissions(actor, workspaceId, write ? [view, edit] : [view], async (client, user) => {
      let leadId: string;
      if (caseTarget) {
        // Lock the case first, as other Brief & Scope edits do. Released cases stay read-only.
        const cases = await client.query(`SELECT c.status,o.lead_id AS "leadId" FROM pre_project_cases c JOIN crm_opportunities o ON o.workspace_id=c.workspace_id AND o.id=c.opportunity_id WHERE c.workspace_id=$1 AND c.id=$2${input ? ' FOR UPDATE OF c' : ''}`, [workspaceId, target.caseId]);
        if (!cases.rowCount) throw new NotFoundException('Pre-execution not found.');
        if (!cases.rows[0].leadId) { if (!write && emptyResult !== undefined) return emptyResult; throw new NotFoundException('This pre-execution has no linked lead.'); }
        if (input && cases.rows[0].status !== 'active') throw new ConflictException('This pre-execution is read-only.');
        leadId = cases.rows[0].leadId;
      } else leadId = target.leadId;
      const leads = await client.query(`SELECT l.id,l.enquiry_id AS "enquiryId",e.summary FROM crm_leads l JOIN crm_enquiries e ON e.workspace_id=l.workspace_id AND e.id=l.enquiry_id WHERE l.workspace_id=$1 AND l.id=$2${input ? ' FOR UPDATE OF l' : ''}`, [workspaceId, leadId]);
      if (!leads.rowCount) throw new NotFoundException('Lead not found.');
      const readonly = await client.query(`SELECT c.id FROM pre_project_cases c JOIN crm_opportunities o ON o.workspace_id=c.workspace_id AND o.id=c.opportunity_id WHERE c.workspace_id=$1 AND o.lead_id=$2 AND c.status<>'active' LIMIT 1`, [workspaceId, leadId]);
      const canEdit = !readonly.rowCount && await this.access.hasPermission(client, workspaceId, user.userId, edit);
      if (input && !canEdit) throw new ConflictException('These notes belong to a released or archived pre-execution and are read-only.');
      return work(client, user.userId, leadId, leads.rows[0], canEdit);
    });
  }

  run(actor: RequestActor, workspaceId: string, target: NoteTarget, input?: SaveRequirementNoteDto) {
    return this.withTarget(actor, workspaceId, target, Boolean(input), async (client, userId, leadId, lead, canEdit) => {
      const items = await this.read(client, workspaceId, leadId, lead);
      const present = async (values: RequirementNote[]) => {
        const notes = await this.withAssets(client, workspaceId, leadId, values);
        return Promise.all(notes.map(async ({ caseScopes, ...n }) => ({ ...n, ...('caseId' in target && caseScopes?.[target.caseId] ? { scope: await this.brief.entry(client,workspaceId,target.caseId,caseScopes[target.caseId]) } : {}) })));
      };
      if (!input) return { items: await present(items), canEdit };
      if (input.scope && !('caseId' in target)) throw new BadRequestException('Room requirements must be saved from their pre-execution.');
      const previous = items.find(item => item.id === input.id);
      const assetIds = input.assetIds ?? previous?.assetIds ?? [];
      const links = input.links ?? previous?.links ?? [];
      const assets = await this.assertAssets(client, workspaceId, leadId, input.id, assetIds);
      if (previous?.document && input.document === undefined && input.note !== previous.note) throw new ConflictException('This note has rich content. Reopen it in the updated editor before saving.');
      const document = input.document !== undefined ? validateNoteDocument(input.document, assets) : previous?.document;
      const note = document ? noteDocumentText(document.content) : input.note;
      const pinned = input.pinned ?? previous?.pinned ?? false;
      const same = JSON.stringify(assetIds) === JSON.stringify(previous?.assetIds ?? []) && JSON.stringify(links) === JSON.stringify(previous?.links ?? []) && isDeepStrictEqual(document, previous?.document) && pinned === Boolean(previous?.pinned) && previous && previous.title === input.title && previous.note === note && previous.archived === input.archived;
      const saveScope = async () => {
        if (!input.scope || !('caseId' in target)) return previous?.caseScopes;
        const linkedId = previous?.caseScopes?.[target.caseId];
        if ((linkedId && linkedId !== input.scope.id) || (!linkedId && input.scope.version !== 0)) throw new BadRequestException('Keep this note linked to its original room requirement.');
        if (items.some(n => n.id !== input.id && n.caseScopes?.[target.caseId] === input.scope!.id)) throw new ConflictException('This room requirement belongs to another note.');
        if (!linkedId) { const existing = await client.query('SELECT id FROM pre_project_brief_entries WHERE workspace_id=$1 AND case_id=$2 AND id=$3',[workspaceId,target.caseId,input.scope.id]); if (existing.rowCount) throw new ConflictException('This room requirement already exists. Open its requirement note instead.'); }
        if (input.scope.kind !== 'requirement') throw new BadRequestException('Choose a room requirement for this note.');
        await this.brief.writeEntry(client,workspaceId,target.caseId,userId,{...input.scope,title:input.title,note,archived:input.archived});
        return {...previous?.caseScopes,[target.caseId]:input.scope.id};
      };
      // A retry after a lost response is safe; stale, different edits never overwrite a newer note.
      if (same && previous.version === input.version + 1) { await saveScope(); return { items: await present(items), canEdit }; }
      if ((previous?.version ?? 0) !== input.version) throw new ConflictException('This note changed. Your draft is kept. Reopen the latest note before saving.');
      if (!previous && input.version) throw new NotFoundException('Requirement note not found.');
      if (!previous && items.length >= 200) throw new BadRequestException('This lead already has 200 requirement notes. Edit an existing note.');
      const caseScopes = await saveScope();
      const { scope: _scope, ...noteInput } = input;
      const name = await client.query('SELECT display_name FROM users WHERE id=$1', [userId]);
      const saved = { ...noteInput, ...(caseScopes ? {caseScopes} : {}), note, ...(document ? { document } : {}), pinned, assetIds, links, version: input.version + 1, updatedAt: new Date().toISOString(), updatedByName: name.rows[0]?.display_name ?? '' };
      const updated = previous ? items.map(item => item.id === saved.id ? saved : item) : [...items, saved];
      await client.query(`INSERT INTO crm_lead_qualification_values(workspace_id,lead_id,question_key,value,captured_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,lead_id,question_key) DO UPDATE SET value=EXCLUDED.value,captured_by=EXCLUDED.captured_by,captured_at=now()`, [workspaceId, leadId, REQUIREMENT_NOTES_KEY, JSON.stringify(updated), userId]);
      await this.events.record(client, { workspaceId, actorUserId: userId, source: 'user', action: 'crm.lead.requirement_note_saved.v1', entityType: 'crm_lead', entityId: leadId, before: previous ? { note: previous } : undefined, after: { note: saved } });
      return { items: await present(updated), canEdit };
    }, !input ? { items: [], canEdit: false } : undefined);
  }

  private async assetRecord(client: PoolClient, workspaceId: string, leadId: string, noteId: string, assetId: string) {
    const result = await client.query('SELECT value FROM crm_lead_qualification_values WHERE workspace_id=$1 AND lead_id=$2 AND question_key=$3', [workspaceId, leadId, REQUIREMENT_ASSET_PREFIX + assetId]);
    const asset = result.rows[0]?.value as StoredAsset | undefined;
    if (!asset || asset.noteId !== noteId) throw new NotFoundException('Reference file not found for this note.');
    return asset;
  }
  private publicAsset(asset: StoredAsset): NoteAsset {
    return { id: asset.id, name: asset.name, mimeType: asset.mimeType, byteSize: asset.byteSize, hasPreview: asset.hasPreview };
  }
  private async assertAssets(client: PoolClient, workspaceId: string, leadId: string, noteId: string, ids: string[]) {
    const assets = new Map<string, StoredAsset>();
    for (const id of ids) assets.set(id, await this.assetRecord(client, workspaceId, leadId, noteId, id));
    return assets;
  }
  private async withAssets(client: PoolClient, workspaceId: string, leadId: string, items: RequirementNote[]) {
    const ids = [...new Set(items.flatMap(n => n.assetIds ?? []))];
    const records = ids.length ? await client.query('SELECT value FROM crm_lead_qualification_values WHERE workspace_id=$1 AND lead_id=$2 AND question_key=ANY($3::text[])', [workspaceId, leadId, ids.map(id => REQUIREMENT_ASSET_PREFIX + id)]) : { rows: [] };
    const assets = new Map<string, StoredAsset>(records.rows.map(r => [r.value.id, r.value]));
    return items.map(n => ({ ...n, links: n.links ?? [], assets: (n.assetIds ?? []).flatMap(id => { const a = assets.get(id); return a && a.noteId === n.id ? [this.publicAsset(a)] : []; }) }));
  }
  upload(actor: RequestActor, workspaceId: string, target: NoteTarget, noteId: string, assetId: string, file?: ReferenceUpload) {
    return this.withTarget(actor, workspaceId, target, true, async (client, userId, leadId, lead) => {
      const notes = await this.read(client, workspaceId, leadId, lead);
      if (notes.find(n => n.id === noteId)?.archived) throw new ConflictException('Restore this note before adding files.');
      const prepared = await prepareReferenceUpload(file, { allowVideo: true });
      const existing = await client.query('SELECT value FROM crm_lead_qualification_values WHERE workspace_id=$1 AND lead_id=$2 AND question_key=$3', [workspaceId, leadId, REQUIREMENT_ASSET_PREFIX + assetId]);
      if (existing.rowCount) {
        const saved = existing.rows[0].value as StoredAsset;
        if (saved.noteId !== noteId || saved.digest !== prepared.digest) throw new ConflictException('This upload ID belongs to another file. Choose the file again.');
        return this.publicAsset(saved);
      }
      const key = ['crm-requirement-notes', workspaceId, leadId, noteId, assetId, prepared.digest].join('/');
      await this.storage.put(key + '/original', prepared.body, prepared.mimeType);
      if (prepared.preview) await this.storage.put(key + '/preview.webp', prepared.preview, 'image/webp');
      const saved: StoredAsset = { id: assetId, noteId, key, digest: prepared.digest, name: prepared.name, mimeType: prepared.mimeType, byteSize: prepared.body.length, hasPreview: Boolean(prepared.preview) };
      await client.query('INSERT INTO crm_lead_qualification_values(workspace_id,lead_id,question_key,value,captured_by) VALUES($1,$2,$3,$4,$5)', [workspaceId, leadId, REQUIREMENT_ASSET_PREFIX + assetId, JSON.stringify(saved), userId]);
      await this.events.record(client, { workspaceId, actorUserId: userId, source: 'user', action: 'crm.lead.requirement_file_uploaded.v1', entityType: 'crm_lead', entityId: leadId, after: { noteId, asset: this.publicAsset(saved) } });
      return this.publicAsset(saved);
    });
  }
  asset(actor: RequestActor, workspaceId: string, target: NoteTarget, noteId: string, assetId: string, preview: boolean) {
    return this.withTarget(actor, workspaceId, target, false, async (client, _userId, leadId) => {
      const asset = await this.assetRecord(client, workspaceId, leadId, noteId, assetId);
      if (preview && !asset.hasPreview) throw new NotFoundException('Preview not available.');
      const stored = await this.storage.read(asset.key + (preview ? '/preview.webp' : '/original')).catch(() => { throw new NotFoundException('This file could not be found in storage.'); });
      return { body: stored.body, contentType: preview ? 'image/webp' : asset.mimeType, name: asset.name, preview };
    });
  }

  private async read(client: PoolClient, workspaceId: string, leadId: string, lead: { enquiryId: string; summary?: string }) {
    const values = await client.query(`SELECT question_key,value FROM crm_lead_qualification_values WHERE workspace_id=$1 AND lead_id=$2 AND question_key IN ('requirements',$3)`, [workspaceId, leadId, REQUIREMENT_NOTES_KEY]);
    const stored = values.rows.find(row => row.question_key === REQUIREMENT_NOTES_KEY);
    if (stored) return stored.value as RequirementNote[];
    const requirements = values.rows.find(row => row.question_key === 'requirements')?.value;
    const items: RequirementNote[] = [];
    if (lead.summary?.trim()) items.push({ id: lead.enquiryId, version: 0, title: 'Enquiry requirements', note: lead.summary, archived: false });
    if (typeof requirements === 'string' && requirements.trim() && requirements.trim() !== lead.summary?.trim()) items.push({ id: leadId, version: 0, title: 'Requirement notes', note: requirements, archived: false });
    return items;
  }
}

@Controller('workspaces/:workspaceId')
export class RequirementNotesController {
  constructor(private readonly notes: RequirementNotesService) {}
  @Get('crm/leads/:leadId/requirement-notes')
  lead(@CurrentActor() a: RequestActor, @Param('workspaceId', ParseUUIDPipe) w: string, @Param('leadId', ParseUUIDPipe) id: string) { return this.notes.run(a,w,{leadId:id}); }
  @Put('crm/leads/:leadId/requirement-notes')
  saveLead(@CurrentActor() a: RequestActor, @Param('workspaceId', ParseUUIDPipe) w: string, @Param('leadId', ParseUUIDPipe) id: string, @Body() input: SaveRequirementNoteDto) { return this.notes.run(a,w,{leadId:id},input); }
  @Get('pre-projects/:caseId/requirement-notes')
  project(@CurrentActor() a: RequestActor, @Param('workspaceId', ParseUUIDPipe) w: string, @Param('caseId', ParseUUIDPipe) id: string) { return this.notes.run(a,w,{caseId:id}); }
  @Put('pre-projects/:caseId/requirement-notes')
  saveProject(@CurrentActor() a: RequestActor, @Param('workspaceId', ParseUUIDPipe) w: string, @Param('caseId', ParseUUIDPipe) id: string, @Body() input: SaveRequirementNoteDto) { return this.notes.run(a,w,{caseId:id},input); }
}
