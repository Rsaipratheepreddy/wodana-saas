export type TenantModuleId = 'workspace' | 'crm' | 'pre-project' | 'projects' | 'hrms';
export type Membership = {
  workspaceId: string; workspaceSlug: string; workspaceName: string; workspaceStatus: string;
  workspaceLogoUrl: string | null; workspacePrimaryColor: string | null; workspaceSecondaryColor: string | null;
  workspaceHeadingFont: string | null; workspaceBodyFont: string | null;
  accountName?: string | null; status: string; roles: string[]; allowedModules: TenantModuleId[];
  billingAccess?: {
    state: 'not_configured' | 'trial' | 'trial_expired' | 'current' | 'grace' | 'past_due' | 'collections' | 'suspended' | 'closed';
    effect: 'unchanged'; warning: boolean; actionDueAt: string | null; affectedModules: []; message: string;
  };
};
export type Profile = {
  id: string; primaryEmail: string; displayName: string; status: string;
  memberships: Membership[]; nextAction: string;
  unavailableOrganizations?: Array<{ workspaceId: string; workspaceName: string; workspaceStatus: string }>;
};
export type AuthState =
  | { status: 'checking' | 'authenticating' }
  | { status: 'mfa' }
  | { status: 'signedOut'; message?: string }
  | { status: 'unavailable'; message: string }
  | { status: 'signedIn'; profile: Profile; workspaceId: string };
export type SessionStorage = { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void> };
type SavedSession = { version: 1; scope: string; refreshToken: string; refreshExpiresAt: number; workspaceId: string };
type Session = SavedSession & { accessToken: string; accessExpiresAt: number };
type Options = { baseUrl: string; tenantSlug: string; storage: SessionStorage; fetch?: typeof fetch; now?: () => number; credentials?: RequestCredentials; timeoutMs?: number };

export class AuthError extends Error {
  constructor(message: string, public code: 'credentials' | 'expired' | 'network' | 'server' | 'storage' | 'cancelled' | 'access' | 'configuration') { super(message); }
}
export class ApiError extends Error { constructor(message:string, public status:number, public issues:string[]=[]){super(message);} }
const cancelled = () => new AuthError('Sign-in was cancelled.', 'cancelled');
const expired = () => new AuthError('Your session has expired. Sign in again.', 'expired');
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';

/** One owner for token rotation and storage. Access tokens stay in memory. */
export class AuthClient {
  private state: AuthState = { status: 'checking' };
  private listeners = new Set<() => void>();
  private session: Session | null = null;
  private epoch = 0;
  private rotation: Promise<Session> | null = null;
  private accessRevalidation: Promise<void> | null = null;
  private restoration: Promise<void> | null = null;
  private storageWork: Promise<unknown> = Promise.resolve();
  private readonly base: string;
  private scope: string;
  private tenant: string;
  private challenge: { token: string; workspaceId: string } | null = null;
  private readonly now: () => number;
  private readonly fetcher: typeof fetch;

