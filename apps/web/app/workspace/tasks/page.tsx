import {GlobalApprovalTasks} from '@/components/projects/global-approval-tasks';
import {GlobalProjectWork} from '@/components/projects/global-project-work';
import type {WorkQueuePage} from '../../../../../services/business-core/src/projects/project-work-queue';
import {projectRead} from '@/lib/projects/server';
import {getAuthenticatedProfile} from '@/lib/auth/server';
import type {ApprovalQueuePage} from '../../../../../services/business-core/src/projects/project-approval-queue';
export default async function TasksPage({searchParams}:{searchParams:Promise<{tab?:string}>}){
 const profile=await getAuthenticatedProfile();const workspace=profile.memberships[0];
 if((await searchParams).tab!=='approvals'){
  let initial:WorkQueuePage={rows:[],nextCursor:null,memberId:''},error='';
  try{initial=(await projectRead<WorkQueuePage>('work-queue?view=mine')).data;}catch{error='Project work could not be loaded. Check your access or retry.';}
  return <GlobalProjectWork workspaceId={workspace?.workspaceId??''} initial={initial} initialError={error} showSales={workspace?.allowedModules.includes('crm')}/>;
 }
 let initial:ApprovalQueuePage={rows:[],nextCursor:null,memberId:'',canReview:false},error='';
 try{initial=(await projectRead<ApprovalQueuePage>('approvals?view=mine')).data;}catch{error='Project approvals could not be loaded. Check your access or retry.';}
 return <GlobalApprovalTasks workspaceId={workspace?.workspaceId??''} initial={initial} initialError={error} showSales={workspace?.allowedModules.includes('crm')}/>;
}
