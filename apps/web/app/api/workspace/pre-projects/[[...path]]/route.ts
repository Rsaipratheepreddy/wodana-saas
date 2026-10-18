import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

import { allowedCasePath } from "@/lib/pre-project/api-path";
import { getServerT } from "@/lib/i18n/server";
async function handle(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const t = await getServerT();
  const { path = [] } = await params;
  const query = new URL(request.url).searchParams;
  const workspaceId = query.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)||!allowedCasePath(path,request.method)) return invalidRequest(t("Invalid planning resource."));
  query.delete("workspaceId");
  if (query.toString().length > 1500) return invalidRequest(t("Search is too long."));
  const mutation=request.method!=='GET';
  if(mutation&&!isSameOrigin(request))return NextResponse.json({message:t('This request must come from your workspace.')},{status:403});
  const backendPath=`/workspaces/${workspaceId}/pre-projects${path.length?'/'+path.join('/'):''}${query.size?'?'+query:''}`;
  // A case file (read or upload); the finishes schedule's own upload (a sample photo, a render snapshot, a signed sample) too.
  const asset=(path[1]==='assets' && path.length===3)||(path[1]==='finishes'&&path[2]==='assets'&&path.length===4);
  if(asset&&request.method==='GET') {
    const result=await authenticatedBackendFetch(backendPath,{cache:'no-store'});
    if(result.unauthenticated||!result.upstream?.ok) {
      const response=NextResponse.json({message:result.unauthenticated?t('Sign in again to open this file.'):t('The file could not be loaded.')},{status:result.unauthenticated?401:result.upstream?.status??503});applyRotatedSession(response,result.rotatedSession);return response;
    }
    const upstreamContentType = result.upstream.headers.get('content-type') ?? 'application/octet-stream';
    const isPdfView = query.get('view') === '1' && upstreamContentType.includes('pdf');
    const upstreamDisposition = result.upstream.headers.get('content-disposition') ?? (isPdfView ? 'inline' : 'attachment');
    const csp = isPdfView
      ? (result.upstream.headers.get('content-security-policy') ?? "default-src 'self' data: blob:; style-src 'unsafe-inline'")
      : "sandbox; default-src 'none'";
    const response = new NextResponse(result.upstream.body, {
      headers: {
        'content-type': upstreamContentType,
        'content-disposition': upstreamDisposition,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': csp,
      },
    });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if(asset) {
    if(Number(request.headers.get('content-length'))>21*1024*1024)return invalidRequest(t('Choose a file up to 20 MB.'));
    try {
      const input=await request.formData();const file=input.get('file');
      if(!(file instanceof File)||file.size>20*1024*1024||file.size===0)return invalidRequest(t('Choose an image or PDF up to 20 MB.'));
      const body=new FormData();body.set('file',file);
      return workspaceJsonResponse(backendPath,{method:'POST',body},t('The file could not be uploaded.'));
    }catch{return invalidRequest(t('Choose a valid file.'));}
  }
  let body:string|undefined;
  if(mutation) {
    const text=await request.text();if(text.length>1_000_000)return invalidRequest(t('Request is too large.'));
    try{const input=JSON.parse(text);if(!input||typeof input!=='object'||Array.isArray(input))return invalidRequest(t('Invalid request.'));body=JSON.stringify(input);}catch{return invalidRequest(t('Invalid JSON request.'));}
  }
  return workspaceJsonResponse(backendPath,{method:request.method,headers:{'content-type':'application/json'},body},t('The planning request could not be completed.'));
}
export {handle as GET,handle as POST,handle as PUT,handle as PATCH};
