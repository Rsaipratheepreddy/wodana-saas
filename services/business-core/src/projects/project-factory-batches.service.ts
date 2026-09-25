import {BadRequestException,ConflictException,Injectable,NotFoundException} from '@nestjs/common';
import {createHash,randomUUID} from 'node:crypto';
import type {RequestActor} from '../auth/actor';
import {HrmsAccessService,type HrmsContext} from '../hrms/hrms-access.service';
import {ExecutionService} from './execution.service';
import {obj,str} from './execution.domain';
import {commercialExecutionReady} from './project-readiness';
import {assertCompatibleFactoryTasks,assertFactoryScope,assertUnstartedFactoryTask,factoryAllocationView,factoryBatchState,factoryTaskSnapshot,type FactoryAllocation,type FactoryBatch,type FactoryBatchesState,type FactoryCandidate} from './project-factory-batches';
import type {ProjectData} from './execution.types';

const uuid=(value:unknown)=>{const id=str(value,36,true);if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))throw new BadRequestException('Choose a valid record.');return id;};
@Injectable()
export class ProjectFactoryBatchesService {
  constructor(private readonly access:HrmsAccessService,private readonly execution:ExecutionService){}

  state(actor:RequestActor,workspaceId:string,projectId?:string){
    return this.access.run(actor,workspaceId,async ctx=>{
      this.access.require(ctx,'projects.view','projects.manage');
      if(projectId)await this.execution.row(ctx,uuid(projectId));else this.access.require(ctx,'projects.manage');
      return this.stateIn(ctx,projectId);
    });
  }

  private async stateIn(ctx:HrmsContext,projectId?:string):Promise<FactoryBatchesState>{
    const canManage=ctx.permissions.has('projects.manage');
    // Project reads select only their own allocations, never load the other projects' data.
    const rows=(await ctx.client.query<{id:string;content:FactoryBatch;version:number;project_id:string;snapshot:FactoryAllocation}>(
      `SELECT b.id,b.content,b.version,a.project_id,a.snapshot FROM project_factory_batches b
       JOIN project_factory_allocations a ON a.workspace_id=b.workspace_id AND a.batch_id=b.id
       WHERE b.workspace_id=$1 AND ($2::uuid IS NULL OR a.project_id=$2) ORDER BY b.created_at DESC,b.id,a.project_id,a.task_id`,[ctx.workspaceId,projectId??null])).rows;
    const projects=new Map<string,ProjectData>();
    for(const id of [...new Set(rows.map(row=>row.project_id))])projects.set(id,await this.execution.load(ctx,id));
    const bookings=(await ctx.client.query<{project_id:string;task_id:string;resource_id:string;start:string;end:string}>(`SELECT project_id,task_id,resource_id,starts_on::text AS start,ends_on::text AS end FROM project_bookings WHERE workspace_id=$1 AND status='confirmed' AND ($2::uuid IS NULL OR project_id=$2)`,[ctx.workspaceId,projectId??null])).rows;
    const batches:FactoryBatchesState['batches']=[];
    for(const row of rows){
      let batch=batches.find(item=>item.id===row.id);
      if(!batch){batch={...row.content,version:row.version,state:'planned',allocations:[]};batches.push(batch);}
      const allocation=row.snapshot;
      const project=projects.get(row.project_id)!;
      const task=project.tasks.find(item=>item.id===allocation.snapshot.taskId);
      const booked=Boolean(task?.start&&task.end&&bookings.some(booking=>booking.project_id===row.project_id&&booking.task_id===task.id&&booking.resource_id===task.resourceId&&booking.start<=task.start&&booking.end>=task.end));
      batch.allocations.push(row.content.cancelled ? {...allocation,approved:0,dispatched:0,received:0,rejected:0,returned:0,qc:'not_started',status:'cancelled',changed:false,booked:false} : factoryAllocationView(allocation,project,booked));
    }
    for(const batch of batches)batch.state=factoryBatchState(batch,batch.allocations);
    if(!canManage||projectId)return {canManage:false,batches,candidates:[],resources:[],members:[]};
    const resources=(await ctx.client.query<{id:string;name:string}>(`SELECT id,name FROM project_resources WHERE workspace_id=$1 AND active AND kind='factory' ORDER BY name`,[ctx.workspaceId])).rows;
    const members=(await ctx.client.query<{id:string;name:string}>(`SELECT m.id,u.display_name AS name FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.status='active' ORDER BY u.display_name`,[ctx.workspaceId])).rows;
    const available=(await ctx.client.query<{id:string;name:string;content:ProjectData}>(`SELECT p.id,p.name,e.content FROM delivery_projects p JOIN project_execution_view e ON e.workspace_id=p.workspace_id AND e.project_id=p.id WHERE p.workspace_id=$1 AND p.status<>'archived' AND e.content->>'phase'<>'completed' ORDER BY p.name`,[ctx.workspaceId])).rows;
    const allocated=new Set(rows.filter(row=>!row.content.cancelled).map(row=>`${row.project_id}:${row.snapshot.snapshot.taskId}`));
    const candidates:FactoryCandidate[]=[];
    for(const project of available)for(const task of project.content.tasks){
      const key=`${project.id}:${task.id}`,resource=resources.find(resource=>resource.id===task.resourceId);
      if(allocated.has(key)||!resource)continue;
      try{assertUnstartedFactoryTask(project.content,task);assertFactoryScope(factoryTaskSnapshot(project.content,task));}catch{continue;}
      candidates.push({key,projectId:project.id,projectName:project.name,revision:project.content.revision,snapshot:factoryTaskSnapshot(project.content,task),resourceName:resource.name});
    }
    return {canManage,batches,candidates,resources,members};
  }

