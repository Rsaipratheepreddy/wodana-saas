import { NextResponse } from 'next/server';
import { authenticatedBackendFetch,applyRotatedSession } from '@/lib/auth/backend-session';
import { UUID } from '@/lib/workspace/workspace-api';
import { itemContext } from '@/lib/commercial/item-context';
import { getServerT } from '@/lib/i18n/server';
export async function GET(request:Request){
  const t = await getServerT();
  const params=new URL(request.url).searchParams,w=params.get('workspaceId')??'',c=params.get('caseId')??'',work=params.get('workId')??'',variant=params.get('variantId')??'';
  if(![w,c,work].every(id=>UUID.test(id))||(variant&&!UUID.test(variant)))return NextResponse.json({message:t('Choose a valid item and variant.')},{status:400});
  const result=await authenticatedBackendFetch(`/workspaces/${w}/commercial/cases/${c}/catalog-item-context?${new URLSearchParams({workId:work})}`);
  const reply=(body:unknown,status=200)=>{const response=NextResponse.json(body,{status});applyRotatedSession(response,result.rotatedSession);response.headers.set('cache-control','no-store');return response;};
  if(!result.upstream?.ok)return reply({message:t('Item materials could not be loaded.')},result.upstream?.status??503);
  const facts=await result.upstream.json();
  return reply(itemContext(facts.catalogs,facts.links,work,variant||undefined));
}
