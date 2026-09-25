import {expect,it,vi} from 'vitest';
import {readWorkQueue,workQueuePage,type WorkQueueSource} from './project-work-queue';
import {approvalQueueQuery} from './project-approval-queue';
import type {HrmsContext} from '../hrms/hrms-access.service';
const source:WorkQueueSource={projectId:'11111111-1111-4111-8111-111111111111',projectName:'Villa',clientName:'Sara Al Nuaimi',recordId:'factory',kind:'task',title:'Build wardrobe',status:'in_progress',ownerId:'owner',ownerName:'Maya',dueDate:'2026-09-22',sortDue:'2026-09-22',location:'factory'};
it('routes each operational record to its authoritative project screen',()=>{
 const records=[source,...(['report','order','dispatch','snag','handover'] as const).map(kind=>({...source,kind}))];
 const page=workQueuePage(records,'owner');
 expect(page.rows.map(row=>row.href.split('/').at(-1))).toEqual(['production?record=factory','daily-progress?record=factory','procurement?record=factory','production?view=dispatch&record=factory','snagging?record=factory','handover?record=factory']);
 expect(new Set(page.rows.map(row=>row.id)).size).toBe(6);
 expect(page.rows[0]).not.toHaveProperty('sortDue');expect(page.rows[0].location).toBe('factory');expect(page.rows[0].clientName).toBe('Sara Al Nuaimi');
});
it('paginates with due date, project and distinct source identity',()=>{
 const page=workQueuePage(Array.from({length:101},(_,index)=>({...source,recordId:String(index)})),'owner');
 expect(page.rows).toHaveLength(100);expect(approvalQueueQuery({cursor:page.nextCursor},100).after).toEqual(['2026-09-22',source.projectId,'task:99']);
 expect(()=>approvalQueueQuery({cursor:'not-json'},100)).toThrow();
});
it('scopes database work before source expansion and binds filters instead of interpolating search',async()=>{
 const query=vi.fn().mockResolvedValue({rows:[source]});
 const ctx={workspaceId:'workspace',membershipId:'owner',permissions:new Set(['projects.view']),client:{query}} as unknown as HrmsContext;
 await readWorkQueue(ctx,{view:'mine',q:"O'Brien"});
 const [sql,params]=query.mock.calls[0];expect(params).toEqual(['workspace','owner',false,'mine',"O'Brien",null,null,null,false,'','','','','','','','','']);
 expect(sql).toContain('project_assignments');expect(sql).toContain('a.active');expect(sql).toContain('LIMIT 101');expect(sql).not.toContain("O'Brien");
});
it('binds project and assignee filters and rejects invalid identifiers before querying',async()=>{
 const query=vi.fn().mockResolvedValue({rows:[]});
 const ctx={workspaceId:'workspace',membershipId:'owner',permissions:new Set(['projects.view']),client:{query}} as unknown as HrmsContext;
 await readWorkQueue(ctx,{view:'all',projectId:source.projectId,ownerId:'unassigned'});
 expect(query.mock.calls[0][1].slice(9,11)).toEqual([source.projectId,'unassigned']);
 query.mockClear();
 await expect(readWorkQueue(ctx,{projectId:'not-a-project'})).rejects.toThrow('valid project and assignee');
 expect(query).not.toHaveBeenCalled();
});
it('filters work dimensions before cursor pagination and rejects unsupported filters',async()=>{
 const query=vi.fn().mockResolvedValue({rows:[]});const ctx={workspaceId:'workspace',membershipId:'owner',permissions:new Set(['projects.view']),client:{query}} as unknown as HrmsContext;
 await readWorkQueue(ctx,{kind:'task',location:'factory',priority:'urgent',resourceId:source.projectId,area:'Bedroom'});
 expect(query.mock.calls[0][1].slice(11)).toEqual(['task','factory','urgent',source.projectId,'Bedroom','','']);
 expect(query.mock.calls[0][0]).toContain("s.record->>'location'=$13");
 for(const filter of [{location:'spaceship'},{priority:'critical'},{kind:'payment'},{resourceId:'bad'}])await expect(readWorkQueue(ctx,filter)).rejects.toThrow('valid work filters');
});
it('filters the calendar window before pagination',async()=>{
 const query=vi.fn().mockResolvedValue({rows:[]});const ctx={workspaceId:'workspace',membershipId:'owner',permissions:new Set(['projects.view']),client:{query}} as unknown as HrmsContext;
 await readWorkQueue(ctx,{view:'all',from:'2026-09-21',to:'2026-09-28'});
 expect(query.mock.calls[0][1].slice(-2)).toEqual(['2026-09-21','2026-09-28']);
 expect(query.mock.calls[0][0]).toContain("coalesce(s.due,'') >= $17");
 query.mockClear();
 await expect(readWorkQueue(ctx,{from:'2026-09-28',to:'2026-09-21'})).rejects.toThrow('valid work date range');
 expect(query).not.toHaveBeenCalled();
});
