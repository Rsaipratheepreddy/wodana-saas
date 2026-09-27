import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OrganizationBranding } from './client';

const key = 'wodana.mobile.organization.v2';
const validSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export type RememberedWorkspace = OrganizationBranding & { email: string };

/**
 * The last workspace used on this phone (its public branding) and the email that signed in, so the next
 * launch opens branded with the email filled in. Tokens stay in secure session storage.
 */
export const organizationStorage = {
  async read(): Promise<RememberedWorkspace | null> {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (!data || typeof data.loginSlug !== 'string' || !validSlug.test(data.loginSlug) || typeof data.displayName !== 'string' || !data.displayName.trim()) return null;
      const text = (value: unknown) => (typeof value === 'string' ? value : null);
      return {
        loginSlug: data.loginSlug, displayName: data.displayName, email: typeof data.email === 'string' ? data.email : '',
        logoUrl: text(data.logoUrl), primaryColor: text(data.primaryColor), secondaryColor: text(data.secondaryColor), headingFont: text(data.headingFont), bodyFont: text(data.bodyFont),
      };
    } catch { return null; }
  },
  write(value: RememberedWorkspace): Promise<void> { return AsyncStorage.setItem(key, JSON.stringify(value)); },
  clear(): Promise<void> { return AsyncStorage.removeItem(key); },
};
