import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authConfig } from '../auth/config';
import { makeFormat } from '../core/format-core';
import { formattingLocale, useLanguage } from '../core/i18n';
import { PortalClient, PortalError } from './client';
import { portalStorage } from './storage';
import type { PortalProject, PortalView } from './types';

/**
 * The client side of the app: one portal client for the phone, signed in with the client's mobile number and a code.
 * `EXPO_PUBLIC_CLIENT_PORTAL` locks a firm's own build to its portal (a link, domain or sign-in name); without it the
 * client opens the link their project team sent.
 */
export const portalClient = new PortalClient({
  baseUrl: authConfig.baseUrl, storage: portalStorage, newId: () => Crypto.randomUUID(), lockedTo: process.env.EXPO_PUBLIC_CLIENT_PORTAL ?? null,
});

const PortalContext = createContext<PortalClient>(portalClient);

export function PortalProvider({ children }: PropsWithChildren) {
  useEffect(() => { void portalClient.restore(); }, []);
  return <PortalContext.Provider value={portalClient}>{children}</PortalContext.Provider>;
}

export function usePortal() {
  const client = useContext(PortalContext);
  return { client, state: useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot) };
}

/** The signed-in client's view of their projects (the same read model as the web portal), refreshed on return to the app. */
export const portalViewKey = (slug: string | null) => ['client-portal', slug, 'view'] as const;
export function usePortalView() {
  const { client, state } = usePortal();
  const queryClient = useQueryClient();
  const slug = state.status === 'signedIn' ? state.slug : null;
  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => { if (next === 'active' && slug) void queryClient.invalidateQueries({ queryKey: portalViewKey(slug) }); });
    return () => listener.remove();
  }, [queryClient, slug]);
  return useQuery<PortalView, PortalError>({
    queryKey: portalViewKey(slug), enabled: Boolean(slug), queryFn: () => client.view(), staleTime: 30_000,
    retry: (count, error) => !(error instanceof PortalError && error.status > 0 && error.status < 500) && count < 2,
  });
}

/** Re-reads the view after the client did something. */
export function useRefreshPortal() {
  const queryClient = useQueryClient();
  const { state } = usePortal();
  const slug = state.status === 'signedIn' ? state.slug : null;
  return () => queryClient.invalidateQueries({ queryKey: portalViewKey(slug) });
}

/** The project in front of the client: the one they picked, else their first. */
export function useProject(): { project: PortalProject | null; view: PortalView | undefined; query: ReturnType<typeof usePortalView> } {
  const query = usePortalView();
  const selected = useSelectedProject();
  const projects = query.data?.projects ?? [];
  return { project: projects.find((item) => item.id === selected.id) ?? projects[0] ?? null, view: query.data, query };
}

// The picked project, shared by every tab (a tiny store; the choice lasts while the app runs).
let selectedId: string | null = null;
const selectedListeners = new Set<() => void>();
export function useSelectedProject() {
  const id = useSyncExternalStore((listener) => { selectedListeners.add(listener); return () => { selectedListeners.delete(listener); }; }, () => selectedId, () => selectedId);
  return { id, select: (next: string) => { selectedId = next; for (const listener of selectedListeners) listener(); } };
}

/** Dates, money and numbers the firm's way (its region from the portal), written in the client's language. */
export function usePortalFormat() {
  const { state } = usePortal();
  const { language } = useLanguage();
  const site = state.status === 'checking' ? null : state.site;
  const region = site?.region;
  return useMemo(() => makeFormat({ locale: region ? formattingLocale(language, region.locale) : undefined, timeZone: region?.timeZone, currency: region?.currency }),
    [language, region]);
}
