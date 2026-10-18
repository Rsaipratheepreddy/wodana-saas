import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { organizationStorage, type RememberedWorkspace } from '../../auth/organization-storage';
import { useAuth } from '../../auth/provider';

type State = {
  /** The last workspace signed in on this phone, for a branded sign-in with the email filled in. */
  remembered: RememberedWorkspace | null;
  ready: boolean;
  /** "Use another email": forget the workspace and email on this phone. */
  forget: () => void;
  /** The next sign-in asks which workspace (same email). */
  choosing: boolean;
  chooseWorkspace: (value: boolean) => void;
};
const Context = createContext<State>({ remembered: null, ready: false, forget: () => undefined, choosing: false, chooseWorkspace: () => undefined });

/** Remembers the workspace after each sign-in (its public branding), and forgets it on request. */
export function OrganizationProvider({ children }: PropsWithChildren) {
  const { client, state } = useAuth();
  const [remembered, setRemembered] = useState<RememberedWorkspace | null>(null);
  const [ready, setReady] = useState(false);
  const [choosing, chooseWorkspace] = useState(false);
  useEffect(() => {
    let alive = true;
    void organizationStorage.read().then((saved) => { if (alive) setRemembered(saved); }).catch(() => undefined).finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);
  const signedInKey = state.status === 'signedIn' ? `${state.profile.id}:${state.workspaceId}` : null;
  useEffect(() => {
    if (state.status !== 'signedIn' || !client.tenantSlug) return;
    const membership = state.profile.memberships.find((item) => item.workspaceId === state.workspaceId);
    const email = state.profile.primaryEmail;
    const fallback: RememberedWorkspace = {
      loginSlug: client.tenantSlug, displayName: membership?.workspaceName ?? client.tenantSlug, email,
      logoUrl: membership?.workspaceLogoUrl ? `${client.apiBase}/public/tenant-branding/${client.tenantSlug}/logo` : null,
      primaryColor: membership?.workspacePrimaryColor ?? null, secondaryColor: membership?.workspaceSecondaryColor ?? null,
      headingFont: membership?.workspaceHeadingFont ?? null, bodyFont: membership?.workspaceBodyFont ?? null,
    };
    void client.tenantBranding(client.tenantSlug).then((branding) => ({ ...branding, email })).catch(() => fallback).then((next) => {
      setRemembered(next);
      return organizationStorage.write(next);
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedInKey]);
  const forget = useCallback(() => {
    if (client.getSnapshot().status === 'mfa') client.cancelMfa();
    client.resetTenant();
    setRemembered(null);
    void organizationStorage.clear().catch(() => undefined);
  }, [client]);
  const value = useMemo(() => ({ remembered, ready, forget, choosing, chooseWorkspace }), [remembered, ready, forget, choosing]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useOrganization = () => useContext(Context);
