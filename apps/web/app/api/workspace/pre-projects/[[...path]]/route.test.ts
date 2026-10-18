import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('@/lib/i18n/server', async () => { const { translator } = await import('@/lib/i18n/messages'); return { getServerT: async () => translator('en'), getServerLanguage: async () => 'en' }; });
import {NextResponse} from 'next/server';
vi.mock('@/lib/auth/backend-session',()=>({applyRotatedSession:vi.fn(),authenticatedBackendFetch:vi.fn()}));
vi.mock('@/lib/workspace/workspace-api',()=>({UUID:/^[0-9a-f-]{36}$/i,isSameOrigin:(r:Request)=>r.headers.get('origin')==='http://localhost',invalidRequest:(message:string)=>NextResponse.json({message},{status:400}),workspaceJsonResponse:vi.fn()}));
import {workspaceJsonResponse} from '@/lib/workspace/workspace-api';
import {GET,POST} from './route';
const id='11111111-1111-4111-8111-111111111111',asset='22222222-2222-4222-8222-222222222222';
const url=`http://localhost/api/workspace/pre-projects/${id}/assets/${asset}/markup?workspaceId=${id}`;
const params={params:Promise.resolve({path:[id,'assets',asset,'markup']})};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(workspaceJsonResponse).mockResolvedValue(NextResponse.json({id:asset}));});
it('forwards saved strokes as JSON rather than treating markup as a file upload',async()=>{
 const body={id:asset,strokes:[{color:'#2063b6',width:.004,points:[{x:.2,y:.4}]}]};
 expect((await POST(new Request(url,{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify(body)}),params)).status).toBe(200);
 expect(workspaceJsonResponse).toHaveBeenCalledWith(`/workspaces/${id}/pre-projects/${id}/assets/${asset}/markup`,expect.objectContaining({method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'}}),expect.any(String));
});
it('loads markup metadata through the JSON response path',async()=>{await GET(new Request(url),params);expect(workspaceJsonResponse).toHaveBeenCalledWith(expect.stringContaining('/markup'),expect.objectContaining({method:'GET'}),expect.any(String));});
it('keeps same-origin protection for drawing mutations',async()=>{expect((await POST(new Request(url,{method:'POST',body:'{}'}),params)).status).toBe(403);expect(workspaceJsonResponse).not.toHaveBeenCalled();});
