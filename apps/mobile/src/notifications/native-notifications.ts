import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import type { AuthClient } from '../auth/client';
import { notificationLinkReference, notificationReference } from './routing';

const installationKey = 'wodana.notification-installation.v1';
const channelId = 'wodana-work';
const nativePlatform = Platform.OS === 'ios' || Platform.OS === 'android';

export type PermissionStatus = 'undetermined' | 'denied' | 'granted' | 'provisional' | 'ephemeral';
export type MobileDestination = {
  module: 'crm' | 'pre-project' | 'projects';
  screen: string;
  recordId?: string | null;
  actionId?: string | null;
  jobId?: string;
};
export type NotificationDevice = {
  id: string; installationId: string; platform: 'ios' | 'android'; tokenType: 'expo';
  locale: string; timezone: string; status: 'active' | 'revoked'; lastSeenAt: string; version: number;
};
export type NotificationConsent = {
  id: string; installationId: string; platform: 'ios' | 'android'; permissionStatus: PermissionStatus;
  locale: string; timezone: string; permissionUpdatedAt: string; lastSeenAt: string; version: number;
};
export type NotificationSettings = {
  pushEnabled: boolean; pushAvailable: boolean; unreadCount: number;
  devices: NotificationDevice[]; consents: NotificationConsent[];
  preference: { enabled: boolean; version: number } | null;
};
export type InboxNotification = {
  id: string; eventType: string; status: string; subject: string | null; body: string;
  deepLink: string | null; deliveredAt: string | null; readAt: string | null; createdAt: string; version: number;
};
export type NotificationOpenResult = { id: string; readAt: string; destination: MobileDestination; fallback: boolean };
export type NotificationSyncResult = { settings: NotificationSettings; supportMessage?: string };

if (nativePlatform) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

function path(workspaceId: string, suffix: string) {
  return `/workspaces/${workspaceId}/crm/${suffix}`;
}

function environment() {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return { locale: locale.replace('_', '-').slice(0, 35), timezone: timezone.slice(0, 64) };
}

function projectId() {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const value = extra?.eas?.projectId;
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

function permissionStatus(value: Notifications.NotificationPermissionsStatus): PermissionStatus {
  if (Platform.OS === 'ios') {
    if (value.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'provisional';
    if (value.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL) return 'ephemeral';
    if (value.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED) return 'granted';
    if (value.ios?.status === Notifications.IosAuthorizationStatus.DENIED) return 'denied';
    return 'undetermined';
  }
  if (value.granted || value.status === 'granted') return 'granted';
  if (value.status === 'denied') return 'denied';
  return 'undetermined';
}

function allowed(status: PermissionStatus) {
  return status === 'granted' || status === 'provisional' || status === 'ephemeral';
}

async function configureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(channelId, {
    name: 'Wodana work',
    description: 'Assigned work, client replies and approval updates',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 180, 120, 180],
    lightColor: '#4F46E5',
    showBadge: true,
  });
}

export async function installationId() {
  const existing = await SecureStore.getItemAsync(installationKey);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(installationKey, created);
  return created;
}

export async function loadNotificationSettings(client: AuthClient, workspaceId: string) {
  return client.api<NotificationSettings>(path(workspaceId, 'notification-settings'));
}

export async function loadNotificationInbox(client: AuthClient, workspaceId: string) {
  return client.api<InboxNotification[]>(path(workspaceId, 'notifications'));
}

async function recordConsent(client: AuthClient, workspaceId: string, id: string, status: PermissionStatus) {
  const details = environment();
  return client.api<NotificationSettings>(path(workspaceId, 'notification-settings/consent'), 'PUT', {
    requestId: Crypto.randomUUID(), installationId: id, platform: Platform.OS, status, ...details,
  });
}

async function registerDevice(client: AuthClient, workspaceId: string, id: string, status: PermissionStatus) {
  const easProjectId = projectId();
  if (!Device.isDevice) return { settings: await loadNotificationSettings(client, workspaceId), supportMessage: 'Push notifications need a physical device. Updates remain available in Wodana.' };
  if (!easProjectId) return { settings: await loadNotificationSettings(client, workspaceId), supportMessage: 'Push delivery is not configured for this build. Updates remain available in Wodana.' };
  const token = await Notifications.getExpoPushTokenAsync({ projectId: easProjectId });
  const details = environment();
  await client.api(path(workspaceId, 'device-endpoints'), 'POST', {
    requestId: Crypto.randomUUID(), installationId: id, platform: Platform.OS,
    status, tokenType: 'expo', token: token.data, ...details,
  });
  return { settings: await loadNotificationSettings(client, workspaceId) };
}

