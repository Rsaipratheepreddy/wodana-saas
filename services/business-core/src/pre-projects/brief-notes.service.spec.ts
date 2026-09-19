import { describe, expect, it, vi } from 'vitest';
import { assertBriefUpload, BriefService, BRIEF_MAX_BYTES } from './brief.service';
import type { SaveBriefEntryDto } from './brief.dto';
import type { PoolClient } from 'pg';
import type { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import type { CrmEventsService } from '../crm/shared/crm-events.service';
import type { BrandAssetStorageService } from '../workspaces/brand-asset-storage.service';
import type { RequestActor } from '../auth/actor';
import { prepareReferenceUpload } from '../workspaces/reference-upload';

const document = {version:1 as const,content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Oak cabinets',marks:[{type:'bold'}]}]}]}};
const input: SaveBriefEntryDto = {id:'entry',version:3,kind:'requirement',title:'Kitchen storage',roomId:null,note:'Oak cabinets',document,pinned:true,archived:false,category:'General',priority:'preferred',scopeStatus:'included',reviewStatus:'captured',quantity:1,unit:'nos',referenceUrl:'',avoid:'',source:'team',assetIds:[],catalogLinks:[]};
function service() { return new BriefService({} as WorkspaceAccessService, {} as CrmEventsService, {} as BrandAssetStorageService); }
function currentClient(patch: Record<string, unknown> = {}) {
  const query = vi.fn().mockResolvedValue({rowCount:1,rows:[{id:'entry',version:3,note:'Oak cabinets',note_document:document,pinned:true,archived_at:null,...patch}]});
  return {client:{query} as unknown as PoolClient,query};
}
describe('Requirement documents on existing scope records', () => {
  it('accepts the 20 MB upload boundary and rejects empty or larger evidence before storage',()=>{
    const file=(length:number)=>({buffer:{length} as Buffer,originalname:'site.jpg',mimetype:'image/jpeg',size:length});
    expect(()=>assertBriefUpload(file(BRIEF_MAX_BYTES))).not.toThrow();
    expect(()=>assertBriefUpload(file(BRIEF_MAX_BYTES+1))).toThrow('up to 20 MB');
    expect(()=>assertBriefUpload(file(0))).toThrow('up to 20 MB');
  });
  it('inspects and hashes an exact-limit PDF instead of trusting its filename or MIME claim',async()=>{
    const buffer=Buffer.alloc(BRIEF_MAX_BYTES);buffer.write('%PDF-');
    const prepared=await prepareReferenceUpload({buffer,originalname:'site-photo.jpg',mimetype:'image/jpeg',size:buffer.length},{allowVideo:true});
    expect(prepared).toMatchObject({name:'site-photo.jpg',mimeType:'application/pdf'});expect(prepared.digest).toMatch(/^[0-9a-f]{64}$/);
  });
  it('rejects text-only edits from older editors before writing a rich document', async () => {
    const {client,query} = currentClient();
    await expect(service().writeEntry(client,'workspace','case','user',{...input,document:undefined,note:'Plain replacement'})).rejects.toThrow('rich content');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('rejects a mismatched plain-text projection rather than ignoring the edit', async () => {
    const {client,query} = currentClient();
    await expect(service().writeEntry(client,'workspace','case','user',{...input,note:'Plain replacement'})).rejects.toThrow('rich content');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('checks attachment ownership before accepting media blocks', async () => {
    const {client,query} = currentClient();query.mockResolvedValueOnce({rowCount:0,rows:[]}).mockResolvedValueOnce({rowCount:0,rows:[]});
    await expect(service().writeEntry(client,'workspace','case','user',{...input,version:0,assetIds:['foreign-file']})).rejects.toThrow('do not belong');
    expect(query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
  });
  it('recognizes an identical update retry without another revision or event', async () => {
    const {client,query} = currentClient({version:4});
    const saved = {...input,version:4,assets:[],archivedAt:null};
    query.mockResolvedValueOnce({rowCount:1,rows:[{version:4,note:input.note,note_document:document,pinned:true,archived_at:null}]}).mockResolvedValueOnce({rowCount:1,rows:[saved]});
    await expect(service().writeEntry(client,'workspace','case','user',input)).resolves.toEqual(saved);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
  });
  it('rejects conflicting retries and retains the saved requirement', async () => {
    const {client,query} = currentClient({version:4});
    query.mockResolvedValueOnce({rowCount:1,rows:[{version:4,note:input.note,note_document:document,pinned:true,archived_at:null}]}).mockResolvedValueOnce({rowCount:1,rows:[{...input,version:4,quantity:2,assets:[],archivedAt:null}]});
    await expect(service().writeEntry(client,'workspace','case','user',input)).rejects.toThrow('requirement changed');
    expect(query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
  });
  it('requires an explicit restore before editing archived requirements', async () => {
    const {client} = currentClient({archived_at:'2026-09-08'});
    await expect(service().writeEntry(client,'workspace','case','user',{...input,archived:undefined})).rejects.toThrow('Restore');
  });
});

describe('Related Master Data choices', () => {
  it('filters variants by their item inside the authorized workspace', async () => {
    const query = vi.fn().mockResolvedValueOnce({rowCount:1,rows:[{status:'active'}]}).mockResolvedValueOnce({rows:[]});
    const access = {withPermission: (_a:unknown,_w:unknown,_p:unknown,work:(client:unknown)=>unknown) => work({query})};
    const brief = new BriefService(access as WorkspaceAccessService,{} as CrmEventsService,{} as BrandAssetStorageService);
    const item='5c011105-eaf6-426a-9638-58b50d1c10e9';
    await brief.catalogOptions({} as RequestActor,'workspace','case','variant','','work',item);
    expect(query.mock.calls[1][0]).toContain('parent.workspace_id=r.workspace_id');
    expect(query.mock.calls[1][0]).toContain('parent.record_id=r.id');
    expect(query.mock.calls[1][1]).toEqual(['workspace','variant','','work',item]);
  });
  it('rejects invalid relations before querying', () => {
    expect(() => service().catalogOptions({} as RequestActor,'workspace','case','work','','room','invalid')).toThrow('valid room or item');
  });
});
