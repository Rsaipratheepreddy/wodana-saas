import {beforeEach,describe,expect,it,vi} from 'vitest';
const forward=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/workspace/workspace-api',()=>({UUID:/^[0-9a-f-]{36}$/,isSameOrigin:(request:Request)=>request.headers.get('origin')!=='https://other.test',workspaceJsonResponse:forward}));
import {GET,POST} from './route';
const w='11111111-1111-4111-8111-111111111111',p='22222222-2222-4222-8222-222222222222';
describe('factory batch proxy',()=>{
 beforeEach(()=>forward.mockReset());
 it('preserves project scoping and discards unrelated parameters',async()=>{
  forward.mockResolvedValue(new Response('{}'));await GET(new Request(`http://localhost/api/factory-batches?workspaceId=${w}&projectId=${p}&all=true`));
  expect(forward).toHaveBeenCalledWith(`/workspaces/${w}/projects/factory-batches?projectId=${p}`,{method:'GET'},expect.any(String));
 });
 it('rejects invalid IDs and cross-origin commands',async()=>{
  expect((await GET(new Request(`http://localhost/api/factory-batches?workspaceId=${w}&projectId=bad`))).status).toBe(400);
  expect((await POST(new Request(`http://localhost/api/factory-batches?workspaceId=${w}`,{method:'POST',headers:{origin:'https://other.test'}}))).status).toBe(403);
  expect(forward).not.toHaveBeenCalled();
 });
 it('passes a supported mutation through the authenticated helper',async()=>{
  const body={action:'create',name:'Wardrobes'};forward.mockResolvedValue(new Response('{}'));
  await POST(new Request(`http://localhost/api/factory-batches?workspaceId=${w}`,{method:'POST',body:JSON.stringify(body)}));
  expect(forward).toHaveBeenCalledWith(`/workspaces/${w}/projects/factory-batches`,expect.objectContaining({method:'POST',body:JSON.stringify(body)}),expect.any(String));
 });
});
