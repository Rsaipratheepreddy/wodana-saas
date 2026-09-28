import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi, type Api } from '../../core/api';
import { useLanguage } from '../../core/i18n';
import { useSession } from '../../core/session';
import { consentChanged, deviceLocale, devicePermission, permissionAllows, pushState, shouldEnablePush, type DevicePermission, type NotificationSettings } from './push-model';

const native = Platform.OS === 'ios' || Platform.OS === 'android';
const installationKey = 'wodana.mobile.installation-id.v1';
const tokenKey = (workspaceId: string, userId: string) => `wodana.push-token.${workspaceId}.${userId}`;
const storeOptions: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const notificationSettingsKey = (workspaceId: string) => ['notification-settings', workspaceId] as const;

/** The EAS project that issues this build's push tokens; none in a build made without one. */
export const pushProjectId = (): string | null => {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
};
/** Pushes reach a real phone built with a push project; never a simulator or the web. */
export const pushSupported = () => native && Device.isDevice && Boolean(pushProjectId());

/** One id per install of the app, kept on the phone; the server keys consent and the push token to it. */
export async function installationId() {
  const saved = await SecureStore.getItemAsync(installationKey, storeOptions);
  if (saved) return saved;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(installationKey, created, storeOptions);
  return created;
}

async function currentPermission(ask: boolean): Promise<DevicePermission> {
  let answer = await Notifications.getPermissionsAsync();
  if (ask && answer.status === 'undetermined' && answer.canAskAgain) {
    answer = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
  }
  return devicePermission(answer as { status: string; ios?: { status?: number | null } | null });
}

/**
 * Consent, the Expo token, the device and the push switch, each only when it changed. `ask` shows the
 * system prompt the first time (on sign-in); coming back to the app only notices a change in Settings.
 */
async function register(api: Api, identity: { workspaceId: string; userId: string; locale: string }, ask: boolean) {
  const projectId = pushProjectId();
  if (!projectId || !pushSupported()) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('work', { name: 'Work', importance: Notifications.AndroidImportance.HIGH });
  }
  const id = await installationId();
  const before = await api.get<NotificationSettings>('crm/notification-settings');
  const permission = await currentPermission(ask);
  const device = { installationId: id, platform: Platform.OS as 'ios' | 'android', status: permission, locale: identity.locale,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
  if (consentChanged(before, id, permission)) await api.send('crm/notification-settings/consent', 'PUT', { requestId: Crypto.randomUUID(), ...device });
  if (!permissionAllows(permission)) return;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const registered = before.devices.some((item) => item.installationId === id && item.status === 'active');
  const key = tokenKey(identity.workspaceId, identity.userId);
  if (!registered || (await SecureStore.getItemAsync(key, storeOptions)) !== token) {
    await api.send('crm/device-endpoints', 'POST', { requestId: Crypto.randomUUID(), ...device, tokenType: 'expo', token });
    await SecureStore.setItemAsync(key, token, storeOptions);
  }
  if (shouldEnablePush(before, id)) await api.send('crm/notification-settings/push', 'PUT', { enabled: true });
}

/**
 * Registers this phone for pushes when the person signs in to a workspace, and again when they come back
 * to the app after allowing notifications in Settings or when the phone's push token changes.
 */
export function usePushRegistration() {
  const api = useApi();
  const { workspaceId, userId, membership } = useSession();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const running = useRef(false);
  const locale = deviceLocale(Intl.DateTimeFormat().resolvedOptions().locale, deviceLocale(membership.workspaceLocale ?? language));
  const run = useCallback(async (ask: boolean) => {
    if (running.current) return;
    running.current = true;
    try {
      await register(api, { workspaceId, userId, locale }, ask);
    } catch {
      // Push is a convenience: the inbox still has every notice. The next sign-in or return tries again.
    } finally {
      running.current = false;
      void queryClient.invalidateQueries({ queryKey: notificationSettingsKey(workspaceId) });
    }
  }, [api, workspaceId, userId, locale, queryClient]);
  useEffect(() => {
    if (!native) return;
    void run(true);
    const returning = AppState.addEventListener('change', (state) => { if (state === 'active') void run(false); });
    const rotated = Notifications.addPushTokenListener(() => { void run(false); });
    return () => { returning.remove(); rotated.remove(); };
  }, [run]);
}

/** This person's notification settings in the workspace (push switch, devices, unread count). */
export function useNotificationSettings() {
  const api = useApi();
  return useQuery({
    queryKey: notificationSettingsKey(api.workspaceId),
    queryFn: () => api.get<NotificationSettings>('crm/notification-settings'),
    staleTime: 30_000,
  });
}

/** This phone's push state for Me → Notifications; re-read when the person comes back from Settings. */
export function usePushState() {
  const settings = useNotificationSettings();
  const { refetch } = settings;
  const [device, setDevice] = useState<{ permission: DevicePermission | null; installationId: string | null }>({ permission: null, installationId: null });
  useEffect(() => {
    if (!native) return;
    const read = () => void Promise.all([Notifications.getPermissionsAsync(), installationId()])
      .then(([answer, id]) => setDevice({ permission: devicePermission(answer as { status: string; ios?: { status?: number | null } | null }), installationId: id }))
      .catch(() => undefined);
    read();
    const returning = AppState.addEventListener('change', (state) => { if (state === 'active') { read(); void refetch(); } });
    return () => returning.remove();
  }, [refetch]);
  return { settings, state: pushState({ supported: pushSupported(), permission: device.permission, installationId: device.installationId, settings: settings.data }) };
}

/** The person's push switch; turning it on registers this phone first when needed. */
export function useSetPush() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { workspaceId, userId, membership } = useSession();
  const { language } = useLanguage();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      if (enabled) await register(api, { workspaceId, userId, locale: deviceLocale(membership.workspaceLocale ?? language) }, true);
      return api.send<NotificationSettings>('crm/notification-settings/push', 'PUT', { enabled });
    },
    onSuccess: (settings) => queryClient.setQueryData(notificationSettingsKey(api.workspaceId), settings),
  });
}

/** Signing out stops this phone's pushes for the person (best effort: signing out never waits on it). */
export async function unregisterThisPhone(api: Api) {
  if (!native) return;
  const id = await SecureStore.getItemAsync(installationKey, storeOptions);
  if (!id) return;
  const settings = await api.get<NotificationSettings>('crm/notification-settings');
  const device = settings.devices.find((item) => item.installationId === id && item.status === 'active');
  if (device) await api.send(`crm/device-endpoints/${device.id}/revoke`, 'POST', { requestId: Crypto.randomUUID(), version: device.version });
}
