"use client";

import { createContext, useContext, type ReactNode } from "react";

/** The workspace's own name and logo (its tenant branding), for what's printed or sent under its name. */
export type TenantIdentity = { name: string; logoUrl: string | null };

const Context = createContext<TenantIdentity | null>(null);

export function WorkspaceIdentityProvider({ identity, children }: { identity: TenantIdentity | null; children: ReactNode }) {
  return <Context.Provider value={identity}>{children}</Context.Provider>;
}

export function useWorkspaceIdentity() {
  return useContext(Context);
}
