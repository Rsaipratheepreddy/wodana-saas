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
  /** The workspace's working day ("09:00"–"18:00"), from its work calendar. Null when unknown. */
  workingHours: { start: string; end: string } | null;
  portalContainer: Element | null;
  /**
   * The theme above follows the document rather than a provider's choice. Spreading `useDesignSystem()` into a
   * nested provider hands this on, so the nested one follows the document too instead of pinning `theme`.
   */
  followsDocumentTheme?: boolean;
};

export type DesignSystemProviderProps = Omit<HTMLAttributes<HTMLDivElement>, "dir"> &
  Partial<Omit<DesignSystemSettings, "portalContainer">> & {
    children: ReactNode;
    portalContainer?: Element | null;
  };

const DEFAULT_SETTINGS: DesignSystemSettings = {
  theme: "light",
  density: "compact",
  locale: "en",
  regionLocale: "en",
  direction: "ltr",
  currency: "USD",
  timeZone: "UTC",
  workingDays: null,
  holidays: [],
  workingHours: null,
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
 * Null on the server and while hydrating: the document's theme is only known in the browser (the root layout's
 * inline bootstrap sets it before paint), so the markup says "document" and the tokens follow <html>.
 */
function useInheritedTheme(): DesignSystemTheme | null {
  const chosen = useContext(ChosenThemeContext);
  const fromDocument = useSyncExternalStore(subscribeDocumentTheme, documentTheme, () => null);
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
      workingHours: workingHoursProp,
      portalContainer = null,
      followsDocumentTheme = false,
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
    const ownTheme = followsDocumentTheme ? undefined : themeProp;
    const resolvedTheme = ownTheme ?? inheritedTheme;
    const theme = resolvedTheme ?? DEFAULT_SETTINGS.theme;
    const follows = !ownTheme && !chosenTheme;
    // A provider handed a full settings object (e.g. a nested provider re-using its parent's) keeps its region.
    const regionLocale = regionLocaleProp ?? localeProp ?? parent.regionLocale;
    const currency = currencyProp ?? parent.currency;
    const timeZone = timeZoneProp ?? parent.timeZone;
    const workingDays = workingDaysProp ?? parent.workingDays;
    const holidays = holidaysProp ?? parent.holidays;
    const workingHours = workingHoursProp ?? parent.workingHours;
    const uiLanguage = useContext(UiLanguageContext);
    const locale = formattingLocale(uiLanguage, regionLocale);
    const direction = directionOverride ?? languageDirection(uiLanguage ?? locale);
    // A forced direction (an LTR island inside an RTL page) needs a locale that reads that way.
    const ariaLocale = languageDirection(locale) === direction ? locale
      : [regionLocale, uiLanguage ?? "", direction === "rtl" ? "ar" : "en"].find((tag) => tag && languageDirection(tag) === direction) ?? locale;
    const value = useMemo(
      () => ({ theme, density, locale, regionLocale, direction, currency, timeZone, workingDays, holidays, workingHours, portalContainer, followsDocumentTheme: follows }),
      [theme, density, locale, regionLocale, direction, currency, timeZone, workingDays, holidays, workingHours, portalContainer, follows],
    );

    return (
      <ChosenThemeContext.Provider value={ownTheme ?? chosenTheme}>
      <DesignSystemContext.Provider value={value}>
        <I18nProvider locale={ariaLocale}>
          <div
            {...props}
            className={["wd-root", className].filter(Boolean).join(" ")}
            data-wd-density={density}
            data-wd-theme={resolvedTheme ?? "document"}
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
export function WorkspaceRegionProvider({ locale, currency, timeZone, workingDays, holidays, workingHours, children }: { locale?: string; currency?: string; timeZone?: string; workingDays?: number[]; holidays?: string[]; workingHours?: { start: string; end: string }; children: ReactNode }) {
  const parent = useContext(DesignSystemContext);
  const uiLanguage = useContext(UiLanguageContext);
  const value = useMemo(() => {
    const regionLocale = locale ?? parent.regionLocale;
    const formatting = formattingLocale(uiLanguage, regionLocale);
    // The reading direction follows the person's language here too: a page that re-uses these settings for its own
    // provider ({...useDesignSystem()}) must not inherit the default left-to-right in Arabic.
    return { ...parent, locale: formatting, regionLocale, direction: languageDirection(uiLanguage ?? formatting), currency: currency ?? parent.currency, timeZone: timeZone ?? parent.timeZone,
      workingDays: workingDays?.length ? workingDays : parent.workingDays, holidays: holidays ?? parent.holidays, workingHours: workingHours ?? parent.workingHours };
  }, [parent, uiLanguage, locale, currency, timeZone, workingDays, holidays, workingHours]);
  // Date and number fields read the region too (a day typed as 12/10 is 12 October in en-AE), on every page below,
  // not only on pages that open their own provider.
  const ariaLocale = languageDirection(value.locale) === value.direction ? value.locale
    : [value.regionLocale, uiLanguage ?? "", value.direction === "rtl" ? "ar" : "en"].find((tag) => tag && languageDirection(tag) === value.direction) ?? value.locale;
  return <DesignSystemContext.Provider value={value}><I18nProvider locale={ariaLocale}>{children}</I18nProvider></DesignSystemContext.Provider>;
}

export function useDesignSystem(): DesignSystemSettings {
  const settings = useContext(DesignSystemContext);
  const theme = useInheritedTheme() ?? settings.theme;
  return useMemo(() => (settings.theme === theme ? settings : { ...settings, theme }), [settings, theme]);
}

/** Portaled surfaces do not inherit theme and density from `.wd-root`. */
export function usePortalThemeAttributes() {
  const { theme, density } = useDesignSystem();
  return { "data-wd-theme": theme, "data-wd-density": density } as const;
}
