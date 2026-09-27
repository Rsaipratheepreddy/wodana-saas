import { useMemo } from 'react';
import { useAuth } from '../auth/provider';
import { makeFormat } from './format-core';
import { formattingLocale, useLanguage } from './i18n';

export { makeFormat, zoneOffsetMinutes, wallTimeToIso, addDays, isoDay, weekStart } from './format-core';
export type { Format } from './format-core';

/**
 * Dates, times, money and numbers the workspace's way (its region, currency and time zone, from its region
 * pack), written in the person's language with Latin digits, as on the web. Before sign-in it falls back to the device.
 */
export function useFormat() {
  const { state } = useAuth();
  const { language, chosen } = useLanguage();
  const membership = state.status === 'signedIn' ? state.profile.memberships.find((item) => item.workspaceId === state.workspaceId) : undefined;
  const region = membership?.workspaceLocale;
  const locale = region ? formattingLocale(language, region) : chosen ? formattingLocale(language, language) : undefined;
  const timeZone = membership?.workspaceTimezone;
  const currency = membership?.workspaceCurrency;
  return useMemo(() => makeFormat({ locale, timeZone, currency }), [locale, timeZone, currency]);
}
