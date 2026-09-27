import { NextResponse } from 'next/server';
import { applyRotatedSession, authenticatedBackendFetch } from '@/lib/auth/backend-session';
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from '@/lib/workspace/workspace-api';
import { getServerT } from '@/lib/i18n/server';

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const query = new URL(request.url).searchParams;
  const workspaceId = query.get('workspaceId') ?? '';
  if (!UUID.test(workspaceId) || path.length !== 5 || !['lead', 'case'].includes(path[0]) || path[3] !== 'assets' || ![path[1], path[2], path[4]].every(id => UUID.test(id))) return invalidRequest(t('Invalid requirement file.'));
  const backendPath = `/workspaces/${workspaceId}/requirement-notes/${path.join('/')}${query.get('preview') === '1' ? '?preview=1' : ''}`;
  if (request.method === 'GET') {
    const range = request.headers.get('range');
    const result = await authenticatedBackendFetch(backendPath, { cache: 'no-store', ...(range ? { headers: { range } } : {}) });
    if (result.unauthenticated || !result.upstream?.ok) {
      const response = NextResponse.json({ message: result.unauthenticated ? t('Sign in again to open this file.') : t('The file could not be loaded.') }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
      applyRotatedSession(response, result.rotatedSession);
      return response;
    }
    const response = new NextResponse(result.upstream.body, { status: result.upstream.status, headers: { 'content-type': result.upstream.headers.get('content-type') ?? 'application/octet-stream', 'content-disposition': result.upstream.headers.get('content-disposition') ?? 'attachment', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'", ...Object.fromEntries(['accept-ranges', 'content-range', 'content-length'].flatMap(name => { const value = result.upstream!.headers.get(name); return value ? [[name, value]] : []; })) } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (!isSameOrigin(request)) return NextResponse.json({ message: t('This request must come from your workspace.') }, { status: 403 });
  if (Number(request.headers.get('content-length')) > 21 * 1024 * 1024) return invalidRequest(t('Choose a file up to 20 MB.'));
  try {
    const input = await request.formData(), file = input.get('file');
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024) return invalidRequest(t('Choose an image, PDF or MP4/WebM video up to 20 MB.'));
    const body = new FormData();
    body.set('file', file);
    return workspaceJsonResponse(backendPath, { method: 'POST', body }, t('The reference file could not be uploaded.'));
  } catch { return invalidRequest(t('Choose a valid file.')); }
}

export { handle as GET, handle as POST };