  constructor(private options: Options) {
    this.base = options.baseUrl.replace(/\/$/, '');
    this.tenant = options.tenantSlug;
    this.scope = `${this.base}|${this.tenant}`;
    this.now = options.now ?? Date.now;
    this.fetcher = options.fetch ?? fetch.bind(globalThis);
  }
  getSnapshot = (): AuthState => this.state;
  get tenantSlug() { return this.tenant; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: AuthState) { this.state = state; this.listeners.forEach((listener) => listener()); }
  private selectTenant(value: string) {
    const slug = value.trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
      throw new AuthError('Enter a valid workspace code.', 'configuration');
    }
    if (this.options.tenantSlug && slug !== this.options.tenantSlug) {
      throw new AuthError('This app is configured for a different workspace.', 'access');
    }
    this.tenant = slug;
    this.scope = `${this.base}|${slug}`;
  }
  private writeStorage(operation: () => Promise<void>) {
    const next = this.storageWork.catch(() => {}).then(operation);
    this.storageWork = next;
    return next;
  }
  private async request(path: string, body?: unknown, token?: string, api?:{method:string;binary?:boolean}): Promise<unknown> {
    let url: URL | null = null;
    try { url = new URL(this.base); } catch { /* report configuration error below */ }
    const local = url && ['localhost', '127.0.0.1', '[::1]', '10.0.2.2'].includes(url.hostname);
    if (!path.startsWith('/') || path.startsWith('//') || !url
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) {
      throw new AuthError('Authentication is not configured for this build.', 'configuration');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? (api ? 60000 : 15000));
    try {
      const response = await this.fetcher(`${this.base}${path}`, {
        method: api?.method ?? (body === undefined ? 'GET' : 'POST'),
        headers: { accept: 'application/json', ...(body === undefined || body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
        credentials: this.options.credentials ?? 'omit', signal: controller.signal, redirect: 'error',
      });
      if (!response.ok) {
        if (response.status === 401) throw path === '/auth/login'
          ? new AuthError('Email or password is incorrect.', 'credentials')
          : path === '/auth/mfa/verify' ? new AuthError('Verification code is incorrect.', 'credentials') : expired();
        if (response.status === 410 && path === '/auth/mfa/verify') throw expired();
        if(api){const payload=await response.json().catch(()=>null);throw new ApiError(Array.isArray(payload?.message)?payload.message.join(' '):payload?.message??'The request could not be completed.',response.status,payload?.issues??[]);}
        if (response.status === 403) throw new AuthError('You no longer have access to this workspace.', 'access');
        if (response.status === 429) throw new AuthError('Too many attempts. Please try again later.', 'server');
        if (response.status === 400 || response.status === 422) throw new AuthError('Check your details and try again.', 'server');
        throw new AuthError('Authentication is unavailable. Please try again.', 'server');
      }
      if (api?.binary) return await response.arrayBuffer();
      if (api) {
        // Nest sends an empty success body for nullable results such as no active attendance.
        const payload = await response.text();
        return payload.trim() ? JSON.parse(payload) : null;
      }
      return await response.json();
    } catch (error) {
      if (error instanceof AuthError || error instanceof ApiError) throw error;
      throw new AuthError('Unable to connect. Check your connection and try again.', 'network');
    } finally { clearTimeout(timer); }
  }
  private decodeTokens(value: unknown, workspaceId: string): Session {
    if (!isRecord(value) || typeof value.accessToken !== 'string' || !value.accessToken
      || typeof value.refreshToken !== 'string' || !value.refreshToken
      || typeof value.accessTokenExpiresIn !== 'number' || !Number.isFinite(value.accessTokenExpiresIn) || value.accessTokenExpiresIn <= 0
      || typeof value.refreshTokenExpiresIn !== 'number' || !Number.isFinite(value.refreshTokenExpiresIn) || value.refreshTokenExpiresIn <= 0) {
      throw new AuthError('The authentication service returned an invalid session.', 'server');
    }
    return { version: 1, scope: this.scope, workspaceId, accessToken: value.accessToken, refreshToken: value.refreshToken,
      accessExpiresAt: this.now() + value.accessTokenExpiresIn * 1000, refreshExpiresAt: this.now() + value.refreshTokenExpiresIn * 1000 };
  }
  private async remember(session: Session, epoch: number) {
    try {
      await this.writeStorage(async () => {
        if (epoch !== this.epoch) throw cancelled();
        const { accessToken: _access, accessExpiresAt: _expires, ...saved } = session;
        await this.options.storage.write(JSON.stringify(saved));
      });
      if (epoch !== this.epoch) throw cancelled();
      this.session = session;
    } catch (error) {
      await this.revoke(session.refreshToken);
      if (error instanceof AuthError) throw error;
      throw new AuthError('Unable to save your sign-in securely. Please try again.', 'storage');
    }
  }
  private async profile(session: Session): Promise<Profile> {
    const value = await this.request('/me', undefined, session.accessToken);
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.primaryEmail !== 'string'
      || typeof value.displayName !== 'string' || !Array.isArray(value.memberships)) {
      throw new AuthError('Unable to verify your account. Please try again.', 'server');
    }
    const membership = value.memberships.find((item) => isRecord(item) && item.workspaceId === session.workspaceId
      && item.workspaceSlug === this.tenant && item.status === 'active' && item.workspaceStatus === 'active');
    if (value.status !== 'active' || !membership) throw new AuthError('You no longer have access to this workspace.', 'access');
    const tenantModules = new Set<TenantModuleId>(['workspace', 'crm', 'pre-project', 'projects', 'hrms']);
    if (!Array.isArray(membership.roles) || membership.roles.some((role: unknown) => typeof role !== 'string' || !role)
      || !Array.isArray(membership.allowedModules)
      || membership.allowedModules.some((module: unknown) => typeof module !== 'string' || !tenantModules.has(module as TenantModuleId))
      || !membership.allowedModules.includes('workspace')) {
      throw new AuthError('Workspace access could not be verified. Sign in again later.', 'access');
    }
    return value as Profile;
  }
  private async revalidateAccess(session: Session, epoch: number) {
    if (this.accessRevalidation) return this.accessRevalidation;
    const operation = (async () => {
      try {
        const profile = await this.profile(session);
        if (epoch === this.epoch)
          this.publish({ status: 'signedIn', profile, workspaceId: session.workspaceId });
      } catch (error) {
        if (epoch === this.epoch && error instanceof AuthError && ['access', 'expired'].includes(error.code))
          await this.signOut(error.message);
      }
    })();
    this.accessRevalidation = operation;
    void operation.finally(() => {
      if (this.accessRevalidation === operation) this.accessRevalidation = null;
    }).catch(() => {});
    return operation;
  }
  async signIn(email: string, password: string, tenantSlug = this.tenant) {
    if (this.state.status === 'authenticating') return;
    const epoch = ++this.epoch;
    let tokens: Session | undefined;
    try {
      this.selectTenant(tenantSlug);
      this.challenge = null;
      this.publish({ status: 'authenticating' });
      const payload = await this.request('/auth/login', { email: email.trim().toLowerCase(), password, tenantSlug: this.tenant });
      if (isRecord(payload) && payload.mfaRequired === true) {
        if (typeof payload.challengeToken !== 'string' || !payload.challengeToken
          || typeof payload.selectedWorkspaceId !== 'string') throw new AuthError('The verification request was incomplete. Sign in again.', 'server');
        if (epoch !== this.epoch) throw cancelled();
        this.challenge = { token: payload.challengeToken, workspaceId: payload.selectedWorkspaceId };
        this.publish({ status: 'mfa' });
        return;
      }
      if (!isRecord(payload) || typeof payload.selectedWorkspaceId !== 'string') throw new AuthError('Unable to verify your workspace.', 'server');
      tokens = this.decodeTokens(payload, payload.selectedWorkspaceId);
      if (epoch !== this.epoch) throw cancelled();
      const profile = await this.profile(tokens);
      await this.remember(tokens, epoch);
      this.publish({ status: 'signedIn', profile, workspaceId: tokens.workspaceId });
    } catch (error) {
      if (tokens) await this.revoke(tokens.refreshToken);
      if (epoch === this.epoch) this.publish({ status: 'signedOut' });
      throw error;
    }
  }
  async verifyMfa(code: string) {
    const challenge = this.challenge;
    if (!challenge || this.state.status !== 'mfa') throw expired();
    const epoch = this.epoch;
    let tokens: Session | undefined;
    try {
      const payload = await this.request('/auth/mfa/verify', { challengeToken: challenge.token, code: code.trim() });
      if (!isRecord(payload) || payload.selectedWorkspaceId !== challenge.workspaceId) {
        throw new AuthError('The verification response did not match this workspace.', 'server');
      }
      tokens = this.decodeTokens(payload, challenge.workspaceId);
      if (epoch !== this.epoch) throw cancelled();
      const profile = await this.profile(tokens);
      await this.remember(tokens, epoch);
      this.challenge = null;
      this.publish({ status: 'signedIn', profile, workspaceId: tokens.workspaceId });
    } catch (error) {
      if (tokens) await this.revoke(tokens.refreshToken);
      if (epoch === this.epoch) {
        if (error instanceof AuthError && error.code === 'expired') {
          this.challenge = null;
          this.publish({ status: 'signedOut', message: error.message });
        } else this.publish({ status: 'mfa' });
      }
      throw error;
    }
  }
  cancelMfa() {
    ++this.epoch;
    this.challenge = null;
    this.publish({ status: 'signedOut' });
  }
  private rotate(saved: SavedSession): Promise<Session> {
    if (this.rotation) return this.rotation;
    const epoch = this.epoch;
    const operation = (async () => {
      if (saved.refreshExpiresAt <= this.now()) throw expired();
      const tokens = this.decodeTokens(await this.request('/auth/refresh', { refreshToken: saved.refreshToken }), saved.workspaceId);
      await this.remember(tokens, epoch);
      return tokens;
    })();
    this.rotation = operation;
    void operation.finally(() => { if (this.rotation === operation) this.rotation = null; }).catch(() => {});
    return operation;
  }
  restore = (): Promise<void> => {
    if (this.restoration) return this.restoration;
    if (this.state.status === 'authenticating') return Promise.resolve();
    const epoch = this.epoch;
    const operation = (async () => {
      const foreground=this.state.status==='signedIn';
      if(!foreground)this.publish({ status: 'checking' });
      try {
        await this.storageWork.catch(() => {});
        const raw = await this.options.storage.read();
        if (epoch !== this.epoch) return;
        if (!raw) { this.publish({ status: 'signedOut' }); return; }
        let saved: SavedSession;
        try { saved = JSON.parse(raw); } catch { throw expired(); }
        if (!this.options.tenantSlug && typeof saved?.scope === 'string'
          && saved.scope.startsWith(`${this.base}|`)) {
          this.selectTenant(saved.scope.slice(this.base.length + 1));
        }
        if (!saved || saved.version !== 1 || saved.scope !== this.scope || typeof saved.refreshToken !== 'string'
          || !saved.refreshToken || typeof saved.workspaceId !== 'string' || !Number.isFinite(saved.refreshExpiresAt)) throw expired();
        const session = await this.rotate(saved);
        const profile = await this.profile(session);
        if (epoch === this.epoch) this.publish({ status: 'signedIn', profile, workspaceId: session.workspaceId });
      } catch (error) {
        if (epoch !== this.epoch) return;
        if (error instanceof AuthError && ['expired', 'access', 'storage'].includes(error.code)) {
          await this.signOut(error.message);
        } else {
          if(!foreground)this.publish({ status: 'unavailable', message: error instanceof AuthError ? error.message : 'Unable to read your saved sign-in. Try again.' });
        }
      }
    })();
    this.restoration = operation;
    void operation.finally(() => { if (this.restoration === operation) this.restoration = null; }).catch(() => {});
    return operation;
  };
  /** Authenticated reads retry once after a shared refresh; never refresh concurrently. */
  async get(path: string): Promise<unknown> {
    const epoch = this.epoch;
    let session = this.session;
    if (!session || this.state.status !== 'signedIn') throw expired();
    try {
      if (session.accessExpiresAt <= this.now() + 30000) session = await this.rotate(session);
      let result: unknown;
      try { result = await this.request(path, undefined, session.accessToken); }
      catch (error) {
        if (!(error instanceof AuthError) || error.code !== 'expired') throw error;
        session = this.session && this.session !== session ? this.session : await this.rotate(session);
        result = await this.request(path, undefined, session.accessToken);
      }
      if (epoch !== this.epoch) throw cancelled();
      return result;
    } catch (error) {
      if (epoch === this.epoch && error instanceof AuthError && error.code === 'expired') await this.signOut(error.message);
      throw error;
    }
  }
  /** Workspace API requests share auth rotation and preserve multipart bodies on retry. */
  async api<T>(path:string,method='GET',body?:unknown,binary=false):Promise<T>{
    const epoch=this.epoch;let session=this.session;
    if(!session||this.state.status!=='signedIn')throw expired();
    const workspaceId=session.workspaceId;
    const prefix=`/workspaces/${workspaceId}/`;
    const segment=path.startsWith(prefix)?path.slice(prefix.length).split(/[/?]/)[0]:'';
    const module:TenantModuleId|undefined=segment==='pre-projects'?'pre-project':segment==='billing'?'workspace':(['crm','hrms','projects'].includes(segment)?segment as TenantModuleId:undefined);
    if(!path.startsWith(prefix)||!module||path.includes('..'))throw new AuthError('This request is outside the active workspace.','access');
    const membership=this.state.profile.memberships.find(item=>item.workspaceId===workspaceId);
    if(!membership?.allowedModules.includes(module))throw new ApiError('This module is no longer available in your workspace.',403);
    try{
      if(session.accessExpiresAt<=this.now()+30000)session=await this.rotate(session);
      let result:unknown;
      try{result=await this.request(path,body,session.accessToken,{method,binary});}
      catch(error){if(!(error instanceof AuthError)||error.code!=='expired')throw error;session=this.session&&this.session!==session?this.session:await this.rotate(session);result=await this.request(path,body,session.accessToken,{method,binary});}
      if(epoch!==this.epoch)throw cancelled();return result as T;
    }catch(error){
      if(epoch===this.epoch&&error instanceof ApiError&&error.status===403)await this.revalidateAccess(session,epoch);
      if(epoch===this.epoch&&error instanceof AuthError&&error.code==='expired')await this.signOut(error.message);
      throw error;
    }
  }
  async requestPasswordReset(email: string, tenantSlug = this.tenant) {
    this.selectTenant(tenantSlug);
    await this.request('/auth/password/forgot', { email: email.trim().toLowerCase(), tenantSlug: this.tenant });
  }
  private async revoke(refreshToken: string) {
    await this.request('/auth/logout', { refreshToken }).catch(() => {});
  }
  async signOut(message?: string) {
    ++this.epoch;
    this.challenge = null;
    const prior = this.session;
    this.session = null;
    this.publish({ status: 'signedOut', message });
    let saved: SavedSession | null = null;
    try {
      await this.writeStorage(async () => {
        const raw = await this.options.storage.read();
        try { saved = raw ? JSON.parse(raw) : null; } catch { /* discard malformed storage */ }
        await this.options.storage.clear();
      });
    } catch {
      this.publish({ status: 'signedOut', message: 'Sign-in was closed, but saved-session cleanup failed. Please try again.' });
    }
    const stored = saved as SavedSession | null;
    const token = prior?.refreshToken ?? (stored?.scope === this.scope ? stored.refreshToken : undefined);
    if (token) await this.revoke(token);
  }
}
