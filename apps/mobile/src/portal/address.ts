/**
 * Where a client's portal is, from what they type or what the firm's build is locked to: the link the team sent
 * (`https://…/portal/{link}`), the firm's own portal domain (`portal.firm.com`), or the firm's sign-in name. Each guess
 * is tried in order until one opens a portal; nothing here knows a tenant.
 */
export type PortalLookup = { by: 'slug' | 'host' | 'login'; value: string };

const SLUG = /^[a-z0-9-]{1,80}$/;
const HOST = /^(?=.{3,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function portalLookups(input: string | null | undefined): PortalLookup[] {
  const raw = (input ?? '').trim();
  if (!raw) return [];
  let url: URL | null = null;
  try { url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { url = null; }
  const word = raw.toLowerCase().replace(/^\/+|\/+$/g, '');
  // A bare word: a portal link or the firm's sign-in name.
  if (SLUG.test(word)) return [{ by: 'slug', value: word }, { by: 'login', value: word }];
  if (!url) return [];
  const host = url.hostname.toLowerCase();
  const path = url.pathname.split('/').filter(Boolean);
  const at = path.indexOf('portal');
  const slug = at >= 0 ? (path[at + 1] ?? '').toLowerCase() : '';
  const lookups: PortalLookup[] = [];
  // …/portal/{link}: the link is the portal; a firm's own domain serves /portal without one.
  if (slug && SLUG.test(slug) && slug !== 'print') lookups.push({ by: 'slug', value: slug });
  if (HOST.test(host)) lookups.push({ by: 'host', value: host });
  return lookups;
}

/** The invitation token in a link the team sent (`?invite=…`), if there is one. */
export function inviteToken(input: string | null | undefined) {
  try {
    const value = new URL((input ?? '').trim()).searchParams.get('invite');
    return value && /^[A-Za-z0-9_-]{20,100}$/.test(value) ? value : null;
  } catch { return null; }
}
