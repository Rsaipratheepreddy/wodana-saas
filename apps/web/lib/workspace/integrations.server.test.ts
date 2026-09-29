import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'test-token' }) }) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('redirect'); }) }));
vi.mock('@/lib/auth/server', () => ({ ACCESS_COOKIE: 'access', businessApiUrl: (path: string) => path, intelligenceApiUrl: (path: string) => `intelligence:${path}`, getAuthenticatedProfile: async () => ({ memberships: [{ workspaceId: 'workspace', roles: ['owner'] }] }) }));
import { getIntegrationsPageData } from './integrations.server';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('connection status loading', () => {
  it('never replaces failed capability requests with connected sample data', async () => {
    vi.stubEnv('E2E_AUTH_BYPASS', 'false');
    vi.stubGlobal('fetch', vi.fn(async (path: string) => new Response(JSON.stringify(path.endsWith('/workspace') ? { legalEntities: [] } : {}), { status: path.endsWith('/workspace') ? 200 : 503 })));
    const result = await getIntegrationsPageData();
    expect(result.canManage).toBe(false);
    expect(result.loadError).toBeTruthy();
    expect(result.providerCapabilities.providers).toEqual([]);
    expect(result.connections).toEqual([]);
  });
  it('reads which providers Wodana has set up, and leaves it unknown when that fails', async () => {
    vi.stubEnv('E2E_AUTH_BYPASS', 'false');
    const answer = (path: string) => path === 'intelligence:/integrations/providers/readiness'
      ? new Response(JSON.stringify({ google_workspace: true, quickbooks: false, zoho_books: true, whatsapp: false, other: 'x' }))
      : new Response(JSON.stringify(path.endsWith('/workspace') ? { legalEntities: [] } : path.endsWith('capabilities') ? { providers: [] } : []));
    vi.stubGlobal('fetch', vi.fn(async (path: string) => answer(path)));
    expect((await getIntegrationsPageData()).platformReadiness).toEqual({ google_workspace: true, quickbooks: false, zoho_books: true, whatsapp: false });
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.startsWith('intelligence:') ? new Response('', { status: 503 }) : answer(path)));
    expect((await getIntegrationsPageData()).platformReadiness).toBeUndefined();
  });
  it('preserves strict accounting failure behavior', async () => {
    vi.stubEnv('E2E_AUTH_BYPASS', 'false');
    vi.stubGlobal('fetch', vi.fn(async (path: string) => new Response(JSON.stringify({ legalEntities: [] }), { status: path.endsWith('/workspace') ? 200 : 503 })));
    await expect(getIntegrationsPageData(undefined, true)).rejects.toThrow('Accounting connection status');
  });
});
