"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useMemo,
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
  portalContainer: null,
};

const DesignSystemContext = createContext<DesignSystemSettings>(DEFAULT_SETTINGS);

export const DesignSystemProvider = forwardRef<HTMLDivElement, DesignSystemProviderProps>(
  function DesignSystemProvider(
    {
      children,
      className,
      theme = DEFAULT_SETTINGS.theme,
      density = DEFAULT_SETTINGS.density,
      locale: localeProp,
      regionLocale: regionLocaleProp,
      direction: directionOverride,
      currency: currencyProp,
      timeZone: timeZoneProp,
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
    // A provider handed a full settings object (e.g. a nested provider re-using its parent's) keeps its region.
    const regionLocale = regionLocaleProp ?? localeProp ?? parent.regionLocale;
    const currency = currencyProp ?? parent.currency;
    const timeZone = timeZoneProp ?? parent.timeZone;
    const uiLanguage = useContext(UiLanguageContext);
    const locale = formattingLocale(uiLanguage, regionLocale);
    const direction = directionOverride ?? languageDirection(uiLanguage ?? locale);
    // A forced direction (an LTR island inside an RTL page) needs a locale that reads that way.
    const ariaLocale = languageDirection(locale) === direction ? locale
      : [regionLocale, uiLanguage ?? "", direction === "rtl" ? "ar" : "en"].find((tag) => tag && languageDirection(tag) === direction) ?? locale;
    const value = useMemo(
      () => ({ theme, density, locale, regionLocale, direction, currency, timeZone, portalContainer }),
      [theme, density, locale, regionLocale, direction, currency, timeZone, portalContainer],
    );

    return (
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
    );
  },
);

/** Sets the workspace region for every design-system provider below it. */
export function WorkspaceRegionProvider({ locale, currency, timeZone, children }: { locale?: string; currency?: string; timeZone?: string; children: ReactNode }) {
  const parent = useContext(DesignSystemContext);
  const uiLanguage = useContext(UiLanguageContext);
  const value = useMemo(() => {
    const regionLocale = locale ?? parent.regionLocale;
    return { ...parent, locale: formattingLocale(uiLanguage, regionLocale), regionLocale, currency: currency ?? parent.currency, timeZone: timeZone ?? parent.timeZone };
  }, [parent, uiLanguage, locale, currency, timeZone]);
  return <DesignSystemContext.Provider value={value}>{children}</DesignSystemContext.Provider>;
}

export function useDesignSystem(): DesignSystemSettings {
  return useContext(DesignSystemContext);
}

/** Portaled surfaces do not inherit theme and density from `.wd-root`. */
export function usePortalThemeAttributes() {
  const { theme, density } = useDesignSystem();
  return { "data-wd-theme": theme, "data-wd-density": density } as const;
}
