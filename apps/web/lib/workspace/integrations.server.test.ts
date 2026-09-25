import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'test-token' }) }) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('redirect'); }) }));
vi.mock('@/lib/auth/server', () => ({ ACCESS_COOKIE: 'access', businessApiUrl: (path: string) => path, getAuthenticatedProfile: async () => ({ memberships: [{ workspaceId: 'workspace', roles: ['owner'] }] }) }));
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
  it('preserves strict accounting failure behavior', async () => {
    vi.stubEnv('E2E_AUTH_BYPASS', 'false');
    vi.stubGlobal('fetch', vi.fn(async (path: string) => new Response(JSON.stringify({ legalEntities: [] }), { status: path.endsWith('/workspace') ? 200 : 503 })));
    await expect(getIntegrationsPageData(undefined, true)).rejects.toThrow('Accounting connection status');
  });
});
