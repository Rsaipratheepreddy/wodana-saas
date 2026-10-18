import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useLanguage, useT } from '../core/i18n';
import { deviceLocale, devicePermission } from '../features/shell/push-model';
import { installationId, pushProjectId, pushSupported } from '../features/shell/push-registration';
import { clientPushStep, type PushConsent, type PushPermission } from './model';
import { usePortal } from './provider';

const native = Platform.OS === 'ios' || Platform.OS === 'android';
const consentKey = (slug: string) => `wodana.client-push.${slug}.v1`;
type Saved = { consent: PushConsent; at: number | null };

if (native) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

async function readConsent(slug: string): Promise<Saved> {
  try { const raw = await AsyncStorage.getItem(consentKey(slug)); return raw ? JSON.parse(raw) as Saved : { consent: null, at: null }; }
  catch { return { consent: null, at: null }; }
}
const writeConsent = (slug: string, consent: PushConsent) => AsyncStorage.setItem(consentKey(slug), JSON.stringify({ consent, at: Date.now() })).catch(() => undefined);

async function permission(ask: boolean): Promise<PushPermission> {
  let answer = await Notifications.getPermissionsAsync();
  if (ask && answer.status === 'undetermined' && answer.canAskAgain) answer = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
  return devicePermission(answer as { status: string; ios?: { status?: number | null } | null });
}

/**
 * Push notices for the signed-in client, with consent (plan §0.3c): the app asks first in its own words; only after
 * "Turn on notifications" does the phone's prompt show, and only then is this phone registered against the client
 * contact. "Not now" waits a week; turning notices off (More → Notifications) drops the registration and is kept.
 */
export function useClientPush() {
  const t = useT();
  const { language } = useLanguage();
  const { client, state } = usePortal();
  const slug = state.status === 'signedIn' ? state.slug : null;
  const region = state.status === 'signedIn' ? state.site?.region.locale : null;
  const [step, setStep] = useState<ReturnType<typeof clientPushStep>>('unavailable');
  const queue = useRef<Promise<void>>(Promise.resolve());
  const channelName = t('Your project');

  const register = useCallback(async () => {
    const projectId = pushProjectId();
    if (!projectId) return;
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('work', { name: channelName, importance: Notifications.AndroidImportance.HIGH });
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await client.registerDevice({
      requestId: client.newId(), installationId: await installationId(), platform: Platform.OS as 'ios' | 'android', token,
      locale: deviceLocale(Intl.DateTimeFormat().resolvedOptions().locale, deviceLocale(region ?? language)), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    });
  }, [client, channelName, region, language]);

  /** Works out the step and, with consent and the phone's permission, (re)registers; `ask` shows the phone's prompt. */
  const run = useCallback((ask: boolean) => {
    if (!slug) return queue.current;
    queue.current = queue.current.then(async () => {
      try {
        const saved = await readConsent(slug);
        const current = native && pushSupported() ? await permission(ask && saved.consent === 'yes') : null;
        const next = clientPushStep({ supported: native && pushSupported(), consent: saved.consent, laterAt: saved.at, permission: current });
        setStep(next);
        if (next === 'register' && current && current !== 'undetermined') await register();
        // The phone's settings no longer allow notifications: nothing can arrive, so the registration goes.
        if (next === 'blocked') await client.optOutDevice(await installationId()).catch(() => undefined);
      } catch {
        // Push is a convenience: everything is in the app. The next return to the app tries again.
      }
    });
    return queue.current;
  }, [slug, client, register]);

  useEffect(() => {
    if (!native || !slug) return;
    void run(false);
    const returning = AppState.addEventListener('change', (next) => { if (next === 'active') void run(false); });
    const rotated = Notifications.addPushTokenListener(() => { void run(false); });
    return () => { returning.remove(); rotated.remove(); };
  }, [run, slug]);

  const allow = useCallback(async () => { if (slug) { await writeConsent(slug, 'yes'); await run(true); } }, [slug, run]);
  const later = useCallback(async () => { if (slug) { await writeConsent(slug, 'later'); setStep('wait'); } }, [slug]);
  const turnOff = useCallback(async () => {
    if (!slug) return;
    await writeConsent(slug, 'no');
    setStep('off');
    await client.optOutDevice(await installationId()).catch(() => undefined);
  }, [slug, client]);
  return { step, asking: step === 'ask', allow, later, turnOff };
}

type ClientPush = ReturnType<typeof useClientPush>;
/** One registration per signed-in client (the portal layout runs it); screens read and change it here. */
export const ClientPushContext = createContext<ClientPush | null>(null);
export const useClientPushState = () => useContext(ClientPushContext);
