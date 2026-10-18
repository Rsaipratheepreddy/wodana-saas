import {NextResponse} from 'next/server';
import {getIntegrationsPageData} from '@/lib/workspace/integrations.server';
import {UUID,invalidRequest} from '@/lib/workspace/workspace-api';
import { getServerT } from '@/lib/i18n/server';

export async function GET(request:Request) {
 const t = await getServerT();
 const workspaceId=new URL(request.url).searchParams.get('workspaceId')??'';
 if(!UUID.test(workspaceId)) return invalidRequest(t('A valid workspace is required.'));
 const data=await getIntegrationsPageData(workspaceId,true);
 const accounting=new Set(['quickbooks','zoho_books']);
 return NextResponse.json({...data,connections:data.connections.filter(c=>accounting.has(c.provider)),providerCapabilities:{...data.providerCapabilities,providers:data.providerCapabilities.providers.filter(p=>accounting.has(p.id))}},{headers:{'cache-control':'no-store'}});
}
