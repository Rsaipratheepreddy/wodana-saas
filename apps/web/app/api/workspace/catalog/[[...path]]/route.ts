import { invalidRequest,isSameOrigin,UUID,workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";
async function handle(request:Request,{params}:{params:Promise<{path?:string[]}>}) {
 const t = await getServerT();
 const {path=[]}=await params; const workspaceId=new URL(request.url).searchParams.get("workspaceId")??"";
 const route=path.join("/");
 const valid=(request.method==="GET"&&!route)||(request.method==="PUT"&&route==="records")||(request.method==="PATCH"&&path.length===2&&path[0]==="records"&&UUID.test(path[1]))||(request.method==="POST"&&["starter","collections","organize","import","preview"].includes(route));
 if(!UUID.test(workspaceId)||!valid) return invalidRequest(t("Invalid catalog resource."));
 let body:string|undefined;
 if(request.method!=="GET") {
  if(!isSameOrigin(request)) return Response.json({message:t("This request must come from your workspace.")},{status:403});
  // Bound the stream as well as Content-Length; chunked requests have no reliable header.
  const reader=request.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
  if(reader) while(true) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>(route==="import"?1500000:80000)){await reader.cancel();return invalidRequest(t("Catalog record is too large."));}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  body=new TextDecoder().decode(bytes)||"{}";
  try { const parsed=JSON.parse(body);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return invalidRequest(t("Invalid catalog request.")); }catch{return invalidRequest(t("Invalid JSON request."));}
 }
 const query = new URL(request.url).searchParams;
 const selectedCatalog = query.get('catalogId');
 if (selectedCatalog && !UUID.test(selectedCatalog)) return invalidRequest(t('Invalid catalog identifier.'));
 const suffix = request.method === 'GET' && selectedCatalog ? `?catalogId=${selectedCatalog}` : '';
 return workspaceJsonResponse(`/workspaces/${workspaceId}/catalog${route?`/${route}`:""}${suffix}`,{method:request.method,headers:{"content-type":"application/json"},body},t("The catalog request could not be completed."));
}
export { handle as GET,handle as PUT,handle as PATCH,handle as POST };
