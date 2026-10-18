import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { applyEvidenceConsent, assertSurveyReview, normalizeSurveyDimensions, SiteService, validateVisit } from './site.service';
import { preserveSurveyDimensions } from './item-specification.service';
import { SaveSiteMeasurementDto, SaveSiteVisitDto } from './site.dto';
import { BriefService } from './brief.service';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { CrmEventsService } from '../crm/shared/crm-events.service';
import { RequestActor } from '../auth/actor';

const id='e56299c6-3da3-402a-a9ac-3995bb37b9d4';
const dimension={id,name:'Opening width',unit:'ft',basis:'site_opening',approximate:8,measured:7.9,source:'team',evidence:'Tape measurement'};
const visit={id,version:0,title:'Measure rooms',note:'',assetIds:[],scheduledAt:'2026-09-08T06:00:00Z',timezone:'Asia/Dubai',durationMinutes:60,assigneeId:null,location:'Office',access:'',status:'planned',outcome:''};
describe('site survey boundaries',()=>{
 it('normalizes measured and approximate dimensions independently',()=>expect(normalizeSurveyDimensions([dimension])[0]).toMatchObject({approximate:8,measured:7.9,approximateMetres:2.4384,measuredMetres:2.40792}));
 it('rejects empty dimensions',()=>expect(()=>normalizeSurveyDimensions([{...dimension,approximate:null,measured:null}])).toThrow('Enter an approximate'));
 it('requires measured values and evidence before verification',()=>{
  const survey={id,kind:'measurement',version:1,title:'Room',status:'measured',assetIds:[],dimensions:[dimension]};
  expect(()=>assertSurveyReview(survey,'verified')).toThrow('supporting photo');
  expect(()=>assertSurveyReview({...survey,assetIds:[id],dimensions:[{...dimension,measured:null}]},'verified')).toThrow('measured values');
  expect(()=>assertSurveyReview({...survey,assetIds:[id]},'verified')).not.toThrow();
  expect(()=>assertSurveyReview(survey,'recheck')).not.toThrow();
 });
 it('does not repeat a decision on an already-reviewed version',()=>expect(()=>assertSurveyReview({id,kind:'measurement',version:2,title:'Room',status:'verified',assetIds:[id],dimensions:[dimension]},'verified')).toThrow('already verified'));
 it('preserves Site metadata when only item materials change',()=>{
  const old={...dimension,verification:'verified',siteSurvey:{id,version:3,status:'verified'}};
  expect(preserveSurveyDimensions([dimension],[old])[0]).toBe(old);
  expect(()=>preserveSurveyDimensions([{...dimension,measured:8}],[old])).toThrow('Edit site survey dimensions');
  expect(()=>preserveSurveyDimensions([],[old])).toThrow('Edit site survey dimensions');
 });
 it('checks permission before writing a measurement review',async()=>{
  const query=vi.fn();const hasPermission=vi.fn(async()=>false);
  const service=new SiteService({hasPermission} as unknown as WorkspaceAccessService,{edit:async(_a:unknown,_w:unknown,_c:unknown,work:(client:unknown,userId:string)=>unknown)=>work({query},'user')} as unknown as BriefService,{} as CrmEventsService);
  await expect(service.review({} as RequestActor,'workspace','case',id,{version:1,status:'verified',note:'Checked'})).rejects.toThrow('verification permission');expect(query).not.toHaveBeenCalled();
 });
 it('rejects invalid time zones, floating times and future completion',()=>{
  expect(()=>validateVisit(visit)).not.toThrow();
  expect(()=>validateVisit({...visit,timezone:'Not/AZone'})).toThrow('time zone');
  expect(()=>validateVisit({...visit,scheduledAt:'2026-09-08T10:00'})).toThrow('offset');
  expect(()=>validateVisit({...visit,status:'cancelled'})).toThrow('cancellation reason');
  expect(()=>validateVisit({...visit,status:'completed',scheduledAt:'2099-09-08T06:00:00Z',outcome:'Done'})).toThrow('future visit');
 });
 it('rejects client-supplied verification flags and duplicate dimensions',async()=>{
  const dto=plainToInstance(SaveSiteMeasurementDto,{id,version:0,title:'Room',note:'',assetIds:[],roomId:id,entryId:null,visitId:null,specificationVersion:0,dimensions:[dimension,dimension],status:'verified',verifiedBy:id});
  expect(await validate(dto,{whitelist:true,forbidNonWhitelisted:true})).not.toHaveLength(0);
 });
 it('accepts only a boolean evidence-consent confirmation flag',async()=>{
  const valid=plainToInstance(SaveSiteVisitDto,{...visit,evidenceConsentConfirmed:true});
  const invalid=plainToInstance(SaveSiteVisitDto,{...visit,evidenceConsentConfirmed:'yes'});
  expect(await validate(valid,{whitelist:true,forbidNonWhitelisted:true})).toHaveLength(0);
  expect(await validate(invalid,{whitelist:true,forbidNonWhitelisted:true})).not.toHaveLength(0);
  const spoofed=plainToInstance(SaveSiteVisitDto,{...visit,evidenceConsent:{confirmedBy:id,confirmedAt:'2020-01-01'}});
  expect(await validate(spoofed,{whitelist:true,forbidNonWhitelisted:true})).not.toHaveLength(0);
 });
 it('records evidence consent with the authenticated actor and server time, then preserves it',()=>{
  const at=new Date('2026-09-18T00:00:00Z');const content={id,version:1,kind:'observation',title:'Site photos',status:'open',assetIds:[id],evidenceConsentConfirmed:true};
  const recorded=applyEvidenceConsent(content,null,'actor',()=>at);
  expect(recorded).toMatchObject({evidenceConsent:{confirmedBy:'actor',confirmedAt:at.toISOString()}});expect(recorded).not.toHaveProperty('evidenceConsentConfirmed');
  expect(applyEvidenceConsent({...content,evidenceConsentConfirmed:false},recorded,'another',()=>new Date())).toMatchObject({evidenceConsent:{confirmedBy:'actor',confirmedAt:at.toISOString()}});
 });
 it('completes a visit only once what it captured is measured with photos (PLM-128); a visit already done stays editable',async()=>{
  const service=(evidence:Array<{title:string;status:string;files:number}>,previous:unknown=null)=>{
   const query=vi.fn(async(sql:string)=>sql.includes('UNION ALL')?{rows:evidence}:sql.startsWith('SELECT content')?{rowCount:previous?1:0,rows:previous?[{content:previous}]:[]}:{rows:[],rowCount:0});
   const site=new SiteService({} as WorkspaceAccessService,{edit:async(_a:unknown,_w:unknown,_c:unknown,work:(client:unknown,userId:string)=>unknown)=>work({query},'user'),version:()=>undefined} as unknown as BriefService,{} as CrmEventsService);
   return {site,query};
  };
  const done={...visit,status:'completed',outcome:'Measured the kitchen'};
  await expect(service([]).site.saveVisit({} as RequestActor,'workspace','case',done)).rejects.toThrow('Record the measurements and photos from the visit first');
  await expect(service([{title:'Kitchen',status:'not_measured',files:0}]).site.saveVisit({} as RequestActor,'workspace','case',done)).rejects.toThrow('Finish the measurements for Kitchen');
  await expect(service([{title:'Kitchen',status:'measured',files:0}]).site.saveVisit({} as RequestActor,'workspace','case',done)).rejects.toThrow('Add a photo for Kitchen');
  // A planned visit, or one already recorded as done, is not checked again.
  const planned=service([]);
  await planned.site.saveVisit({} as RequestActor,'workspace','case',visit).catch(()=>undefined);
  expect(planned.query.mock.calls.some(([sql])=>String(sql).includes('UNION ALL'))).toBe(false);
  const recorded=service([],{...done,kind:'visit',version:1});
  await recorded.site.saveVisit({} as RequestActor,'workspace','case',{...done,version:1}).catch(()=>undefined);
  expect(recorded.query.mock.calls.some(([sql])=>String(sql).includes('UNION ALL'))).toBe(false);
 });
 it('validates positive visit duration',async()=>expect(await validate(plainToInstance(SaveSiteVisitDto,{...visit,durationMinutes:0}))).not.toHaveLength(0));
});
