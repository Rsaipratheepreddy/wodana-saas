import { startInspirationTimer } from "../design/design-journey.store";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import { noteDocumentText, validateNoteDocument } from "../crm/leads/note-document";
import { createHash } from "node:crypto";
import { PoolClient } from "pg";
import { prepareReferenceUpload } from "../workspaces/reference-upload";
import { RequestActor } from "../auth/actor";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { ArchiveBriefEntryDto, MoodboardPinDto, SaveBriefDto, SaveBriefEntryDto, SaveRoomDto } from "./brief.dto";
import { syncOneTreeFromCase } from "../jobs/one-tree.store";
import { discoveryCoverage } from "./discovery-coverage";

export const BRIEF_MAX_BYTES = 20 * 1024 * 1024;
export function assertBriefUpload(file?:BriefUpload): asserts file is BriefUpload {
  if (!file?.buffer?.length || file.buffer.length > BRIEF_MAX_BYTES) throw new BadRequestException("Choose an image or PDF up to 20 MB.");
}
export const emptyBrief = { goals: "", propertyType: "", location: "", area: "", budget: "", timeline: "", decisionMakers: "", people: "", preferences: "", retainedItems: "", exclusions: "", constraints: "" };
export function qualificationHandoffValues(evidence: unknown): Record<string, string> | null {
  if (!evidence || typeof evidence !== "object" || !Array.isArray((evidence as { answers?: unknown }).answers)) return null;
  const entries = (evidence as { answers: unknown[] }).answers.flatMap((item): Array<[string, string]> => {
    if (!item || typeof item !== "object") return [];
    const { questionKey, value } = item as { questionKey?: unknown; value?: unknown };
    if (typeof questionKey !== "string" || !questionKey.trim() || value === null || value === undefined) return [];
    if (typeof value === "string") return [[questionKey, value]];
    if (typeof value === "number" || typeof value === "boolean") return [[questionKey, String(value)]];
    if (Array.isArray(value) && value.every(entry => typeof entry === "string")) return [[questionKey, value.join(", ")]];
    return [];
  });
  return Object.fromEntries(entries);
}
type CatalogSnapshot={catalogName:string;id:string;name:string;kind:string;code:string;version:number;catalogId:string;configuration:Record<string,unknown>|null;commerce?:{pricingMode:"unpriced"|"fixed"|"on_request"}};
type Context = { status: string; description: string | null; amount: string | null; currencyCode: string | null; leadId: string | null; qualificationEvidence: unknown };
type BriefUpload = { buffer: Buffer; originalname: string; mimetype: string; size: number };
const entrySelect = `SELECT (SELECT content || jsonb_build_object('version',s.version,'createdAt',s.created_at,'designRefs',COALESCE((SELECT jsonb_agg(ref || jsonb_build_object('currentStatus',v.status)) FROM jsonb_array_elements(s.content->'designRefs') ref JOIN pre_project_design_versions v ON v.workspace_id=s.workspace_id AND v.case_id=s.case_id AND v.id=(ref->>'versionId')::uuid),'[]'::jsonb)) FROM pre_project_item_specifications s WHERE s.workspace_id=e.workspace_id AND s.case_id=e.case_id AND s.entry_id=e.id ORDER BY s.version DESC LIMIT 1) AS specification,e.id,e.kind,e.title,e.note,e.note_document AS document,e.pinned,e.category,e.priority,e.source,e.version,
  e.room_id AS "roomId",r.name AS "roomName",e.scope_status AS "scopeStatus",e.scope_note AS "scopeNote",e.review_status AS "reviewStatus",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('role',l.role,'recordId',l.record_id,'snapshot',l.snapshot)) FROM pre_project_scope_links l WHERE l.workspace_id=e.workspace_id AND l.entry_id=e.id),'[]'::jsonb) AS "catalogLinks",
  e.quantity::float AS quantity,e.unit,e.reference_url AS "referenceUrl",e.avoid,
  COALESCE((SELECT jsonb_agg(rl.requirement_id ORDER BY rl.created_at) FROM pre_project_entry_requirement_links rl WHERE rl.workspace_id=e.workspace_id AND rl.entry_id=e.id),'[]'::jsonb) AS "requirementIds",
  (SELECT jsonb_build_object('x',mp.x,'y',mp.y,'width',mp.width,'z',mp.z,'sentiment',mp.sentiment) FROM pre_project_moodboard_pins mp WHERE mp.workspace_id=e.workspace_id AND mp.entry_id=e.id) AS board,
  e.created_at AS "createdAt",e.updated_at AS "updatedAt",e.archived_at AS "archivedAt",
  u.display_name AS "createdByName",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.original_name,'mimeType',a.mime_type,'byteSize',a.byte_size,'hasPreview',a.preview_key IS NOT NULL) ORDER BY a.created_at,a.id)
    FROM pre_project_entry_assets l JOIN pre_project_brief_assets a ON a.id=l.asset_id AND a.workspace_id=l.workspace_id AND a.case_id=l.case_id
    WHERE l.entry_id=e.id AND l.workspace_id=e.workspace_id AND l.case_id=e.case_id),'[]'::jsonb) AS assets
  FROM pre_project_brief_entries e LEFT JOIN pre_project_rooms r ON r.id=e.room_id AND r.workspace_id=e.workspace_id AND r.case_id=e.case_id
  JOIN users u ON u.id=e.created_by`;

