import {NextResponse} from 'next/server';
import {UUID,isSameOrigin,workspaceJsonResponse} from '@/lib/workspace/workspace-api';
export async function GET(request:Request){
 const query=new URL(request.url).searchParams,workspaceId=query.get('workspaceId')??'',projectId=query.get('projectId');
 if(!UUID.test(workspaceId)||(projectId&&!UUID.test(projectId)))return NextResponse.json({message:'Invalid workspace or project.'},{status:400});
 return workspaceJsonResponse(`/workspaces/${workspaceId}/projects/factory-batches${projectId?`?projectId=${projectId}`:''}`,{method:'GET'},'Could not load factory batches.');
}
export async function POST(request:Request){
 if(!isSameOrigin(request))return NextResponse.json({message:'Cross-origin request rejected.'},{status:403});
 const workspaceId=new URL(request.url).searchParams.get('workspaceId')??'';
 if(!UUID.test(workspaceId))return NextResponse.json({message:'Invalid workspace.'},{status:400});
 const body=await request.json().catch(()=>null);
 if(!body||!['create','cancel'].includes(body.action))return NextResponse.json({message:'Invalid batch action.'},{status:400});
 return workspaceJsonResponse(`/workspaces/${workspaceId}/projects/factory-batches`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},'Could not save factory batch.');
}
