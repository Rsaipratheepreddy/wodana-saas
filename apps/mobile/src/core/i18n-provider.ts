import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { createElement, useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { DevSettings, I18nManager, Platform } from 'react-native';
import { languageDirection, supportedLanguage, type AppLanguage } from '../../../web/lib/i18n/languages';
import { I18nContext, type Dictionary, type I18nValue } from './i18n';
import { dictionaries } from './i18n.generated';

const STORAGE_KEY = 'wodana.language';

const dictionaryFor = (language: AppLanguage): Dictionary => (language === 'en' ? {} : dictionaries[language] ?? {});

/** React Native mirrors layout only after a restart: switch the native direction, then reload once. */
async function applyDirection(language: AppLanguage) {
  const rtl = languageDirection(language) === 'rtl';
  if (I18nManager.isRTL === rtl || Platform.OS === 'web') return;
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  try { await Updates.reloadAsync(); } catch { DevSettings.reload(); }
}

/**
 * The phone's interface language: the person's choice on this phone, else (through `adopt`) the language saved
 * on their profile or the workspace's. `language` fixes it (previews and tests).
 */
export function I18nProvider({ language: fixed, dictionary: fixedDictionary, children }: PropsWithChildren<{ language?: string; dictionary?: Dictionary }>) {
  const [state, setState] = useState<{ language: AppLanguage; chosen: boolean; ready: boolean }>({ language: supportedLanguage(fixed) ?? 'en', chosen: Boolean(fixed), ready: Boolean(fixed) });
  // Read by adopt(), which a child calls from its own effect (children's effects run before this provider's).
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    if (fixed) return;
    let active = true;
    void AsyncStorage.getItem(STORAGE_KEY).catch(() => null).then((saved) => {
      const language = supportedLanguage(saved);
      if (active) setState((current) => (language ? { language, chosen: true, ready: true } : { ...current, ready: true }));
    });
    return () => { active = false; };
  }, [fixed]);

  const setLanguage = useCallback(async (language: AppLanguage) => {
    setState({ language, chosen: true, ready: true });
    await AsyncStorage.setItem(STORAGE_KEY, language).catch(() => undefined);
    await applyDirection(language);
  }, []);
  const adopt = useCallback((language: AppLanguage) => {
    const current = latest.current;
    if (current.chosen || !current.ready || current.language === language) return;
    // Remembered like a choice, so the direction restart happens once, not on every launch.
    setState({ language, chosen: true, ready: true });
    void AsyncStorage.setItem(STORAGE_KEY, language).catch(() => undefined).then(() => applyDirection(language));
  }, []);

  const value = useMemo<I18nValue>(() => ({
    ...state,
    dictionary: fixedDictionary ?? dictionaryFor(state.language),
    setLanguage,
    adopt,
  }), [state, fixedDictionary, setLanguage, adopt]);
  return createElement(I18nContext.Provider, { value }, children);
}
