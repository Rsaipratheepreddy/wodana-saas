"use client";
import {Button,DataGrid,type DataGridColumn} from '@/design-system';
import type {ProjectState,Task} from '@/lib/projects/execution';
import {projectInventory,type ProjectInventory} from '../../../../services/business-core/src/projects/project-inventory';
type Output=ProjectInventory['factory'][number];
/** Output quantities keep factory, transit and site custody distinct. */
export function ProjectFinishedStock({state,onWork,onDelivery}:{state:ProjectState;onWork:(task:Task)=>void;onDelivery:(task:Task)=>void}) {
 const rows=(state.inventory??projectInventory(state.data)).factory;
 const task=(row:Output)=>state.data.tasks.find(t=>t.id===row.taskId)!;
 const columns:DataGridColumn<Output>[]=[
  {id:'title',header:'Factory item',size:260,accessorFn:r=>r.title,meta:{primary:true}},
  {id:'remainingToBuild',header:'To build',accessorFn:r=>r.remainingToBuild},
  {id:'available',header:'Ready at factory',accessorFn:r=>r.available},
  {id:'reserved',header:'Reserved for dispatch',accessorFn:r=>r.reserved},
  {id:'inTransit',header:'In transit',accessorFn:r=>r.inTransit},
  {id:'accepted',header:'Accepted at site',accessorFn:r=>r.accepted},
  {id:'rejected',header:'Rejected',accessorFn:r=>r.rejected},
  {id:'unit',header:'Unit',accessorFn:r=>r.unit},
  {id:'action',header:'Next action',size:185,enableSorting:false,meta:{renderCell:r=><Button size="compact" onPress={()=>r.available>0||r.reserved>0||r.inTransit>0?onDelivery(task(r)):onWork(task(r))}>{r.inTransit>0?'Receive at site':r.available>0||r.reserved>0?'Dispatch to site':'Open factory work'}</Button>}},
 ];
 if(!rows.length)return <p style={{fontSize:13,color:"var(--wd-color-text-secondary)",marginBlock:16}}>Factory output will appear here when manufacturing is planned.</p>;
 return <DataGrid gridLines appearance="card" showToolbar={false} rowNumbers={false} selectable={false} columns={columns} data={rows} getRowId={r=>r.taskId} onRowAction={r=>onWork(task(r))} ariaLabel="Factory finished stock" emptyTitle="No factory work planned" emptyDescription="Choose Make in the item plan to track production and finished stock here."/>;
}
