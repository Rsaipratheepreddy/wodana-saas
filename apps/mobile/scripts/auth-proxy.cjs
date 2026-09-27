const COOKIE = 'wodana_mobile_refresh';
const PLACEHOLDER = 'http-only-cookie';
const routes = new Map([
  ['/auth/login', 'POST'], ['/auth/mfa/verify', 'POST'], ['/auth/refresh', 'POST'], ['/auth/logout', 'POST'],
  ['/auth/password/forgot', 'POST'], ['/auth/organization/resolve', 'POST'], ['/me', 'GET'],
]);

function cookieValue(header = '') {
  const value = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  return value ? decodeURIComponent(value.slice(COOKIE.length + 1)) : undefined;
}
function cookie(value, maxAge, secure) {
  return `${COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=${Math.max(0, Math.floor(maxAge))}${secure ? '; Secure' : ''}`;
}
function send(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(payload));
}
async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 16384) throw new Error('Request is too large');
  }
  const value = JSON.parse(body || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request');
  return value;
}

/** Browser preview BFF. Real refresh tokens never enter browser JavaScript. */
function createAuthProxy({ target, fetcher = fetch }) {
  const upstreamBase = new URL(target);
  if (!['http:', 'https:'].includes(upstreamBase.protocol)) throw new Error('Invalid auth API URL');
  return async (request, response, next) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    const pathname = requestUrl.pathname;
    if (!pathname.startsWith('/api/v1/')) return next();
    const path = pathname.slice('/api/v1'.length);
    const workspaceRoute = allowedWorkspaceRoute(path,request.method);
    const publicLogoRoute = request.method === 'GET' && /^\/public\/tenant-branding\/[a-z0-9]+(?:-[a-z0-9]+)*\/logo$/.test(path);
    const tenantBrandingRoute = request.method === 'GET' && /^\/auth\/tenant\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path);
    if (!workspaceRoute && !publicLogoRoute && !tenantBrandingRoute && (!routes.has(path) || routes.get(path) !== request.method)) return send(response, 404, { message: 'Not found' });
    const secure = !!request.socket.encrypted;
    const origin = `${secure ? 'https' : 'http'}://${request.headers.host}`;
    if ((request.headers.origin && request.headers.origin !== origin)
      || request.headers['sec-fetch-site'] === 'cross-site') return send(response, 403, { message: 'Origin not allowed' });
    if(workspaceRoute)return proxyWorkspace(request,response,target,fetcher,path+requestUrl.search);
    if(publicLogoRoute)return proxyPublicLogo(response,target,fetcher,path);
    let body;
    try {
      if (request.method === 'POST') {
        if (!request.headers['content-type']?.startsWith('application/json')) return send(response, 415, { message: 'JSON is required' });
        body = await readBody(request);
        if (path === '/auth/refresh' || path === '/auth/logout') {
          const refreshToken = cookieValue(request.headers.cookie);
          if (!refreshToken) {
            response.setHeader('Set-Cookie', cookie('', 0, secure));
            return send(response, path === '/auth/logout' ? 200 : 401, path === '/auth/logout' ? { signedOut: true } : { message: 'Session expired' });
          }
          body = { refreshToken };
        }
      }
    } catch { return send(response, 400, { message: 'Invalid request' }); }
    try {
      const upstream = await fetcher(`${target.replace(/\/$/, '')}${path}`, {
        method: request.method, redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: {
          accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}),
          ...(path === '/me' && request.headers.authorization ? { authorization: request.headers.authorization } : {}),
          'user-agent': request.headers['user-agent'] ?? 'Wodana Mobile Preview',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await upstream.json().catch(() => ({ message: 'Authentication is unavailable' }));
      if (path === '/auth/logout' || (path === '/auth/refresh' && upstream.status === 401)) {
        response.setHeader('Set-Cookie', cookie('', 0, secure));
      }
      if (upstream.ok && (path === '/auth/login' || path === '/auth/mfa/verify' || path === '/auth/refresh')
        && payload.mfaRequired !== true && payload.workspaceSelectionRequired !== true) {
        if (typeof payload.refreshToken !== 'string' || !payload.refreshToken
          || !Number.isFinite(payload.refreshTokenExpiresIn) || payload.refreshTokenExpiresIn <= 0) {
          return send(response, 502, { message: 'Invalid session response' });
        }
        response.setHeader('Set-Cookie', cookie(payload.refreshToken, payload.refreshTokenExpiresIn, secure));
        payload.refreshToken = PLACEHOLDER;
      }
      // Development reset tokens are server-only, even when enabled upstream.
      delete payload.developmentResetToken;
      return send(response, upstream.status, payload);
    } catch {
      if (path === '/auth/logout') response.setHeader('Set-Cookie', cookie('', 0, secure));
      return send(response, 503, { message: 'Authentication is unavailable' });
    }
  };
}
async function proxyPublicLogo(response,target,fetcher,path){
  try {
    const upstream=await fetcher(`${target.replace(/\/$/,'')}${path}`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(12000)});
    response.writeHead(upstream.status,{
      'Content-Type':upstream.headers.get('content-type')??'application/octet-stream',
      'Cache-Control':upstream.ok?'public, max-age=3600':'no-store',
      'X-Content-Type-Options':'nosniff',
    });
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch { return send(response,503,{message:'The organization logo is unavailable.'}); }
}
// The staff app's API areas. The server authorises every request; this only keeps the preview
// proxy from becoming a general gateway to other workspace endpoints (settings, members, billing).
const APP_AREAS = new Set(['crm', 'hrms', 'projects', 'project-core', 'site', 'pre-projects', 'purchasing', 'inventory', 'factory', 'petty-cash', 'home-overview']);
function allowedWorkspaceRoute(path, method) {
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
  const match = path.match(/^\/workspaces\/[0-9a-f-]{36}\/([a-z-]+)(?:\/([^?]*))?$/);
  if (!match || path.includes('..') || path.includes('//')) return false;
  return APP_AREAS.has(match[1]);
}
async function proxyWorkspace(request,response,target,fetcher,path){
 if(!request.headers.authorization)return send(response,401,{message:'Sign in to continue.'});
 try{
  let body;const contentType=request.headers['content-type'];
  if(request.method!=='GET'){
   if(!contentType?.startsWith('application/json')&&!contentType?.startsWith('multipart/form-data'))return send(response,415,{message:'JSON or a file upload is required.'});
   const chunks=[];let size=0;const max=contentType.startsWith('multipart/form-data')?21*1024*1024:2*1024*1024;
   for await(const chunk of request){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>max)return send(response,413,{message:'Capture is too large.'});chunks.push(bytes);}body=Buffer.concat(chunks);
  }
  const upstream=await fetcher(`${target.replace(/\/$/,'')}${path}`,{method:request.method,redirect:'error',signal:AbortSignal.timeout(60000),headers:{authorization:request.headers.authorization,...(body?{'content-type':contentType}:{})},body});
  response.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')??'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
  response.end(Buffer.from(await upstream.arrayBuffer()));
 }catch{return send(response,503,{message:'The workspace service is unavailable. Please try again.'});}
}
module.exports = { createAuthProxy, allowedWorkspaceRoute };
