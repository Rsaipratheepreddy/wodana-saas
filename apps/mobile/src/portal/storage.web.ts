import type { PortalStorage } from './client';

// The browser preview keeps the client's session in memory only: a reload signs them out.
let saved: string | null = null;
export const portalStorage: PortalStorage = {
  read: async () => saved,
  write: async (value) => { saved = value; },
  clear: async () => { saved = null; },
};
