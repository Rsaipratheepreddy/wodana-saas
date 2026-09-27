import {NextResponse} from 'next/server';
import {UUID,workspaceJsonResponse} from '@/lib/workspace/workspace-api';
import { getServerT } from '@/lib/i18n/server';

export async function GET(request:Request) {
  const t = await getServerT();
  const input=new URL(request.url).searchParams,workspaceId=input.get('workspaceId')??'';
  const from=input.get('from')??'',to=input.get('to')??'',resourceId=input.get('resourceId');
  const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  if(!UUID.test(workspaceId)||!validDate(from)||!validDate(to)||to<from||(Date.parse(to)-Date.parse(from))/86400000>93||(resourceId&&!UUID.test(resourceId)))return NextResponse.json({message:t('Choose a valid workspace and date range of 93 days or less.')},{status:400});
  const query=new URLSearchParams({from,to});if(resourceId)query.set('resourceId',resourceId);
  return workspaceJsonResponse(`/workspaces/${workspaceId}/projects/schedule/availability?${query}` ,{method:'GET'},t('Could not load factory capacity.'));
}
