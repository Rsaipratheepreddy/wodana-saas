import {NextResponse} from 'next/server';
import {authenticatedBackendFetch,applyRotatedSession} from '@/lib/auth/backend-session';
import {UUID} from '@/lib/workspace/workspace-api';
import {getServerT} from '@/lib/i18n/server';
export async function GET(request:Request){const t=await getServerT();const p=new URL(request.url).searchParams,w=p.get('workspaceId')??'',c=p.get('caseId')??'';if(!UUID.test(w)||!UUID.test(c))return NextResponse.json({message:t('Choose a valid case.')},{status:400});const result=await authenticatedBackendFetch(`/workspaces/${w}/commercial/cases/${c}/master-catalog`);const data=result.upstream?.ok?await result.upstream.json():null;const response=NextResponse.json(data?data:{message:t('Master Data could not be loaded.')},{status:data?200:result.upstream?.status??503});applyRotatedSession(response,result.rotatedSession);response.headers.set('cache-control','no-store');return response;}
