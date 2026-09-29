export type TenantModuleId = 'workspace' | 'crm' | 'pre-project' | 'projects' | 'hrms';
export type Membership = {
  /** The membership id: the person inside this workspace (owner and assignee fields use it). */
  id?: string;
  workspaceId: string; workspaceSlug: string; workspaceName: string; workspaceStatus: string;
  workspaceLogoUrl: string | null; workspacePrimaryColor: string | null; workspaceSecondaryColor: string | null;
  workspaceHeadingFont: string | null; workspaceBodyFont: string | null;
  /** How the workspace formats money, dates and times. */
  workspaceLocale?: string | null; workspaceCurrency?: string | null; workspaceTimezone?: string | null;
  accountName?: string | null; status: string; roles: string[]; allowedModules: TenantModuleId[];
  /** What this person may do, as the server decides it (roles, entitlements, self-service). */
  allowedPermissions?: string[];
  billingAccess?: {
    state: 'not_configured' | 'trial' | 'trial_expired' | 'current' | 'grace' | 'past_due' | 'collections' | 'suspended' | 'closed';
    effect: 'unchanged'; warning: boolean; actionDueAt: string | null; affectedModules: []; message: string;
  };
};
export type Profile = {
  id: string; primaryEmail: string; displayName: string; status: string;
  /** The interface language saved on the person's profile ("ar-AE"); plain "en" is the default, not a choice. */
  preferredLocale?: string | null;
  memberships: Membership[]; nextAction: string;
  unavailableOrganizations?: Array<{ workspaceId: string; workspaceName: string; workspaceStatus: string }>;
};
export type OrganizationBranding = {
  displayName: string; loginSlug: string; logoUrl: string | null;
  primaryColor: string | null; secondaryColor: string | null;
  headingFont: string | null; bodyFont: string | null;
};
export type AuthState =
  | { status: 'checking' | 'authenticating' }
  | { status: 'mfa' }
  | { status: 'signedOut'; message?: string }
  | { status: 'unavailable'; message: string }
  /** `offline`: opened from this phone's saved sign-in without reaching the server; requests rotate once it's back. */
  | { status: 'signedIn'; profile: Profile; workspaceId: string; offline?: boolean };
export type SessionStorage = { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void> };
type SavedSession = { version: 1; scope: string; refreshToken: string; refreshExpiresAt: number; workspaceId: string };
type Session = SavedSession & { accessToken: string; accessExpiresAt: number };
type Options = {
  baseUrl: string; tenantSlug: string; storage: SessionStorage; fetch?: typeof fetch; now?: () => number; credentials?: RequestCredentials; timeoutMs?: number;
  /** The last verified profile, kept (sealed) on the phone so a start without a connection still opens the app. */
  profileCache?: SessionStorage;
};
// Coming back to the app refreshes the profile with the live token; it rotates only this close to expiry,
// because every rotation on a poor connection risks a lost answer (and the server treats a reused token as theft).
const FOREGROUND_ROTATION_MS = 5 * 60_000;

export class AuthError extends Error {
  constructor(message: string, public code: 'credentials' | 'expired' | 'network' | 'server' | 'storage' | 'cancelled' | 'access' | 'configuration') { super(message); }
}
export class ApiError extends Error { constructor(message:string, public status:number, public issues:string[]=[]){super(message);} }
/** A workspace to choose when one email belongs to several (email-first sign-in). */
export type WorkspaceChoice = { workspaceId: string; name: string; loginSlug: string; logoUrl: string | null; primaryColor: string | null };
/** Another device this account is signed in on (the server allows a few). */
export type DeviceSession = { familyId: string; createdAt: string; lastActiveAt: string; expiresAt: string; userAgent: string | null; ipAddress: string | null; current?: boolean };
export type SignInOutcome = { kind: 'signedIn' } | { kind: 'mfa' } | { kind: 'chooseWorkspace'; workspaces: WorkspaceChoice[] };
/** Signed in on too many devices: one has to be signed out (its `familyId`) before this one can sign in. */
export class DeviceLimitError extends Error {
  code = 'device_limit' as const;
  constructor(message: string, public sessions: DeviceSession[], public maxActiveDevices: number) { super(message); }
}
const cancelled = () => new AuthError('Sign-in was cancelled.', 'cancelled');
const expired = () => new AuthError('Your session has expired. Sign in again.', 'expired');
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';

