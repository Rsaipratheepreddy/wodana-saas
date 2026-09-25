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
import { languageDirection } from "@/lib/i18n/languages";
import { I18nProvider } from "react-aria-components";

export type DesignSystemTheme = "light" | "dark" | "high-contrast";
export type DesignSystemDensity = "compact" | "comfortable";
export type DesignSystemDirection = "ltr" | "rtl";

export type DesignSystemSettings = {
  theme: DesignSystemTheme;
  density: DesignSystemDensity;
  locale: string;
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
  locale: "en-IN",
  direction: "ltr",
  currency: "INR",
  timeZone: "Asia/Kolkata",
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
      locale = DEFAULT_SETTINGS.locale,
      direction: directionOverride,
      currency = DEFAULT_SETTINGS.currency,
      timeZone = DEFAULT_SETTINGS.timeZone,
      portalContainer = null,
      ...props
    },
    ref,
  ) {
    // Text direction follows the UI language the person chose; the workspace locale only formats
    // numbers, dates and money. React Aria gets a locale in that language so keyboard and overlay
    // placement mirror too.
    const uiLanguage = useContext(UiLanguageContext);
    const direction = directionOverride ?? languageDirection(uiLanguage ?? locale);
    const region = locale.split("-")[1];
    const ariaLocale = uiLanguage && languageDirection(locale) !== direction ? (region ? `${uiLanguage}-${region}` : uiLanguage) : locale;
    const value = useMemo(
      () => ({ theme, density, locale, direction, currency, timeZone, portalContainer }),
      [theme, density, locale, direction, currency, timeZone, portalContainer],
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

export function useDesignSystem(): DesignSystemSettings {
  return useContext(DesignSystemContext);
}

/** Portaled surfaces do not inherit theme and density from `.wd-root`. */
export function usePortalThemeAttributes() {
  const { theme, density } = useDesignSystem();
  return { "data-wd-theme": theme, "data-wd-density": density } as const;
}
