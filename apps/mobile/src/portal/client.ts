import { key } from '../core/i18n';
import { portalLookups, type PortalLookup } from './address';
import type { PortalFile, PortalInvite, PortalSite, PortalView } from './types';

/**
 * The client's side of one firm's portal, on the phone: the same business-core endpoints and read model as the web
 * portal (`/client-portal/{link}/…`), with the session token sent as a bearer token and kept in the phone's secure
 * storage instead of a cookie. Pure TypeScript (no native modules), so the sign-in, decision and upload flows are
 * tested in node.
 */
export type PortalChannel = 'whatsapp' | 'email';
export type Challenge = { challengeId: string; channel: PortalChannel; expiresIn: number; resendAfter: number; sentTo?: string };
export type DeviceState = { registered: boolean; consentedAt: string | null; optedOutAt: string | null };
export type FileKind = 'design' | 'photo' | 'handover' | 'agreement' | 'asset' | 'change';
/** A local file to upload: a photo from the camera or library, or a PDF. */
export type LocalFile = { uri: string; name: string; type: string };

/** A failed request: the message is written for the client; the status says what kind of failure (0: no connection). */
export class PortalError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter?: number) { super(message); }
}

/** What the phone keeps: which portal, and the session while signed in. The portal stays after sign-out for next time. */
export type SavedPortal = { slug: string; token: string | null };
export type PortalStorage = { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void> };

export type PortalState =
  | { status: 'checking' }
  | { status: 'signedOut'; slug: string | null; site: PortalSite | null; message?: string }
  | { status: 'signedIn'; slug: string; site: PortalSite | null; needsName: boolean };

export type PortalClientOptions = {
  baseUrl: string;
  storage: PortalStorage;
  fetch?: typeof fetch;
  /** A new id for one action, kept across its retries. */
  newId: () => string;
  /** A firm's own build: the portal it is locked to (link, domain or sign-in name). */
  lockedTo?: string | null;
  timeoutMs?: number;
};

const OFFLINE = key('You seem to be offline. Check your connection and try again.');
const FAILED = key('Something went wrong. Please try again.');

export class PortalClient {
  private state: PortalState = { status: 'checking' };
  private token: string | null = null;
  private listeners = new Set<() => void>();
  private readonly http: typeof fetch;