export async function syncExistingNotificationRegistration(client: AuthClient, workspaceId: string): Promise<NotificationSyncResult> {
  const current = await loadNotificationSettings(client, workspaceId);
  if (!nativePlatform) return { settings: current, supportMessage: 'Push notifications are available in the iOS and Android apps. Updates remain available here.' };
  await configureAndroidChannel();
  const id = await installationId();
  const status = permissionStatus(await Notifications.getPermissionsAsync());
  const recorded = await recordConsent(client, workspaceId, id, status);
  if (!allowed(status)) return { settings: recorded };
  if (recorded.devices.some(device => device.installationId === id && device.status === 'active')) return { settings: recorded };
  try { return await registerDevice(client, workspaceId, id, status); }
  catch { return { settings: recorded, supportMessage: 'Push registration is temporarily unavailable. Updates remain available in Wodana.' }; }
}

export async function enableNotifications(client: AuthClient, workspaceId: string): Promise<NotificationSyncResult> {
  if (!nativePlatform) return { settings: await loadNotificationSettings(client, workspaceId), supportMessage: 'Push notifications are available in the iOS and Android apps.' };
  await configureAndroidChannel();
  const id = await installationId();
  const status = permissionStatus(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } }));
  const recorded = await recordConsent(client, workspaceId, id, status);
  if (!allowed(status)) return { settings: recorded, supportMessage: 'Notifications are off in device settings. Updates remain available in Wodana.' };
  try {
    const registered = await registerDevice(client, workspaceId, id, status);
    if (registered.supportMessage) return registered;
    return { settings: await client.api<NotificationSettings>(path(workspaceId, 'notification-settings/push'), 'PUT', { enabled: true }) };
  } catch {
    return { settings: recorded, supportMessage: 'Push registration is temporarily unavailable. Updates remain available in Wodana.' };
  }
}

export async function disableNotifications(client: AuthClient, workspaceId: string): Promise<NotificationSettings> {
  let settings = await client.api<NotificationSettings>(path(workspaceId, 'notification-settings/push'), 'PUT', { enabled: false });
  if (!nativePlatform) return settings;
  const id = await installationId();
  for (const device of settings.devices.filter(item => item.installationId === id && item.status === 'active')) {
    settings = await client.api<NotificationSettings>(path(workspaceId, `device-endpoints/${device.id}/revoke`), 'POST', {
      requestId: Crypto.randomUUID(), version: device.version,
    });
  }
  return settings;
}

export async function revokeCurrentNotificationDevice(client: AuthClient, workspaceId: string) {
  if (!nativePlatform) return;
  try {
    const id = await installationId();
    let settings = await loadNotificationSettings(client, workspaceId);
    for (const device of settings.devices.filter(item => item.installationId === id && item.status === 'active')) {
      settings = await client.api<NotificationSettings>(path(workspaceId, `device-endpoints/${device.id}/revoke`), 'POST', {
        requestId: Crypto.randomUUID(), version: device.version,
      });
    }
  } catch { /* Signing out must still clear the local session. */ }
}

export async function openNotification(client: AuthClient, workspaceId: string, notificationId: string) {
  return client.api<NotificationOpenResult>(path(workspaceId, `notifications/${notificationId}/open`), 'POST');
}

export function watchNotificationOpens(client: AuthClient, workspaceId: string, onOpen: (destination: MobileDestination) => void) {
  let active = true;
  const handle = async (reference: { notificationId: string; workspaceId?: string } | null) => {
    if (!active || !reference || reference.workspaceId && reference.workspaceId !== workspaceId) return;
    try { const result = await openNotification(client, workspaceId, reference.notificationId); if (active) onOpen(result.destination); }
    catch { if (active) onOpen({ module: 'crm', screen: 'inbox' }); }
  };
  const response = nativePlatform ? Notifications.addNotificationResponseReceivedListener(value => {
    void handle(notificationReference(value.notification.request.content.data));
  }) : null;
  const link = Linking.addEventListener('url', event => { void handle(notificationLinkReference(event.url)); });
  if (nativePlatform) {
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      void handle(notificationReference(last.notification.request.content.data));
      Notifications.clearLastNotificationResponse();
    }
  }
  void Linking.getInitialURL().then(url => { if (url) void handle(notificationLinkReference(url)); });
  return () => { active = false; response?.remove(); link.remove(); };
}
