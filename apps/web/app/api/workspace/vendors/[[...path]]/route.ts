import {invalidRequest,isSameOrigin,UUID,workspaceJsonResponse} from '@/lib/workspace/workspace-api';
import { getServerT } from '@/lib/i18n/server';
async function handle(request:Request,{params}:{params:Promise<{path?:string[]}>}) {
 const t = await getServerT();
 const {path=[]}=await params, query=new URL(request.url).searchParams,w=query.get('workspaceId')??'',method=request.method;
 const bulk=path.length===1&&path[0]==='import'&&method==='POST';
 const valid=bulk||(!path.length&&['GET','POST'].includes(method))||(path.length===1&&UUID.test(path[0])&&['GET','PATCH'].includes(method))||(path.length===2&&UUID.test(path[0])&&['sites','lifecycle'].includes(path[1])&&method==='POST')||(path.length===3&&UUID.test(path[0])&&path[1]==='sites'&&UUID.test(path[2])&&method==='PATCH');
 if(!UUID.test(w)||!valid)return invalidRequest(t('Invalid supplier resource.'));
 if(method!=='GET'&&!isSameOrigin(request))return new Response(null,{status:403});
 const qs=new URLSearchParams();for(const key of ['search','cursor','status']){const value=query.get(key);if(value)qs.set(key,value);}qs.set('limit','100');
 const body=method==='GET'?undefined:await request.text();if(body&&body.length>(bulk?1_000_000:20000))return invalidRequest(t('Supplier update is too large.'));
 return workspaceJsonResponse(`/workspaces/${w}/vendors${path.length?'/'+path.join('/'):''}${method==='GET'?'?'+qs:''}`,{method,headers:{'content-type':'application/json'},body},t('Could not update suppliers.'));
}
export {handle as GET,handle as POST,handle as PATCH};
