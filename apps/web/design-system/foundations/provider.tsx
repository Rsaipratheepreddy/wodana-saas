"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useMemo,
  type HTMLAttributes,
  type ReactNode,
} from "react";
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
      direction = locale.startsWith("ar") ? "rtl" : DEFAULT_SETTINGS.direction,
      currency = DEFAULT_SETTINGS.currency,
      timeZone = DEFAULT_SETTINGS.timeZone,
      portalContainer = null,
      ...props
    },
    ref,
  ) {
    const value = useMemo(
      () => ({ theme, density, locale, direction, currency, timeZone, portalContainer }),
      [theme, density, locale, direction, currency, timeZone, portalContainer],
    );

    return (
      <DesignSystemContext.Provider value={value}>
        <I18nProvider locale={locale}>
          <div
            {...props}
            className={["wd-root", className].filter(Boolean).join(" ")}
            data-wd-density={density}
            data-wd-theme={theme}
            dir={direction}
            lang={locale}
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