  command(actor:RequestActor,workspaceId:string,input:unknown){
    return this.access.run(actor,workspaceId,async ctx=>{
      this.access.require(ctx,'projects.manage');
      const body=obj(input),requestId=uuid(body.requestId),action=str(body.action,20,true);
      if(!['create','cancel'].includes(action))throw new BadRequestException('Unknown factory batch action.');
      const hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
      // Transfers can lock several project rows too. Serialize with their workspace lock first.
      await ctx.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`project-stock:${workspaceId}`]);
      await ctx.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`factory-batches:${workspaceId}`]);
      const replay=(await ctx.client.query(`SELECT payload_hash,batch_id FROM project_factory_commands WHERE workspace_id=$1 AND request_id=$2`,[workspaceId,requestId])).rows[0];
      if(replay){if(replay.payload_hash!==hash)throw new ConflictException('Request key already used for a different change.');return {id:replay.batch_id};}
      let id:string;
      if(action==='create'){
        const resourceId=uuid(body.resourceId),ownerId=uuid(body.ownerId);
        if(!Array.isArray(body.tasks)||!body.tasks.length||body.tasks.length>50)throw new BadRequestException('Choose 1–50 tasks.');
        const requested=body.tasks.map(value=>{const item=obj(value);return {projectId:uuid(item.projectId),taskId:str(item.taskId,80,true),revision:item.revision};});
        if(new Set(requested.map(item=>`${item.projectId}:${item.taskId}`)).size!==requested.length)throw new BadRequestException('Choose each task once.');
        const allocations:FactoryAllocation[]=[];
        for(const projectId of [...new Set(requested.map(item=>item.projectId))].sort()){
          const project=await this.execution.row(ctx,projectId,true),data=await this.execution.load(ctx,projectId);
          if(project.status==='archived'||data.phase==='completed'||!commercialExecutionReady(project.commercial))throw new ConflictException('Every project must have released scope and remain open.');
          for(const item of requested.filter(item=>item.projectId===projectId)){
            if(item.revision!==data.revision)throw new ConflictException('Project planning changed. Refresh before grouping tasks.');
            const task=data.tasks.find(task=>task.id===item.taskId);if(!task)throw new NotFoundException('Factory task no longer exists.');
            assertUnstartedFactoryTask(data,task);
            assertFactoryScope(factoryTaskSnapshot(data,task));
            allocations.push({projectId,projectName:project.name,revision:data.revision,snapshot:factoryTaskSnapshot(data,task)});
          }
        }
        assertCompatibleFactoryTasks(allocations,resourceId);
        // Lock resources after project rows, matching the existing booking command order.
        const resource=(await ctx.client.query(`SELECT name FROM project_resources WHERE workspace_id=$1 AND id=$2 AND active AND kind='factory' FOR SHARE`,[workspaceId,resourceId])).rows[0];
        const owner=(await ctx.client.query(`SELECT u.display_name AS name FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.id=$2 AND m.status='active' FOR SHARE OF m`,[workspaceId,ownerId])).rows[0];
        if(!resource||!owner)throw new ConflictException('Choose an active factory and responsible member.');
        for(const item of allocations){const conflict=await ctx.client.query(`SELECT 1 FROM project_factory_allocations WHERE workspace_id=$1 AND project_id=$2 AND task_id=$3 AND active`,[workspaceId,item.projectId,item.snapshot.taskId]);if(conflict.rowCount)throw new ConflictException('A selected task already belongs to a factory batch.');}
        id=randomUUID();
        const batch:FactoryBatch={id,name:str(body.name,160,true),operation:str(body.operation,160,true),compatibility:str(body.compatibility,2000,true),resourceId,resourceName:resource.name,ownerId,ownerName:owner.name,start:allocations.map(item=>item.snapshot.start).sort()[0],end:allocations.map(item=>item.snapshot.end).sort().at(-1)!,createdBy:ctx.membershipId,createdAt:new Date().toISOString()};
        await ctx.client.query(`INSERT INTO project_factory_batches(id,workspace_id,resource_id,owner_id,content) VALUES($1,$2,$3,$4,$5)`,[id,workspaceId,resourceId,ownerId,JSON.stringify(batch)]);
        for(const item of allocations)await ctx.client.query(`INSERT INTO project_factory_allocations(workspace_id,batch_id,project_id,task_id,snapshot) VALUES($1,$2,$3,$4,$5)`,[workspaceId,id,item.projectId,item.snapshot.taskId,JSON.stringify(item)]);
      }else{
        id=uuid(body.id);
        const row=(await ctx.client.query<{content:FactoryBatch;version:number}>(`SELECT content,version FROM project_factory_batches WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,[workspaceId,id])).rows[0];
        if(!row)throw new NotFoundException('Batch not found.');
        if(row.version!==body.version||row.content.cancelled)throw new ConflictException('Batch changed. Refresh before cancelling.');
        const allocations=(await ctx.client.query<{project_id:string;task_id:string}>(`SELECT project_id,task_id FROM project_factory_allocations WHERE workspace_id=$1 AND batch_id=$2 ORDER BY project_id,task_id`,[workspaceId,id])).rows;
        for(const projectId of [...new Set(allocations.map(item=>item.project_id))]){
          await this.execution.row(ctx,projectId,true);const data=await this.execution.load(ctx,projectId);
          for(const item of allocations.filter(item=>item.project_id===projectId)){const task=data.tasks.find(task=>task.id===item.task_id);if(!task)throw new ConflictException('Restore the missing task before cancelling this batch.');assertUnstartedFactoryTask(data,task);}
        }
        row.content.cancelled={by:ctx.membershipId,at:new Date().toISOString(),reason:str(body.reason,2000,true)};
        await ctx.client.query(`UPDATE project_factory_batches SET content=$3,version=version+1 WHERE workspace_id=$1 AND id=$2`,[workspaceId,id,JSON.stringify(row.content)]);
        await ctx.client.query(`UPDATE project_factory_allocations SET active=false WHERE workspace_id=$1 AND batch_id=$2`,[workspaceId,id]);
      }
      await ctx.client.query(`INSERT INTO project_factory_commands(workspace_id,request_id,payload_hash,batch_id) VALUES($1,$2,$3,$4)`,[workspaceId,requestId,hash,id]);
      return {id};
    });
  }
}