@Injectable()
export class BriefService {
  constructor(private readonly access: WorkspaceAccessService, private readonly events: CrmEventsService, private readonly storage: BrandAssetStorageService) {}

  get(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client, user) => {
      const context = await this.case(client, workspaceId, caseId);
      const saved = await client.query(`SELECT content,version,updated_at AS "updatedAt" FROM pre_project_briefs WHERE workspace_id=$1 AND case_id=$2`, [workspaceId, caseId]);
      const frozenValues = qualificationHandoffValues(context.qualificationEvidence);
      const qualification = frozenValues === null && context.leadId ? await client.query(`SELECT question_key,value FROM crm_lead_qualification_values WHERE workspace_id=$1 AND lead_id=$2`, [workspaceId, context.leadId]) : { rows: [] };
      const values = frozenValues ?? Object.fromEntries(qualification.rows.filter(row => typeof row.value === "string").map(row => [row.question_key, row.value]));
      const defaults = {
        ...emptyBrief,
        goals: values.requirements || context.description || "",
        propertyType: values.property_type || "",
        budget: values.budget || "",
        timeline: values.timeline || "",
        location: values.location || "",
        decisionMakers: values.decision_maker || "",
        preferences: values.preferences || "",
        currencyCode: context.currencyCode,
        budgetAmount: "",
      };
      const rooms = await client.query(`SELECT id,name,version,catalog_record_id AS "catalogRecordId",catalog_snapshot AS "catalogSnapshot" FROM pre_project_rooms WHERE workspace_id=$1 AND case_id=$2 ORDER BY created_at,id`, [workspaceId, caseId]);
      const entries = await client.query(`${entrySelect} WHERE e.workspace_id=$1 AND e.case_id=$2 ORDER BY e.created_at DESC,e.id DESC`, [workspaceId, caseId]);
      const measurements = await client.query(`SELECT entry_id AS "entryId",status FROM pre_project_site_records WHERE workspace_id=$1 AND case_id=$2 AND kind='measurement' AND entry_id IS NOT NULL`, [workspaceId, caseId]);
      return { caseId, workspaceId, brief: { ...defaults, ...saved.rows[0]?.content, version: saved.rows[0]?.version ?? 0, updatedAt: saved.rows[0]?.updatedAt ?? null }, rooms: rooms.rows, entries: entries.rows,
        coverage: discoveryCoverage(rooms.rows, entries.rows, measurements.rows),
        canEdit: await this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.edit"), caseStatus: context.status,
        fromCrm: !saved.rowCount, crmContext: { description: context.description, opportunityAmount: context.amount, currencyCode: context.currencyCode } };
    });
  }

  saveBrief(actor: RequestActor, workspaceId: string, caseId: string, input: SaveBriefDto) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      const current = await client.query(`SELECT content,version FROM pre_project_briefs WHERE workspace_id=$1 AND case_id=$2`, [workspaceId, caseId]);
      this.version(current.rows[0]?.version ?? 0, input.version);
      const context=await this.case(client,workspaceId,caseId);
      const currencyCode=input.currencyCode||current.rows[0]?.content?.currencyCode||context.currencyCode;
      if(!currencyCode || !Intl.supportedValuesOf('currency').includes(currencyCode)) throw new BadRequestException('Choose a supported currency.');
      const budgetAmount=input.budgetAmount??current.rows[0]?.content?.budgetAmount??'';
      if(budgetAmount!=='') {
        const precision=new Intl.NumberFormat('en',{style:'currency',currency:currencyCode}).resolvedOptions().maximumFractionDigits??2;
        if(!/^\d{1,12}(\.\d+)?$/.test(budgetAmount)||(budgetAmount.split('.')[1]?.length??0)>precision) throw new BadRequestException(`Enter a positive budget in ${currencyCode}, with at most ${precision} decimal places.`);
      }
      const { version, ...fields } = input;
      const content={...fields,currencyCode,budgetAmount};
      const result = await client.query(`INSERT INTO pre_project_briefs(case_id,workspace_id,content,updated_by) VALUES($1,$2,$3,$4)
        ON CONFLICT(case_id) DO UPDATE SET content=$3,version=pre_project_briefs.version+1,updated_by=$4,updated_at=now()
        RETURNING content,version,updated_at AS "updatedAt"`, [caseId, workspaceId, content, userId]);
      await this.event(client, workspaceId, caseId, userId, "brief_saved", caseId, current.rows[0]?.content, content);
      await syncOneTreeFromCase(client, workspaceId, caseId, userId);
      return { ...result.rows[0].content, version: result.rows[0].version, updatedAt: result.rows[0].updatedAt };
    });
  }

  saveRoom(actor: RequestActor, workspaceId: string, caseId: string, input: SaveRoomDto) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      const current = await client.query(`SELECT id,name,version,catalog_record_id AS "catalogRecordId",catalog_snapshot AS "catalogSnapshot" FROM pre_project_rooms WHERE workspace_id=$1 AND case_id=$2 AND id=$3`, [workspaceId, caseId, input.id]);
      if (input.version > 0 && !current.rowCount) throw new NotFoundException("Room not found");
      if (input.version === 0 && current.rowCount && current.rows[0].name === input.name && (current.rows[0].catalogRecordId ?? null) === (input.catalogRecordId ?? null)) return current.rows[0];
      this.version(current.rows[0]?.version ?? 0, input.version);
      const duplicate = await client.query(`SELECT id FROM pre_project_rooms WHERE workspace_id=$1 AND case_id=$2 AND lower(name)=lower($3) AND id<>$4`, [workspaceId, caseId, input.name, input.id]);
      if (duplicate.rowCount) throw new ConflictException("A room with this name already exists. Use a distinct name, such as Bedroom 2.");
      const catalogId = input.catalogRecordId === undefined ? current.rows[0]?.catalogRecordId ?? null : input.catalogRecordId;
      const snapshot = catalogId === current.rows[0]?.catalogRecordId ? current.rows[0].catalogSnapshot : catalogId ? await this.catalogRecord(client,workspaceId,catalogId,"room") : null;
      const result = current.rowCount
        ? await client.query(`UPDATE pre_project_rooms SET name=$4,catalog_record_id=$5,catalog_snapshot=$6,version=version+1 WHERE workspace_id=$1 AND case_id=$2 AND id=$3 RETURNING id,name,version,catalog_record_id AS "catalogRecordId",catalog_snapshot AS "catalogSnapshot"`, [workspaceId, caseId, input.id, input.name,catalogId,snapshot])
        : await client.query(`INSERT INTO pre_project_rooms(id,workspace_id,case_id,name,catalog_record_id,catalog_snapshot) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,version,catalog_record_id AS "catalogRecordId",catalog_snapshot AS "catalogSnapshot"`, [input.id, workspaceId, caseId, input.name,catalogId,snapshot]);
      await this.event(client, workspaceId, caseId, userId, "room_saved", input.id, current.rows[0], result.rows[0]);
      await syncOneTreeFromCase(client, workspaceId, caseId, userId);
      return result.rows[0];
    });
  }

  saveEntry(actor: RequestActor, workspaceId: string, caseId: string, input: SaveBriefEntryDto) {
    return this.edit(actor,workspaceId,caseId,(client,userId)=>this.writeEntry(client,workspaceId,caseId,userId,input));
  }
  bulkEntries(actor:RequestActor,workspaceId:string,caseId:string,entries:SaveBriefEntryDto[]) {
    return this.edit(actor,workspaceId,caseId,async(client,userId)=>{
      const items=[];for(const entry of entries)items.push(await this.writeEntry(client,workspaceId,caseId,userId,entry));return {items};
    });
  }
  async writeEntry(client:PoolClient,workspaceId:string,caseId:string,userId:string,input:SaveBriefEntryDto) {
      if (input.requirementIds?.length) {
        // Moodboard pins can inform specific requirements of the same case.
        if (input.kind !== 'inspiration') throw new BadRequestException('Only moodboard items link to requirements.');
        const found = await client.query(`SELECT id FROM pre_project_brief_entries WHERE workspace_id=$1 AND case_id=$2 AND kind='requirement' AND archived_at IS NULL AND id=ANY($3::uuid[])`, [workspaceId,caseId,input.requirementIds]);
        if (found.rowCount !== input.requirementIds.length) throw new BadRequestException('Choose requirements from this project.');
      }
      const current = await client.query(`SELECT id,version,archived_at,note,note_document,pinned FROM pre_project_brief_entries WHERE workspace_id=$1 AND case_id=$2 AND id=$3`, [workspaceId, caseId, input.id]);
      if (input.version > 0 && !current.rowCount) throw new NotFoundException("Record not found");
      const original = current.rows[0];
      const assets = input.assetIds.length ? await client.query(`SELECT id,mime_type AS "mimeType" FROM pre_project_brief_assets WHERE workspace_id=$1 AND case_id=$2 AND id=ANY($3::uuid[])`, [workspaceId,caseId,input.assetIds]) : { rows: [], rowCount: 0 };
      if (assets.rowCount !== input.assetIds.length) throw new BadRequestException("One or more files do not belong to this pre-execution.");
      if (original?.note_document && input.document === undefined && input.note !== original.note) throw new ConflictException('This requirement has rich content. Open its requirement note to edit the text.');
      const document = input.document === undefined ? original?.note_document : validateNoteDocument(input.document, new Map(assets.rows.map(a => [a.id, a])));
      if (document) { validateNoteDocument(document, new Map(assets.rows.map(a => [a.id, a]))); const text = noteDocumentText(document.content); if (input.note !== text) throw new ConflictException('This requirement has rich content. Open its requirement note to edit the text.'); input = { ...input, note: text }; }
      const pinned = input.pinned ?? original?.pinned ?? false;
      const archived = input.archived ?? Boolean(original?.archived_at);
      // The same client-generated ID and revision can safely retry a lost response.
      if (current.rowCount && (input.version === 0 || original.version === input.version + 1)) {
        const saved = await this.entry(client,workspaceId,caseId,input.id);
        const fields = ['kind','title','note','category','priority','scopeStatus','reviewStatus','quantity','referenceUrl','avoid','source'] as const;
        const unit = saved.catalogLinks.find((link:{role:string}) => link.role === 'unit')?.snapshot;
        const requestedUnit = input.catalogLinks?.some(link => link.role === 'unit') && unit ? String(unit.configuration?.symbol || unit.code) : input.unit;
        const same = fields.every(key => (saved[key] ?? null) === (input[key] ?? null)) && saved.unit === requestedUnit && (saved.roomId ?? null) === (input.roomId ?? null)
          && Boolean(saved.archivedAt) === archived && Boolean(saved.pinned) === pinned && isDeepStrictEqual(saved.document ?? undefined, document ?? undefined)
          && isDeepStrictEqual(saved.assets.map((a:{id:string}) => a.id).sort(), [...input.assetIds].sort())
          && (input.catalogLinks === undefined || isDeepStrictEqual(saved.catalogLinks.map((l:{role:string;recordId:string}) => l.role+':'+l.recordId).sort(), input.catalogLinks.map(l => l.role+':'+l.recordId).sort()));
        if (!same) throw new ConflictException('This requirement changed. Reopen it before saving your changes.');
        return saved;
      }
      this.version(original?.version ?? 0, input.version);
      if (original?.archived_at && input.archived !== false) throw new ConflictException("Restore this record before editing it.");
      if(current.rowCount){
        const surveys=await client.query(`SELECT room_id FROM pre_project_site_records WHERE workspace_id=$1 AND case_id=$2 AND entry_id=$3`,[workspaceId,caseId,input.id]);
        if(surveys.rowCount&&(input.kind!=='requirement'||surveys.rows.some(row=>(row.room_id??null)!==(input.roomId??null))))throw new BadRequestException('This item has site records tied to its room. Keep its room and item type, or create a separate requirement for another location.');
      }
      if (input.roomId) {
        const room = await client.query(`SELECT id FROM pre_project_rooms WHERE workspace_id=$1 AND case_id=$2 AND id=$3`, [workspaceId, caseId, input.roomId]);
        if (!room.rowCount) throw new BadRequestException("Choose a room from this pre-execution.");
      }
      if (input.kind === "file" && !input.assetIds.length) throw new BadRequestException("Attach a file before saving this record.");
      const previousLinks = await client.query(`SELECT role,record_id AS "recordId",snapshot FROM pre_project_scope_links WHERE workspace_id=$1 AND entry_id=$2`,[workspaceId,input.id]);
      const links = input.catalogLinks ?? previousLinks.rows;
      const resolved:Array<{role:string;recordId:string;snapshot:CatalogSnapshot}>=[];
      for (const link of links) {
        const old = previousLinks.rows.find(row=>row.role===link.role && row.recordId===link.recordId);
        const snapshot = old?.snapshot ?? await this.catalogRecord(client,workspaceId,link.recordId,link.role);
        resolved.push({...link,snapshot});
        if (link.role==="unit") {
          const symbol = String(snapshot.configuration?.symbol || snapshot.code);
          if(symbol.length>20) throw new BadRequestException("This catalog unit needs a short symbol (up to 20 characters).");
          input.unit=symbol;
        }
      }
      const selected=(role:string)=>resolved.find(link=>link.role===role);
      const variant=selected('variant');const work=selected('work');
      if(variant&&!work)throw new BadRequestException('Choose an item before selecting its variant.');
      const checkConnection=async(from:{recordId:string}|undefined,to:{recordId:string}|undefined,relation:string,message:string)=>{
        if(!from||!to)return;
        const targets=await client.query(`SELECT target_id FROM workspace_catalog_links WHERE workspace_id=$1 AND record_id=$2 AND relation=$3`,[workspaceId,from.recordId,relation]);
        if(!targets.rows.some(row=>row.target_id===to.recordId))throw new BadRequestException(message);
      };
      await checkConnection(variant,work,'work','This variant belongs to a different catalog item.');
      await checkConnection(selected('material'),selected('brand'),'brand','Choose a brand linked to the selected material, or clear the brand.');
      if(input.kind!=='requirement'&&current.rowCount) {
        const used=await client.query(`SELECT id FROM pre_project_designs WHERE workspace_id=$1 AND case_id=$2 AND scope_entry_id=$3 UNION ALL SELECT entry_id AS id FROM pre_project_item_specifications WHERE workspace_id=$1 AND case_id=$2 AND entry_id=$3 LIMIT 1`,[workspaceId,caseId,input.id]);
        if(used.rowCount)throw new BadRequestException('Specifications or designs are linked to this scope item. Keep its record type as Scope item.');
      }
      const fields = [input.kind,input.title,input.roomId ?? null,input.note,input.category,input.priority,input.scopeStatus,input.reviewStatus,input.quantity ?? null,input.unit,input.referenceUrl,input.avoid,input.source];
      if (current.rowCount) {
        await client.query(`UPDATE pre_project_brief_entries SET kind=$4,title=$5,room_id=$6,note=$7,category=$8,priority=$9,scope_status=$10,review_status=$11,quantity=$12,unit=$13,reference_url=$14,avoid=$15,source=$16,updated_by=$17,version=version+1,updated_at=now() WHERE workspace_id=$1 AND case_id=$2 AND id=$3`, [workspaceId,caseId,input.id,...fields,userId]);
      } else {
        await client.query(`INSERT INTO pre_project_brief_entries(workspace_id,case_id,id,kind,title,room_id,note,category,priority,scope_status,review_status,quantity,unit,reference_url,avoid,source,created_by,updated_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)`, [workspaceId,caseId,input.id,...fields,userId]);
      }
      await client.query(`UPDATE pre_project_brief_entries SET note_document=$4,pinned=$5,archived_at=CASE WHEN $6 THEN COALESCE(archived_at,now()) ELSE NULL END WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[workspaceId,caseId,input.id,document ?? null,pinned,archived]);
      // The reason goes with the decision; an included requirement needs none.
      if (input.scopeNote !== undefined || input.scopeStatus === 'included')
        await client.query(`UPDATE pre_project_brief_entries SET scope_note=$4 WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[workspaceId,caseId,input.id,input.scopeStatus === 'included' ? '' : input.scopeNote ?? '']);
      // A design linked to a scope item follows that item's room, without losing its file history.
      await client.query(`UPDATE pre_project_designs SET room_id=$4,version=version+1,updated_at=now() WHERE workspace_id=$1 AND case_id=$2 AND scope_entry_id=$3 AND room_id IS DISTINCT FROM $4::uuid`,[workspaceId,caseId,input.id,input.roomId??null]);
      await client.query(`DELETE FROM pre_project_scope_links WHERE workspace_id=$1 AND entry_id=$2`,[workspaceId,input.id]);
      for(const link of resolved) await client.query(`INSERT INTO pre_project_scope_links(workspace_id,case_id,entry_id,role,record_id,snapshot) VALUES($1,$2,$3,$4,$5,$6)`,[workspaceId,caseId,input.id,link.role,link.recordId,link.snapshot]);
      if (input.requirementIds !== undefined) {
        await client.query(`DELETE FROM pre_project_entry_requirement_links WHERE workspace_id=$1 AND entry_id=$2`, [workspaceId,input.id]);
        for (const requirementId of input.requirementIds) await client.query(`INSERT INTO pre_project_entry_requirement_links(workspace_id,case_id,entry_id,requirement_id) VALUES($1,$2,$3,$4)`, [workspaceId,caseId,input.id,requirementId]);
      }
      await client.query(`DELETE FROM pre_project_entry_assets WHERE workspace_id=$1 AND case_id=$2 AND entry_id=$3`, [workspaceId,caseId,input.id]);
      for (const assetId of input.assetIds) await client.query(`INSERT INTO pre_project_entry_assets(workspace_id,case_id,entry_id,asset_id) VALUES($1,$2,$3,$4)`, [workspaceId,caseId,input.id,assetId]);
      await this.event(client,workspaceId,caseId,userId,current.rowCount ? "entry_updated" : "entry_added",input.id,{ version: input.version },input);
      await syncOneTreeFromCase(client, workspaceId, caseId, userId);
      // PLM-077: the inspiration week starts with the first inspiration on the case.
      if (input.kind === "inspiration" && !archived) await startInspirationTimer(client, workspaceId, caseId);
      return this.entry(client,workspaceId,caseId,input.id);
  }

  /** Moodboard layout: where each pin sits and whether it's something to love or avoid. Moving a pin never rewrites the pin. */
  saveMoodboardLayout(actor: RequestActor, workspaceId: string, caseId: string, pins: MoodboardPinDto[]) {
    return this.edit(actor, workspaceId, caseId, async (client, userId) => {
      const ids = [...new Set(pins.map((pin) => pin.entryId))];
      const found = ids.length ? await client.query(`SELECT id FROM pre_project_brief_entries WHERE workspace_id=$1 AND case_id=$2 AND kind='inspiration' AND id=ANY($3::uuid[])`, [workspaceId, caseId, ids]) : { rowCount: 0 };
      if (found.rowCount !== ids.length) throw new BadRequestException('Choose moodboard items from this project.');
      for (const pin of pins) {
        await client.query(`INSERT INTO pre_project_moodboard_pins(workspace_id,case_id,entry_id,x,y,width,z,sentiment,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (workspace_id,entry_id) DO UPDATE SET x=excluded.x,y=excluded.y,width=excluded.width,z=excluded.z,sentiment=excluded.sentiment,updated_by=excluded.updated_by,updated_at=now()`,
          [workspaceId, caseId, pin.entryId, Math.round(pin.x), Math.round(pin.y), Math.round(pin.width), pin.z, pin.sentiment, userId]);
      }
      await this.event(client, workspaceId, caseId, userId, 'moodboard_arranged', caseId, {}, { pins: pins.length });
      return { saved: pins.length };
    });
  }
  archiveEntry(actor: RequestActor, workspaceId: string, caseId: string, id: string, input: ArchiveBriefEntryDto) {
    return this.edit(actor,workspaceId,caseId,async (client,userId) => {
      const current = await this.entry(client,workspaceId,caseId,id);
      this.version(current.version,input.version);
      await client.query(`UPDATE pre_project_brief_entries SET archived_at=CASE WHEN $4 THEN now() ELSE NULL END,version=version+1,updated_by=$5,updated_at=now() WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[workspaceId,caseId,id,input.archived,userId]);
      await this.event(client,workspaceId,caseId,userId,input.archived ? "entry_archived" : "entry_restored",id,undefined,{ archived: input.archived });
      await syncOneTreeFromCase(client, workspaceId, caseId, userId);
      return this.entry(client,workspaceId,caseId,id);
    });
  }

  async upload(actor: RequestActor, workspaceId: string, caseId: string, id: string, file?: BriefUpload) {
    assertBriefUpload(file);
    return this.edit(actor,workspaceId,caseId,async (client,userId) => {
      const digest = createHash("sha256").update(file.buffer).digest("hex");
      const existing = await client.query(`SELECT id,original_name AS name,mime_type AS "mimeType",byte_size AS "byteSize",preview_key IS NOT NULL AS "hasPreview",sha256 FROM pre_project_brief_assets WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[workspaceId,caseId,id]);
      if (existing.rowCount) {
        if (existing.rows[0].sha256 !== digest) throw new ConflictException("This upload ID belongs to another file. Choose the file again.");
        const { sha256: _digest, ...asset } = existing.rows[0]; return asset;
      }
      const { name, mimeType, preview } = await prepareReferenceUpload(file,{allowVideo:true});
      const key = `pre-projects/${workspaceId}/${caseId}/${id}`;
      await this.storage.put(`${key}/original`,file.buffer,mimeType);
      if (preview) await this.storage.put(`${key}/preview.webp`,preview,"image/webp");
      const result = await client.query(`INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,preview_key,sha256,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,original_name AS name,mime_type AS "mimeType",byte_size AS "byteSize",preview_key IS NOT NULL AS "hasPreview"`,[id,workspaceId,caseId,name,mimeType,file.buffer.length,`${key}/original`,preview ? `${key}/preview.webp` : null,digest,userId]);
      await this.event(client,workspaceId,caseId,userId,"asset_uploaded",id,undefined,{ name,mimeType,byteSize:file.buffer.length });
      return result.rows[0];
    });
  }

  asset(actor: RequestActor, workspaceId: string, caseId: string, id: string, preview: boolean) {
    return this.access.withPermission(actor,workspaceId,"pre_projects.view",async client => {
      await this.case(client,workspaceId,caseId);
      const result = await client.query(`SELECT original_name,mime_type,object_key,preview_key FROM pre_project_brief_assets WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,[workspaceId,caseId,id]);
      if (!result.rowCount) throw new NotFoundException("File not found");
      const row=result.rows[0];
      if (preview && !row.preview_key) throw new NotFoundException("Preview not available");
      const stored=await this.storage.read(preview ? row.preview_key : row.object_key).catch(() => { throw new NotFoundException("This file could not be found in storage."); });
      return { body:stored.body,contentType:preview ? "image/webp" : row.mime_type,name:row.original_name,preview };
    });
  }

  catalogOptions(actor:RequestActor,workspaceId:string,caseId:string,kind:string,search:string,relation='',relatedId='') {
    if (!["room","work","variant","material","brand","finish","unit","execution"].includes(kind)) throw new BadRequestException("Choose a catalog record type.");
    if ((relation || relatedId) && (!['room','work'].includes(relation) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(relatedId))) throw new BadRequestException('Choose a valid room or item.');
    if(search.length>180) throw new BadRequestException("Search is too long.");
    return this.access.withPermission(actor,workspaceId,"pre_projects.view",async client=>{
      await this.case(client,workspaceId,caseId);
      const rows=await client.query(`SELECT r.id,r.name,r.kind,r.code,r.version,r.content->'configuration' AS configuration,r.content->'commerce' AS commerce,c.name AS "catalogName",r.catalog_id AS "catalogId",
        COALESCE((SELECT jsonb_agg(jsonb_build_object('role',l.relation,'recordId',t.id,'snapshot',jsonb_build_object('id',t.id,'name',t.name,'code',t.code,'kind',t.kind,'version',t.version,'catalogId',t.catalog_id,'catalogName',tc.name,'configuration',t.content->'configuration'))) FROM workspace_catalog_links l JOIN workspace_catalog_records t ON t.workspace_id=l.workspace_id AND t.id=l.target_id JOIN workspace_catalog_records tc ON tc.workspace_id=t.workspace_id AND tc.id=t.catalog_id WHERE l.workspace_id=r.workspace_id AND l.record_id=r.id AND l.relation IN ('brand','finish') AND NOT t.archived AND NOT tc.archived),'[]'::jsonb) AS links
        FROM workspace_catalog_records r JOIN workspace_catalog_records c ON c.workspace_id=r.workspace_id AND c.id=r.catalog_id
        WHERE r.workspace_id=$1 AND (r.kind=$2 OR ($2='material' AND r.kind IN ('sku','hardware','consumable'))) AND NOT r.archived AND NOT c.archived
        AND ($4='' OR EXISTS(SELECT 1 FROM workspace_catalog_links parent WHERE parent.workspace_id=r.workspace_id AND parent.record_id=r.id AND parent.relation=$4 AND parent.target_id::text=$5))
        AND ($3='' OR strpos(lower(r.name || ' ' || r.code || ' ' || c.name),lower($3))>0) ORDER BY r.name,r.id LIMIT 100`,[workspaceId,kind,search,relation,relatedId]);
      return {items:rows.rows};
    });
  }
  async catalogRecord(client:PoolClient,workspaceId:string,id:string,role:string):Promise<CatalogSnapshot> {
    const result=await client.query(`SELECT r.id,r.name,r.kind,r.code,r.version,r.catalog_id AS "catalogId",c.name AS "catalogName",r.content->'configuration' AS configuration,r.content->'commerce' AS commerce
      FROM workspace_catalog_records r JOIN workspace_catalog_records c ON c.workspace_id=r.workspace_id AND c.id=r.catalog_id
      WHERE r.workspace_id=$1 AND r.id=$2 AND NOT r.archived AND NOT c.archived`,[workspaceId,id]);
    const record=result.rows[0];
    if(!record || (record.kind!==role && !(role==='material'&&['sku','hardware','consumable'].includes(record.kind)))) throw new BadRequestException(`Choose an active ${role==='work'?'item':role} from this workspace's catalogs.`);
    return record;
  }

  async case(client: PoolClient, workspaceId: string, caseId: string, lock=false): Promise<Context> {
    const result=await client.query(`SELECT c.status,o.description,o.amount,COALESCE(o.currency_code,w.default_currency) AS "currencyCode",o.lead_id AS "leadId",o.qualification_evidence AS "qualificationEvidence" FROM pre_project_cases c JOIN workspaces w ON w.id=c.workspace_id JOIN crm_opportunities o ON o.id=c.opportunity_id AND o.workspace_id=c.workspace_id WHERE c.workspace_id=$1 AND c.id=$2${lock ? " FOR UPDATE OF c" : ""}`,[workspaceId,caseId]);
    if (!result.rowCount) throw new NotFoundException("Pre-execution not found"); return result.rows[0];
  }
  edit<T>(actor: RequestActor, workspaceId: string, caseId: string, work: (client: PoolClient,userId: string)=>Promise<T>) {
    return this.access.withPermissions(actor,workspaceId,["pre_projects.view","pre_projects.edit"],async (client,user)=>{
      // Working records remain revisionable throughout execution. Commercial
      // acceptance and execution release retain their own immutable snapshots.
      await this.case(client,workspaceId,caseId,true);
      const result=await work(client,user.userId);
      await client.query(`UPDATE pre_project_cases SET updated_at=now() WHERE workspace_id=$1 AND id=$2`,[workspaceId,caseId]);
      return result;
    });
  }
  version(actual:number,expected:number) { if (actual!==expected) throw new ConflictException("Someone updated this record. Your changes have been kept in the form. Close it and reopen the latest record before applying them."); }
  async entry(client:PoolClient,workspaceId:string,caseId:string,id:string) {
    const result=await client.query(`${entrySelect} WHERE e.workspace_id=$1 AND e.case_id=$2 AND e.id=$3`,[workspaceId,caseId,id]);
    if (!result.rowCount) throw new NotFoundException("Record not found"); return result.rows[0];
  }
  private event(client:PoolClient,workspaceId:string,caseId:string,actorUserId:string,action:string,entityId:string,before?:unknown,after?:unknown) {
    return this.events.record(client,{ workspaceId,actorUserId,source:"user",action:`pre_project.${action}.v1`,entityType:"pre_project_brief",entityId,before:before===undefined?undefined:{data:before},after:{ caseId,data:after } });
  }
}