  constructor(private readonly options: PortalClientOptions) {
    this.http = options.fetch ?? ((...args) => fetch(...args));
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private publish(next: PortalState) { this.state = next; for (const listener of this.listeners) listener(); }

  get slug() { return this.state.status === 'checking' ? null : this.state.slug; }
  get lockedTo() { return this.options.lockedTo?.trim() || null; }
  /** The `Authorization` value for a portal file (images are loaded with it). */
  get authorization() { return this.token ? `Bearer ${this.token}` : null; }

  private url(path: string) { return `${this.options.baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`; }
  private at(path: string) {
    const slug = this.slug;
    if (!slug) throw new PortalError(key('Enter the link your project team sent you.'), 400);
    return `client-portal/${encodeURIComponent(slug)}/${path}`;
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown; form?: FormData; auth?: boolean; endsSession?: boolean } = {}): Promise<T> {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.options.timeoutMs ?? 20_000) : null;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.auth !== false && this.token) headers.authorization = `Bearer ${this.token}`;
    let response: Response;
    try {
      response = await this.http(this.url(path), {
        method: init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET'), headers,
        body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)), signal: controller?.signal,
      });
    } catch {
      throw new PortalError(OFFLINE, 0);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const data = await response.json().catch(() => null) as (T & { message?: unknown; retryAfter?: unknown }) | null;
    if (!response.ok) {
      const message = typeof data?.message === 'string' ? data.message : Array.isArray(data?.message) ? String(data.message[0]) : FAILED;
      // The session ended (signed out elsewhere, access removed, or 30 days without use): back to sign-in. Only the view
      // says so; a 401 on a command is a wrong decision code, and the client stays signed in to try again.
      if ((response.status === 401 || response.status === 403) && init.endsSession && this.token && this.state.status === 'signedIn') await this.endLocally(message);
      throw new PortalError(message, response.status, typeof data?.retryAfter === 'number' ? data.retryAfter : undefined);
    }
    return data as T;
  }

  /** Opens the saved portal and session, if any. A session the server no longer knows ends on the first request. */
  async restore() {
    let saved: SavedPortal | null = null;
    try { const raw = await this.options.storage.read(); saved = raw ? JSON.parse(raw) as SavedPortal : null; } catch { saved = null; }
    const slug = saved && typeof saved.slug === 'string' ? saved.slug : null;
    this.token = saved && typeof saved.token === 'string' ? saved.token : null;
    if (!slug && this.lockedTo) {
      // A firm's own build opens straight on its portal.
      const found = await this.find(this.lockedTo).catch(() => null);
      this.publish({ status: 'signedOut', slug: found?.slug ?? null, site: found?.site ?? null });
      return;
    }
    if (!slug) return this.publish({ status: 'signedOut', slug: null, site: null });
    this.publish(this.token ? { status: 'signedIn', slug, site: null, needsName: false } : { status: 'signedOut', slug, site: null });
    // The brand and region are refreshed in the background; the app opens without waiting for them.
    void this.site().catch(() => undefined);
  }

  /** The portal behind what the client typed (its link, the firm's domain or sign-in name), with its brand. */
  async find(input: string): Promise<{ slug: string; site: PortalSite }> {
    const lookups = portalLookups(input);
    if (!lookups.length) throw new PortalError(key('Enter the link your project team sent you.'), 400);
    for (const lookup of lookups) {
      const slug = await this.resolve(lookup).catch((error: unknown) => {
        if (error instanceof PortalError && error.status === 0) throw error;
        return null;
      });
      if (!slug) continue;
      const site = await this.request<PortalSite>(`client-portal/${encodeURIComponent(slug)}/site`, { auth: false }).catch((error: unknown) => {
        if (error instanceof PortalError && error.status === 0) throw error;
        return null;
      });
      if (site) return { slug, site };
    }
    throw new PortalError(key('We couldn\'t find that portal. Check the link your project team sent you.'), 404);
  }

  private async resolve(lookup: PortalLookup) {
    if (lookup.by === 'slug') return lookup.value;
    const path = lookup.by === 'host' ? `client-portal-sites/host/${encodeURIComponent(lookup.value)}` : `client-portal-sites/tenant/${encodeURIComponent(lookup.value)}`;
    return (await this.request<{ slug: string }>(path, { auth: false })).slug;
  }

  /** Chooses the portal to sign in to (kept on the phone for next time). */
  async choose(input: string) {
    const found = await this.find(input);
    await this.save({ slug: found.slug, token: null });
    this.token = null;
    this.publish({ status: 'signedOut', slug: found.slug, site: found.site });
    return found;
  }

  /** Back to choosing a portal (never in a firm's own build). */
  async forgetPortal() {
    if (this.lockedTo) return;
    this.token = null;
    await this.options.storage.clear().catch(() => undefined);
    this.publish({ status: 'signedOut', slug: null, site: null });
  }

  /** The portal's brand, welcome, region and code channels (public). */
  async site() {
    const site = await this.request<PortalSite>(this.at('site'), { auth: false });
    const current = this.state;
    if (current.status === 'signedIn' || current.status === 'signedOut') this.publish({ ...current, site } as PortalState);
    return site;
  }

  invitation(token: string) { return this.request<PortalInvite>(this.at(`invite/${encodeURIComponent(token)}`), { auth: false }); }

  /** A code to sign in (with the number), or to confirm one decision (signed in, with its purpose). */
  challenge(input: { phone?: string; channel: PortalChannel; purpose?: string }) {
    return this.request<Challenge>(this.at('challenge'), { body: input, auth: Boolean(input.purpose) });
  }

  /** Signs in with the code; the session is kept in the phone's secure storage. */
  async login(input: { challengeId: string; code: string }) {
    const slug = this.slug;
    const result = await this.request<{ token: string; expiresIn: number; needsName: boolean }>(this.at('login'), { body: input, auth: false });
    if (!slug || typeof result?.token !== 'string') throw new PortalError(FAILED, 500);
    this.token = result.token;
    await this.save({ slug, token: result.token });
    const site = this.state.status === 'signedOut' ? this.state.site : null;
    this.publish({ status: 'signedIn', slug, site, needsName: result.needsName === true });
    return { needsName: result.needsName === true };
  }

  /** The first time, the client confirms the name the team has for them. */
  async confirmName(commandId: string, name: string) {
    await this.command(commandId, { action: 'confirm_name', name });
    if (this.state.status === 'signedIn') this.publish({ ...this.state, needsName: false });
  }

  view() { return this.request<PortalView>(this.at('view'), { endsSession: true }); }

  /** One command; the id makes a retry of the same action safe (the server returns the first result). */
  command<T = { ok: true }>(commandId: string, input: Record<string, unknown>) {
    return this.request<T>(this.at('command'), { body: { ...input, commandId } });
  }

  /** A photo or PDF added to the project before it's sent with something; the id makes a retried upload return the same file. */
  upload(caseId: string, id: string, file: LocalFile) {
    const form = new FormData();
    // React Native sends a { uri, name, type } part as the file itself.
    form.append('file', file as unknown as Blob);
    return this.request<PortalFile>(this.at(`cases/${encodeURIComponent(caseId)}/uploads/${encodeURIComponent(id)}`), { form });
  }

  /** The address of a portal file (loaded with `authorization`). */
  fileUrl(kind: FileKind, id: string, preview = false) { return this.url(this.at(`files/${kind}/${encodeURIComponent(id)}${preview ? '?preview=1' : ''}`)); }

  /** This phone's push registration for the signed-in client. */
  device(installationId: string) { return this.request<DeviceState>(this.at(`devices/${encodeURIComponent(installationId)}`)); }
  registerDevice(input: { requestId: string; installationId: string; platform: 'ios' | 'android'; token: string; locale: string; timezone: string }) {
    return this.request<DeviceState>(this.at('devices'), { body: { ...input, consent: true } });
  }
  optOutDevice(installationId: string) { return this.request<DeviceState>(this.at('devices/opt-out'), { body: { installationId } }); }

  /** Signs out on the server and the phone; the portal is remembered for the next sign-in. */
  async signOut(message?: string) {
    const token = this.token;
    if (token) await this.request(this.at('logout'), { body: {} }).catch(() => undefined);
    await this.endLocally(message);
  }

  private async endLocally(message?: string) {
    const slug = this.slug;
    const site = this.state.status === 'checking' ? null : this.state.site;
    this.token = null;
    if (slug) await this.save({ slug, token: null }).catch(() => undefined);
    this.publish({ status: 'signedOut', slug, site, message });
  }

  private save(value: SavedPortal) { return this.options.storage.write(JSON.stringify(value)); }

  newId() { return this.options.newId(); }
}
