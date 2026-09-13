import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

import { allowedCasePath } from "@/lib/pre-project/api-path";
async function handle(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const query = new URL(request.url).searchParams;
  const workspaceId = query.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)||!allowedCasePath(path,request.method)) return invalidRequest("Invalid pre-execution resource.");
  query.delete("workspaceId");
  if (query.toString().length > 1500) return invalidRequest("Search is too long.");
  const mutation=request.method!=='GET';
  if(mutation&&!isSameOrigin(request))return NextResponse.json({message:'This request must come from your workspace.'},{status:403});
  const backendPath=`/workspaces/${workspaceId}/pre-projects${path.length?'/'+path.join('/'):''}${query.size?'?'+query:''}`;
  const asset=path[1]==='assets';
  if(asset&&request.method==='GET') {
    const result=await authenticatedBackendFetch(backendPath,{cache:'no-store'});
    if(result.unauthenticated||!result.upstream?.ok) {
      const response=NextResponse.json({message:result.unauthenticated?'Sign in again to open this file.':'The file could not be loaded.'},{status:result.unauthenticated?401:result.upstream?.status??503});applyRotatedSession(response,result.rotatedSession);return response;
    }
    const response=new NextResponse(result.upstream.body,{headers:{'content-type':result.upstream.headers.get('content-type')??'application/octet-stream','content-disposition':result.upstream.headers.get('content-disposition')??'attachment','cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'"}});
    applyRotatedSession(response,result.rotatedSession);return response;
  }
  if(asset) {
    if(Number(request.headers.get('content-length'))>21*1024*1024)return invalidRequest('Choose a file up to 20 MB.');
    try {
      const input=await request.formData();const file=input.get('file');
      if(!(file instanceof File)||file.size>20*1024*1024||file.size===0)return invalidRequest('Choose an image or PDF up to 20 MB.');
      const body=new FormData();body.set('file',file);
      return workspaceJsonResponse(backendPath,{method:'POST',body},'The file could not be uploaded.');
    }catch{return invalidRequest('Choose a valid file.');}
  }
  let body:string|undefined;
  if(mutation) {
    const text=await request.text();if(text.length>1_000_000)return invalidRequest('Request is too large.');
    try{const input=JSON.parse(text);if(!input||typeof input!=='object'||Array.isArray(input))return invalidRequest('Invalid request.');body=JSON.stringify(input);}catch{return invalidRequest('Invalid JSON request.');}
  }
  return workspaceJsonResponse(backendPath,{method:request.method,headers:{'content-type':'application/json'},body},'The pre-execution request could not be completed.');
}
export {handle as GET,handle as POST,handle as PUT,handle as PATCH};
