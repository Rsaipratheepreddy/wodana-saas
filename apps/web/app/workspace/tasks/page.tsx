import {GlobalApprovalTasks} from '@/components/projects/global-approval-tasks';
import {GlobalProjectWork,taskBoardRow} from '@/components/projects/global-project-work';
import type {WorkQueuePage} from '../../../../../services/business-core/src/projects/project-work-queue';
import type {TaskBoardPage} from '../../../../../services/business-core/src/projects/project-task-board';
import {projectRead} from '@/lib/projects/server';
import {getAuthenticatedProfile} from '@/lib/auth/server';
import type {ApprovalQueuePage} from '../../../../../services/business-core/src/projects/project-approval-queue';
export default async function TasksPage({searchParams}:{searchParams:Promise<{tab?:string}>}){
 const profile=await getAuthenticatedProfile();const workspace=profile.memberships[0];
 if((await searchParams).tab!=='approvals'){
  let initial:WorkQueuePage={rows:[],nextCursor:null,memberId:''},error='';
  try{const board=(await projectRead<TaskBoardPage>('task-board?view=mine')).data;initial={...board,rows:board.rows.map(taskBoardRow)};}catch{error='Tasks could not be loaded. Check your access or retry.';}
  return <GlobalProjectWork workspaceId={workspace?.workspaceId??''} initial={initial} initialError={error} showSales={workspace?.allowedModules.includes('crm')}/>;
 }
 let initial:ApprovalQueuePage={rows:[],nextCursor:null,memberId:'',canReview:false},error='';
 try{initial=(await projectRead<ApprovalQueuePage>('approvals?view=mine')).data;}catch{error='Project approvals could not be loaded. Check your access or retry.';}
 return <GlobalApprovalTasks workspaceId={workspace?.workspaceId??''} initial={initial} initialError={error} showSales={workspace?.allowedModules.includes('crm')}/>;
}
