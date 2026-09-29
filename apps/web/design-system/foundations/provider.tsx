"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useMemo,
  useSyncExternalStore,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { UiLanguageContext } from "@/lib/i18n/i18n-provider";
import { formattingLocale, languageDirection } from "@/lib/i18n/languages";
import { I18nProvider } from "react-aria-components";

export type DesignSystemTheme = "light" | "dark" | "high-contrast";
export type DesignSystemDensity = "compact" | "comfortable";
export type DesignSystemDirection = "ltr" | "rtl";

export type DesignSystemSettings = {
  theme: DesignSystemTheme;
  density: DesignSystemDensity;
  /** Formats numbers, money and dates: the person's language with the workspace region ("ar-AE-u-nu-latn"). */
  locale: string;
  /** The workspace's own locale ("en-AE"): its region and conventions, before the person's language is applied. */
  regionLocale: string;
  direction: DesignSystemDirection;
  currency: string;
  timeZone: string;
  /**
   * The workspace's working week (0 = Sunday … 6 = Saturday) and its days off (YYYY-MM-DD), from its work
   * calendar or region pack. Null when unknown: the region locale's own week is used instead.
   */
  workingDays: number[] | null;
  holidays: string[];
  portalContainer: Element | null;
};

export type DesignSystemProviderProps = Omit<HTMLAttributes<HTMLDivElement>, "dir"> &
  Partial<Omit<DesignSystemSettings, "portalContainer">> & {
    children: ReactNode;
    portalContainer?: Element | null;
  };

const DEFAULT_SETTINGS: DesignSystemSettings = {
  theme: "light",
  density: "comfortable",
  locale: "en",
  regionLocale: "en",
  direction: "ltr",
  currency: "USD",
  timeZone: "UTC",
  workingDays: null,
  holidays: [],
  portalContainer: null,
};

const DesignSystemContext = createContext<DesignSystemSettings>(DEFAULT_SETTINGS);
/** The theme a provider above chose explicitly; null while every provider above follows the document. */
const ChosenThemeContext = createContext<DesignSystemTheme | null>(null);

const documentThemeListeners = new Set<() => void>();
let documentThemeObserver: MutationObserver | null = null;

function documentTheme(): DesignSystemTheme {
  const theme = document.documentElement.dataset.theme;
  return theme === "dark" || theme === "high-contrast" ? theme : "light";
}

function subscribeDocumentTheme(listener: () => void) {
  documentThemeListeners.add(listener);
  if (!documentThemeObserver && typeof MutationObserver !== "undefined") {
    documentThemeObserver = new MutationObserver(() => documentThemeListeners.forEach((notify) => notify()));
    documentThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  return () => {
    documentThemeListeners.delete(listener);
    if (!documentThemeListeners.size) { documentThemeObserver?.disconnect(); documentThemeObserver = null; }
  };
}

/**
 * The theme a provider without its own `theme` uses: the nearest provider that chose one, else the document's
 * (the workspace's light/dark switch sets it on <html>), so a page's provider never pins light inside dark mode.
 */
function useInheritedTheme(): DesignSystemTheme {
  const chosen = useContext(ChosenThemeContext);
  const fromDocument = useSyncExternalStore(subscribeDocumentTheme, documentTheme, () => DEFAULT_SETTINGS.theme);
  return chosen ?? fromDocument;
}

export const DesignSystemProvider = forwardRef<HTMLDivElement, DesignSystemProviderProps>(
  function DesignSystemProvider(
    {
      children,
      className,
      theme: themeProp,
      density = DEFAULT_SETTINGS.density,
      locale: localeProp,
      regionLocale: regionLocaleProp,
      direction: directionOverride,
      currency: currencyProp,
      timeZone: timeZoneProp,
      workingDays: workingDaysProp,
      holidays: holidaysProp,
      portalContainer = null,
      ...props
    },
    ref,
  ) {
    // Text direction follows the UI language the person chose. Money, dates and numbers follow the
    // workspace's region (a nested provider inherits it unless told otherwise) written the person's way:
    // their language with the region's conventions. React Aria gets that locale so keyboard, date fields
    // and overlay placement mirror too.
    const parent = useContext(DesignSystemContext);
    const chosenTheme = useContext(ChosenThemeContext);
    const inheritedTheme = useInheritedTheme();
    const theme = themeProp ?? inheritedTheme;
    // A provider handed a full settings object (e.g. a nested provider re-using its parent's) keeps its region.
    const regionLocale = regionLocaleProp ?? localeProp ?? parent.regionLocale;
    const currency = currencyProp ?? parent.currency;
    const timeZone = timeZoneProp ?? parent.timeZone;
    const workingDays = workingDaysProp ?? parent.workingDays;
    const holidays = holidaysProp ?? parent.holidays;
    const uiLanguage = useContext(UiLanguageContext);
    const locale = formattingLocale(uiLanguage, regionLocale);
    const direction = directionOverride ?? languageDirection(uiLanguage ?? locale);
    // A forced direction (an LTR island inside an RTL page) needs a locale that reads that way.
    const ariaLocale = languageDirection(locale) === direction ? locale
      : [regionLocale, uiLanguage ?? "", direction === "rtl" ? "ar" : "en"].find((tag) => tag && languageDirection(tag) === direction) ?? locale;
    const value = useMemo(
      () => ({ theme, density, locale, regionLocale, direction, currency, timeZone, workingDays, holidays, portalContainer }),
      [theme, density, locale, regionLocale, direction, currency, timeZone, workingDays, holidays, portalContainer],
    );

    return (
      <ChosenThemeContext.Provider value={themeProp ?? chosenTheme}>
      <DesignSystemContext.Provider value={value}>
        <I18nProvider locale={ariaLocale}>
          <div
            {...props}
            className={["wd-root", className].filter(Boolean).join(" ")}
            data-wd-density={density}
            data-wd-theme={theme}
            dir={direction}
            lang={uiLanguage ?? locale}
            ref={ref}
          >
            {children}
          </div>
        </I18nProvider>
      </DesignSystemContext.Provider>
      </ChosenThemeContext.Provider>
    );
  },
);

/** Sets the workspace region for every design-system provider below it. */
export function WorkspaceRegionProvider({ locale, currency, timeZone, workingDays, holidays, children }: { locale?: string; currency?: string; timeZone?: string; workingDays?: number[]; holidays?: string[]; children: ReactNode }) {
  const parent = useContext(DesignSystemContext);
  const uiLanguage = useContext(UiLanguageContext);
  const value = useMemo(() => {
    const regionLocale = locale ?? parent.regionLocale;
    return { ...parent, locale: formattingLocale(uiLanguage, regionLocale), regionLocale, currency: currency ?? parent.currency, timeZone: timeZone ?? parent.timeZone,
      workingDays: workingDays?.length ? workingDays : parent.workingDays, holidays: holidays ?? parent.holidays };
  }, [parent, uiLanguage, locale, currency, timeZone, workingDays, holidays]);
  return <DesignSystemContext.Provider value={value}>{children}</DesignSystemContext.Provider>;
}

export function useDesignSystem(): DesignSystemSettings {
  const settings = useContext(DesignSystemContext);
  const theme = useInheritedTheme();
  return useMemo(() => (settings.theme === theme ? settings : { ...settings, theme }), [settings, theme]);
}

/** Portaled surfaces do not inherit theme and density from `.wd-root`. */
export function usePortalThemeAttributes() {
  const { theme, density } = useDesignSystem();
  return { "data-wd-theme": theme, "data-wd-density": density } as const;
}
