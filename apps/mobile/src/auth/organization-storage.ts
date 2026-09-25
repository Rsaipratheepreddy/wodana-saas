import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OrganizationBranding } from './client';

const key = 'wodana.mobile.organization.v1';
const validSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Organization branding is public data. Authentication tokens stay in secure session storage. */
export const organizationStorage = {
  async read(): Promise<OrganizationBranding | null> {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object') return null;
      const data = value as Record<string, unknown>;
      if (typeof data.loginSlug !== 'string' || !validSlug.test(data.loginSlug)
        || typeof data.displayName !== 'string' || !data.displayName.trim()) return null;
      return {
        loginSlug: data.loginSlug, displayName: data.displayName,
        logoUrl: typeof data.logoUrl === 'string' ? data.logoUrl : null,
        primaryColor: typeof data.primaryColor === 'string' ? data.primaryColor : null,
        secondaryColor: typeof data.secondaryColor === 'string' ? data.secondaryColor : null,
        headingFont: typeof data.headingFont === 'string' ? data.headingFont : null,
        bodyFont: typeof data.bodyFont === 'string' ? data.bodyFont : null,
      };
    } catch { return null; }
  },
  write(value: OrganizationBranding): Promise<void> { return AsyncStorage.setItem(key, JSON.stringify(value)); },
  clear(): Promise<void> { return AsyncStorage.removeItem(key); },
};