/** The product module a workspace API area belongs to; the server still decides every request. */
export function moduleForSegment(segment: string): TenantModuleId {
  if (['crm', 'jobs'].includes(segment)) return 'crm';
  if (['pre-projects', 'commercial', 'design', 'quotation', 'supplier-offers', 'catalog', 'catalogs', 'catalog-images'].includes(segment)) return 'pre-project';
  if (['projects', 'project-core', 'site', 'purchasing', 'inventory', 'factory', 'payables', 'receivables', 'petty-cash', 'vendors', 'warranty-settings', 'accounting'].includes(segment)) return 'projects';
  if (segment === 'hrms') return 'hrms';
  return 'workspace';
}

/**
 * Every module that may use a workspace path. Attendance reads offices, sites and work contexts from the
 * projects area (`projects/locations`, `projects`), which the server opens to HRMS members too.
 */
export function modulesForPath(rest: string): TenantModuleId[] {
  const [segment, next] = rest.split(/[/?]/);
  const module = moduleForSegment(segment);
  if (segment === 'projects' && (next === undefined || next === '' || next === 'locations' || next === 'attendance')) return [module, 'hrms'];
  return [module];
}

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
        if (path === '/auth/organization/resolve' && (response.status === 404 || response.status === 409)) {
          const payload = await response.json().catch(() => null);
          throw new AuthError(
            typeof payload?.message === 'string' ? payload.message : 'Organization not found. Check the name, slug, or ID.',
            'configuration',
          );
        }
        if (response.status === 409 && path === '/auth/login') {
          const payload = await response.json().catch(() => null);
          if (payload?.code === 'DEVICE_LIMIT_REACHED' && Array.isArray(payload.sessions)) {
            throw new DeviceLimitError(typeof payload.message === 'string' ? payload.message : 'You are signed in on too many devices.', payload.sessions, Number(payload.maxActiveDevices) || payload.sessions.length);
          }
          throw new AuthError(typeof payload?.message === 'string' ? payload.message : 'Sign-in is unavailable. Please try again.', 'access');
        }
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
      if (error instanceof AuthError || error instanceof ApiError || error instanceof DeviceLimitError) throw error;
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
    if (!this.tenant && !this.options.tenantSlug) {
      // Email-first sign-in: the account's workspace names the tenant.
      const chosen = value.memberships.find((item) => isRecord(item) && item.workspaceId === session.workspaceId);
      if (isRecord(chosen) && typeof chosen.workspaceSlug === 'string') { this.selectTenant(chosen.workspaceSlug); session.scope = this.scope; }
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
  /** Signed in with a verified profile, which is remembered for a start without a connection. */
  private signedIn(profile: Profile, session: Session, epoch: number) {
    if (epoch !== this.epoch) return;
    this.publish({ status: 'signedIn', profile, workspaceId: session.workspaceId });
    const cache = this.options.profileCache;
    if (cache) void this.writeStorage(async () => {
      if (epoch === this.epoch) await cache.write(JSON.stringify({ version: 1, scope: session.scope, workspaceId: session.workspaceId, profile }));
    }).catch(() => {});
  }
  /** The last verified profile for this saved sign-in (same API, tenant and workspace), or null. */
  private async cachedProfile(saved: SavedSession): Promise<Profile | null> {
    try {
      const raw = await this.options.profileCache?.read();
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      if (!isRecord(value) || value.version !== 1 || value.scope !== saved.scope || value.workspaceId !== saved.workspaceId || !isRecord(value.profile)) return null;
      const profile = value.profile as Profile;
      const active = Array.isArray(profile.memberships) && profile.memberships.some((item) => isRecord(item) && item.workspaceId === saved.workspaceId
        && item.status === 'active' && item.workspaceStatus === 'active' && Array.isArray(item.allowedModules) && item.allowedModules.includes('workspace'));
      return typeof profile.id === 'string' && profile.status === 'active' && active ? profile : null;
    } catch { return null; }
  }
  private async revalidateAccess(session: Session, epoch: number) {
    if (this.accessRevalidation) return this.accessRevalidation;
    const operation = (async () => {
      try {
        const profile = await this.profile(session);
        this.signedIn(profile, session, epoch);
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
  async resolveOrganization(identifier: string): Promise<OrganizationBranding> {
    const value = identifier.trim();
    if (value.length < 2 || value.length > 160) {
      throw new AuthError('Enter your organization name, slug, or ID.', 'configuration');
    }
    const payload = await this.request('/auth/organization/resolve', { identifier: value });
    if (!isRecord(payload) || typeof payload.displayName !== 'string'
      || typeof payload.loginSlug !== 'string'
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.loginSlug)) {
      throw new AuthError('The organization could not be verified. Try again.', 'server');
    }
    this.selectTenant(payload.loginSlug);
    const slug = payload.loginSlug;
    return {
      displayName: payload.displayName,
      loginSlug: slug,
      logoUrl: typeof payload.logoUrl === 'string' && payload.logoUrl
        ? /^https:\/\//i.test(payload.logoUrl) ? payload.logoUrl
          : `${this.base}/public/tenant-branding/${slug}/logo`
        : null,
      primaryColor: typeof payload.primaryColor === 'string' ? payload.primaryColor : null,
      secondaryColor: typeof payload.secondaryColor === 'string' ? payload.secondaryColor : null,
      headingFont: typeof payload.headingFont === 'string' ? payload.headingFont : null,
      bodyFont: typeof payload.bodyFont === 'string' ? payload.bodyFont : null,
    };
  }
  /**
   * Sign in. Without a workspace, the email decides it: one workspace signs straight in; several return
   * a choice (sign in again with the chosen `loginSlug`). `revokeFamilyId` signs out another device first.
   */
  async signIn(email: string, password: string, tenantSlug?: string | null, options: { revokeFamilyId?: string } = {}): Promise<SignInOutcome | undefined> {
    if (this.state.status === 'authenticating') return;
    const epoch = ++this.epoch;
    let tokens: Session | undefined;
    try {
      const slug = tenantSlug ?? this.options.tenantSlug;
      if (slug) this.selectTenant(slug);
      else { this.tenant = ''; this.scope = `${this.base}|`; }
      this.challenge = null;
      this.publish({ status: 'authenticating' });
      const payload = await this.request('/auth/login', {
        email: email.trim().toLowerCase(), password, ...(this.tenant ? { tenantSlug: this.tenant } : {}),
        ...(options.revokeFamilyId ? { revokeFamilyId: options.revokeFamilyId } : {}),
      });
      if (isRecord(payload) && payload.workspaceSelectionRequired === true) {
        const workspaces = (Array.isArray(payload.workspaces) ? payload.workspaces : []).filter((item): item is Record<string, unknown> => isRecord(item)
          && typeof item.workspaceId === 'string' && typeof item.loginSlug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.loginSlug))
          .map((item) => ({
            workspaceId: item.workspaceId as string, name: typeof item.name === 'string' ? item.name : String(item.loginSlug), loginSlug: item.loginSlug as string,
            logoUrl: this.logoUrl(item.loginSlug as string, item.logoUrl), primaryColor: typeof item.primaryColor === 'string' ? item.primaryColor : null,
          }));
        if (epoch === this.epoch) this.publish({ status: 'signedOut' });
        return { kind: 'chooseWorkspace', workspaces };
      }
      if (isRecord(payload) && payload.mfaRequired === true) {
        if (typeof payload.challengeToken !== 'string' || !payload.challengeToken
          || typeof payload.selectedWorkspaceId !== 'string') throw new AuthError('The verification request was incomplete. Sign in again.', 'server');
        if (epoch !== this.epoch) throw cancelled();
        this.challenge = { token: payload.challengeToken, workspaceId: payload.selectedWorkspaceId };
        this.publish({ status: 'mfa' });
        return { kind: 'mfa' };
      }
      if (!isRecord(payload) || typeof payload.selectedWorkspaceId !== 'string') throw new AuthError('Unable to verify your workspace.', 'server');
      tokens = this.decodeTokens(payload, payload.selectedWorkspaceId);
      if (epoch !== this.epoch) throw cancelled();
      const profile = await this.profile(tokens);
      await this.remember(tokens, epoch);
      this.signedIn(profile, tokens, epoch);
      return { kind: 'signedIn' };
    } catch (error) {
      if (tokens) await this.revoke(tokens.refreshToken);
      if (epoch === this.epoch) this.publish({ status: 'signedOut' });
      throw error;
    }
  }
  /** Forget the workspace before signing in with another email (not for a single-tenant build). */
  resetTenant() { if (!this.options.tenantSlug) { this.tenant = ''; this.scope = `${this.base}|`; } }
  /** Public co-branding for a workspace's sign-in: name, logo and colours. */
  async tenantBranding(loginSlug: string): Promise<OrganizationBranding> {
    const payload = await this.request(`/auth/tenant/${encodeURIComponent(loginSlug)}`);
    if (!isRecord(payload) || typeof payload.displayName !== 'string' || typeof payload.loginSlug !== 'string') throw new AuthError('The organization could not be verified. Try again.', 'server');
    return {
      displayName: payload.displayName, loginSlug: payload.loginSlug, logoUrl: this.logoUrl(payload.loginSlug, payload.logoUrl),
      primaryColor: typeof payload.primaryColor === 'string' ? payload.primaryColor : null, secondaryColor: typeof payload.secondaryColor === 'string' ? payload.secondaryColor : null,
      headingFont: typeof payload.headingFont === 'string' ? payload.headingFont : null, bodyFont: typeof payload.bodyFont === 'string' ? payload.bodyFont : null,
    };
  }
  /** A tenant logo the app can load: absolute HTTPS as given, otherwise the API's public logo. */
  private logoUrl(slug: string, value: unknown) {
    if (typeof value !== 'string' || !value) return null;
    return /^https:\/\//i.test(value) ? value : `${this.base}/public/tenant-branding/${slug}/logo`;
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
      this.signedIn(profile, tokens, epoch);
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
        // Back in the app with a live session (the newest token is in memory, not storage): refresh who the
        // person is, rotating only when the access token is about to run out.
        const live = this.session;
        if (foreground && live) {
          const session = live.accessExpiresAt > this.now() + FOREGROUND_ROTATION_MS ? live : await this.rotate(live);
          const profile = await this.profile(session);
          this.signedIn(profile, session, epoch);
          return;
        }
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
        let session: Session;
        try { session = await this.rotate(saved); }
        catch (error) {
          // No connection at launch: the saved sign-in opens the app with the last verified profile, so field
          // captures still work; the first request once the connection is back rotates the token.
          const cached = error instanceof AuthError && error.code === 'network' && saved.refreshExpiresAt > this.now() ? await this.cachedProfile(saved) : null;
          if (!cached) throw error;
          if (epoch !== this.epoch) return;
          this.session = { ...saved, accessToken: '', accessExpiresAt: 0 };
          this.publish({ status: 'signedIn', profile: cached, workspaceId: saved.workspaceId, offline: true });
          return;
        }
        const profile = await this.profile(session);
        this.signedIn(profile, session, epoch);
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
    if(!path.startsWith(prefix)||!segment||path.includes('..'))throw new AuthError('This request is outside the active workspace.','access');
    const modules=modulesForPath(path.slice(prefix.length));
    const membership=this.state.profile.memberships.find(item=>item.workspaceId===workspaceId);
    if(!modules.some(module=>membership?.allowedModules.includes(module)))throw new ApiError('This module is no longer available in your workspace.',403);
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
  /**
   * A current `Authorization` value for a workspace file (a photo shown by the image loader), rotating
   * the access token first when it is about to expire. Null when signed out.
   */
  async authorization(): Promise<string | null> {
    let session = this.session;
    if (!session || this.state.status !== 'signedIn') return null;
    if (session.accessExpiresAt <= this.now() + 30000) session = await this.rotate(session);
    return `Bearer ${session.accessToken}`;
  }
  /** The API's base URL, for building links to workspace files. */
  get apiBase() { return this.base; }
  async requestPasswordReset(email: string, tenantSlug?: string | null) {
    const slug = tenantSlug ?? this.options.tenantSlug;
    if (slug) this.selectTenant(slug);
    await this.request('/auth/password/forgot', { email: email.trim().toLowerCase(), ...(slug ? { tenantSlug: this.tenant } : {}) });
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
        await this.options.profileCache?.clear().catch(() => {});
      });
    } catch {
      this.publish({ status: 'signedOut', message: 'Sign-in was closed, but saved-session cleanup failed. Please try again.' });
    }
    const stored = saved as SavedSession | null;
    const token = prior?.refreshToken ?? (stored?.scope === this.scope ? stored.refreshToken : undefined);
    if (token) await this.revoke(token);
  }
}
