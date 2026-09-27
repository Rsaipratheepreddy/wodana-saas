import { useMemo } from 'react';
import { useAuth } from '../auth/provider';
import { makeFormat } from './format-core';

export { makeFormat, zoneOffsetMinutes, wallTimeToIso, addDays, isoDay, weekStart } from './format-core';
export type { Format } from './format-core';

/**
 * Dates, times, money and numbers the workspace's way (its locale, currency and time zone, from its
 * region pack). Before sign-in it falls back to the device.
 */
export function useFormat() {
  const { state } = useAuth();
  const membership = state.status === 'signedIn' ? state.profile.memberships.find((item) => item.workspaceId === state.workspaceId) : undefined;
  const locale = membership?.workspaceLocale;
  const timeZone = membership?.workspaceTimezone;
  const currency = membership?.workspaceCurrency;
  return useMemo(() => makeFormat({ locale, timeZone, currency }), [locale, timeZone, currency]);
}
