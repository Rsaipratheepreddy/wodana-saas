/**
 * Push on this phone, without native code (node tests import it): the permission in the server's words,
 * the locale the server accepts, and the one state Me → Notifications shows.
 */
export type DevicePermission = 'undetermined' | 'denied' | 'granted' | 'provisional' | 'ephemeral';

const ALLOWED: ReadonlySet<DevicePermission> = new Set(['granted', 'provisional', 'ephemeral']);
export const permissionAllows = (status: DevicePermission) => ALLOWED.has(status);

/** Expo's answer. On iOS: 0 not determined, 1 denied, 2 authorised, 3 provisional, 4 ephemeral. */
export function devicePermission(response: { status: string; ios?: { status?: number | null } | null }): DevicePermission {
  const ios = response.ios?.status;
  if (ios === 3) return 'provisional';
  if (ios === 4) return 'ephemeral';
  if (response.status === 'granted') return 'granted';
  if (response.status === 'denied') return 'denied';
  return 'undetermined';
}

/** A BCP 47 tag the server accepts ("en", "ar-AE"), without Unicode extensions; `fallback` otherwise. */
export function deviceLocale(value: string | null | undefined, fallback = 'en') {
  const base = String(value ?? '').split(/-u-|-x-/i)[0].replace(/_/g, '-');
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(base) && base.length <= 35 ? base : fallback;
}

export type NotificationSettings = {
  pushEnabled: boolean;
  pushAvailable: boolean;
  preference: { enabled: boolean; version: number } | null;
  consents: Array<{ installationId: string; permissionStatus: DevicePermission }>;
  devices: Array<{ id: string; installationId: string; status: string; version: number }>;
  unreadCount: number;
};

/**
 * What Me → Notifications says about this phone:
 * - unavailable: this build or device can't receive pushes (a simulator, or no push project set);
 * - blocked: the phone's settings don't allow notifications;
 * - not-registered: allowed, but this phone isn't registered yet;
 * - on / off: registered, and the person's switch.
 */
export type PushState = 'unavailable' | 'blocked' | 'not-registered' | 'on' | 'off';

export function pushState(input: { supported: boolean; permission: DevicePermission | null; installationId: string | null; settings: NotificationSettings | null | undefined }): PushState {
  if (!input.supported) return 'unavailable';
  if (input.permission && !permissionAllows(input.permission)) return 'blocked';
  const device = input.settings?.devices.find((item) => item.installationId === input.installationId && item.status === 'active');
  if (!device) return 'not-registered';
  return input.settings?.pushEnabled ? 'on' : 'off';
}

/**
 * Whether registering this phone turns push on: when the person never chose, or when push was off only
 * because this phone didn't allow notifications (the server switches it off then) and now it does. A switch
 * the person turned off themselves stays off.
 */
export function shouldEnablePush(before: Pick<NotificationSettings, 'preference' | 'consents'> | null | undefined, installationId: string) {
  if (!before?.preference) return true;
  if (before.preference.enabled) return false;
  const prior = before.consents.find((item) => item.installationId === installationId)?.permissionStatus;
  return Boolean(prior && !permissionAllows(prior));
}

/** Record the phone's permission only when it changed (each record is audited). */
export function consentChanged(before: Pick<NotificationSettings, 'consents'> | null | undefined, installationId: string, permission: DevicePermission) {
  return before?.consents.find((item) => item.installationId === installationId)?.permissionStatus !== permission;
}
