import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('@/lib/i18n/server', async () => { const { translator } = await import('@/lib/i18n/messages'); return { getServerT: async () => translator('en'), getServerLanguage: async () => 'en' }; });
const forward=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/workspace/workspace-api',()=>({UUID:/^[0-9a-f-]{36}$/,workspaceJsonResponse:forward}));
import {GET} from './route';
const workspaceId='11111111-1111-4111-8111-111111111111';
describe('factory capacity proxy',()=>{
 beforeEach(()=>forward.mockReset());
 it.each(['from=2026-02-30&to=2026-03-01','from=2026-09-23&to=2026-09-22','from=2026-01-01&to=2026-12-31','from=bad&to=bad'])('rejects invalid date range %s',async range=>{
  const response=await GET(new Request(`http://localhost/api/project-capacity?workspaceId=${workspaceId}&${range}`));
  expect(response.status).toBe(400);expect(forward).not.toHaveBeenCalled();
 });
 it('forwards only supported query parameters through the authenticated helper',async()=>{
  forward.mockResolvedValue(new Response('{}'));
  await GET(new Request(`http://localhost/api/project-capacity?workspaceId=${workspaceId}&from=2026-09-22&to=2026-09-23&includePrivate=true`));
  expect(forward).toHaveBeenCalledWith(`/workspaces/${workspaceId}/projects/schedule/availability?from=2026-09-22&to=2026-09-23`,{method:'GET'},expect.any(String));
 });
});
