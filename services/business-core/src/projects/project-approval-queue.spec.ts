import {it,expect,vi} from 'vitest';
import {approvalQueuePage,approvalQueueQuery,type ApprovalQueueSource} from './project-approval-queue';
import {ExecutionService} from './execution.service';
const source:ApprovalQueueSource={projectId:'11111111-1111-4111-8111-111111111111',projectName:'Villa',ownerName:'Maya',sortDue:'2026-10-01',document:{title:'Current name',revision:'R2'},request:{id:'rfa',version:2,documentId:'doc',reviewerId:'reviewer',createdBy:'planner',dueDate:'2026-10-01',instructions:'Private instructions',status:'submitted',createdAt:'2026-09-22',history:[],snapshot:{document:{id:'doc',title:'Submitted drawing',revision:'R1',url:'https://private.example/document',kind:'drawing',note:'Private reference',status:'draft',published:false,replaces:''},scope:[]}}};
it('projects assigned amendments with exact source links and distinct cursor identities',()=>{
 const amendment:ApprovalQueueSource={...source,kind:'order_amendment',orderId:'order',document:{title:'PO-1 · Boards',revision:'Amendment'},request:{id:'amendment:change',status:'submitted',createdBy:'buyer',reviewerId:'reviewer',dueDate:'2026-09-24'}};
 const row=approvalQueuePage([amendment],'reviewer',true).rows[0];
 expect(row).toMatchObject({kind:'order_amendment',ownerId:'reviewer',title:'PO-1 · Boards'});
 expect(row.href).toBe(`/workspace/projects/${source.projectId}/procurement?record=order&amendment=change`);
 expect(row).not.toHaveProperty('evidence');expect(row).not.toHaveProperty('before');
 expect(approvalQueueQuery({cursor:approvalQueuePage(Array(101).fill(amendment),'reviewer',true).nextCursor}).after?.[2]).toBe('amendment:change');
});
it('projects exact source identity without leaking document content or private fields',()=>{
 const page=approvalQueuePage([source],'reviewer',true);
 expect(page.rows[0]).toMatchObject({id:`${source.projectId}:rfa`,title:'Submitted drawing',revision:'R1',ownerId:'reviewer',projectName:'Villa'});
 expect(page.rows[0].href).toContain('view=approvals&record=rfa');
 expect(JSON.stringify(page)).not.toContain('Private');expect(JSON.stringify(page)).not.toContain('private.example');
});
it('assigns correction work to its creator without making a new task identity',()=>{
 const before=approvalQueuePage([source],'planner',false).rows[0];const after=approvalQueuePage([{...source,request:{...source.request,status:'returned'}}],'planner',false).rows[0];
 expect(after.id).toBe(before.id);expect(after.ownerId).toBe('planner');
});
it('moves reassigned amendment work without duplicating its queue identity',()=>{
 const record:ApprovalQueueSource={...source,kind:'order_amendment',orderId:'o',request:{id:'amendment:a',status:'submitted',createdBy:'buyer',reviewerId:'old',dueDate:'2026-09-24'}};
 const before=approvalQueuePage([record],'old',true).rows[0];
 const after=approvalQueuePage([{...record,ownerName:'New reviewer',request:{...record.request,reviewerId:'new',dueDate:'2026-09-26'}}],'new',true).rows[0];
 expect(after.id).toBe(before.id);expect(after.href).toBe(before.href);expect(after).toMatchObject({ownerId:'new',ownerName:'New reviewer',dueDate:'2026-09-26'});
});
it('uses a bounded page and an exact seek cursor for the last displayed request',()=>{
 const records=Array.from({length:101},(_,i)=>({...source,request:{...source.request,id:`rfa-${i}`}}));
 const page=approvalQueuePage(records,'reviewer',true);expect(page.rows).toHaveLength(100);
 expect(approvalQueueQuery({cursor:page.nextCursor}).after).toEqual(['2026-10-01',source.projectId,'rfa-99']);
 expect(approvalQueuePage(records.slice(0,100),'reviewer',true).nextCursor).toBeNull();
});
it.each([{cursor:'broken'},{cursor:Buffer.from('["2026-10-01","other-tenant","rfa"]').toString('base64url')},{view:'everything'},{q:'x'.repeat(161)}])('rejects malformed query %j',query=>expect(()=>approvalQueueQuery(query)).toThrow());
it('requires module access before querying the global source',async()=>{
 const query=vi.fn();const access={run:async(_a:unknown,_w:string,work:(ctx:unknown)=>unknown)=>work({client:{query}}),require:()=>{throw Error('Denied');}};
 const service=new ExecutionService(access as never,{} as never,{} as never);
 await expect(service.approvalQueue({} as never,'workspace',{})).rejects.toThrow('Denied');expect(query).not.toHaveBeenCalled();
});
it('retains tenant and project assignment restrictions and parameterizes search/cursors',async()=>{
 const query=vi.fn().mockResolvedValue({rows:[source]});const require=vi.fn();const access={run:async(_a:unknown,_w:string,work:(ctx:unknown)=>unknown)=>work({client:{query},membershipId:'member',permissions:new Set(['projects.view'])}),require};
 const service=new ExecutionService(access as never,{} as never,{} as never);
 await service.approvalQueue({} as never,'workspace',{view:'mine',q:"x' OR true--"});
 expect(require).toHaveBeenCalledWith(expect.anything(),'projects.view','projects.manage');
 const [sql,params]=query.mock.calls[0];expect(sql).toContain('p.workspace_id=$1');expect(sql).toContain('a.membership_id=$2 AND a.active');expect(sql).toContain('e.workspace_id=p.workspace_id');expect(sql).not.toContain("x' OR true--");expect(params).toEqual(['workspace','member',false,'mine',"x' OR true--",null,null,null]);
});
