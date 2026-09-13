import { parseDate, parseDateTime, startOfMonth, toZoned } from '@internationalized/date';
import { type CaseAsset, type ItemDimension, type ScopeEntry } from './content';

export type SiteKind='visit'|'measurement'|'observation';
export type SiteRecord={id:string;version:number;kind:SiteKind;title:string;note:string;status:string;roomId:string|null;entryId:string|null;visitId:string|null;roomName?:string|null;entryTitle?:string|null;entryArchivedAt?:string|null;visitTitle?:string|null;assetIds:string[];assets:CaseAsset[];updatedAt?:string;recordedBy?:string;
 scheduledAt?:string;timezone?:string;durationMinutes?:number;assigneeId?:string|null;assigneeName?:string|null;location?:string;access?:string;outcome?:string;
 category?:string;resolution?:string;dimensions?:ItemDimension[];reviewNote?:string;verifiedBy?:string|null;verifiedAt?:string|null};
export type SiteData={items:SiteRecord[];members:{id:string;name:string}[];timezone:string;weekStartsOn?:number;canVerify:boolean};
export const siteLabels:Record<string,string>={visit:'Visit',measurement:'Measurements',observation:'Observation',planned:'Planned',completed:'Completed',cancelled:'Cancelled',incomplete:'Incomplete',measured:'Awaiting verification',verified:'Verified',recheck:'Recheck needed',open:'Open',resolved:'Resolved',condition:'Existing condition',opening:'Doors & openings',electrical:'Electrical',plumbing:'Plumbing',access:'Access & delivery',constraint:'Site constraint',other:'Other'};
export function newSiteRecord(kind:SiteKind,timezone:string,roomId:string|null=null,entry?:ScopeEntry):SiteRecord {
 return {id:crypto.randomUUID(),version:0,kind,title:entry?.title??'',note:'',status:kind==='visit'?'planned':kind==='observation'?'open':'incomplete',roomId:entry?.roomId??roomId,entryId:entry?.id??null,visitId:null,assetIds:[],assets:[],scheduledAt:'',timezone,durationMinutes:60,assigneeId:null,location:'',access:'',outcome:'',category:'condition',resolution:'',dimensions:entry?.specification?.dimensions??[]};
}
export function sitePayload(record:SiteRecord,specificationVersion=0) {
 const common={id:record.id,version:record.version,title:record.title.trim(),note:record.note,assetIds:record.assets.map(a=>a.id)};
 if(record.kind==='visit')return {...common,scheduledAt:record.scheduledAt,timezone:record.timezone,durationMinutes:record.durationMinutes,assigneeId:record.assigneeId??null,location:record.location??'',access:record.access??'',status:record.status,outcome:record.outcome??''};
 const location={roomId:record.roomId,entryId:record.entryId,visitId:record.visitId};
 if(record.kind==='observation')return {...common,...location,category:record.category??'condition',status:record.status,resolution:record.resolution??''};
 return {...common,...location,specificationVersion,dimensions:(record.dimensions??[]).map(d=>({id:d.id,name:d.name,unit:d.unit,basis:d.basis,approximate:d.approximate,measured:d.measured,source:d.source,evidence:d.evidence}))};
}
export function visitWallTime(iso:string|undefined,timezone:string) {
 if(!iso)return '';
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));
 const get=(type:string)=>parts.find(p=>p.type===type)?.value;
 return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
export function visitInstant(local:string,timezone:string) {return toZoned(parseDateTime(local),timezone,'reject').toDate().toISOString();}
export function siteCalendarDays(month:string,weekStartsOn=1) {
 const first=startOfMonth(parseDate(month));const offset=(first.toDate('UTC').getUTCDay()-weekStartsOn+7)%7;
 const start=first.subtract({days:offset});return Array.from({length:42},(_,i)=>start.add({days:i}));
}
export function visitFallsOn(record:SiteRecord,day:string,timezone:string) {
 if(!record.scheduledAt)return false;
 const start=visitWallTime(record.scheduledAt,timezone).slice(0,10);
 const end=visitWallTime(new Date(Date.parse(record.scheduledAt)+(record.durationMinutes??60)*60000-1).toISOString(),timezone).slice(0,10);
 return start<=day&&day<=end;
}
export function visitDate(record:SiteRecord,locale='en') {
 return record.scheduledAt?new Intl.DateTimeFormat(locale,{timeZone:record.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(record.scheduledAt)):'';
}
export function visitCalendar(record:SiteRecord) {
 if(!record.scheduledAt)throw new Error('Save a scheduled visit first.');
 const escape=(value:string)=>value.replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll('\r','').replaceAll(',','\\,').replaceAll(';','\\;');
 const utc=(date:Date)=>date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Wodana//Site visit//EN','BEGIN:VEVENT',`UID:${record.id}@wodana`,`DTSTAMP:${utc(new Date())}`,`DTSTART:${utc(new Date(record.scheduledAt))}`,`DTEND:${utc(new Date(Date.parse(record.scheduledAt)+(record.durationMinutes??60)*60000))}`,`SUMMARY:${escape(record.title)}`,`LOCATION:${escape(record.location??'')}`,`DESCRIPTION:${escape([record.note,record.access,record.assigneeName?`Assigned to ${record.assigneeName}`:''].filter(Boolean).join('\n'))}`,`STATUS:${record.status==='cancelled'?'CANCELLED':'CONFIRMED'}`,`SEQUENCE:${record.version}`,'END:VEVENT','END:VCALENDAR'];
 // Fold on UTF-8 byte boundaries for calendar readers, without splitting a character.
 return lines.map(line=>{const chunks:string[]=[];let chunk='',bytes=0;for(const char of line){const size=new TextEncoder().encode(char).length;if(bytes+size>73){chunks.push(chunk);chunk=' ';bytes=1;}chunk+=char;bytes+=size;}chunks.push(chunk);return chunks.join('\r\n');}).join('\r\n')+'\r\n';
}
