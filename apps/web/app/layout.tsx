import type { Metadata } from "next";
import { cookies } from "next/headers";
import { RouteFade } from "@/components/route-fade";
import { BlockedSaveBoundary } from "@/design-system/foundations/blocked-save-alert";
import { I18nProvider } from "@/lib/i18n/i18n-provider";
import { LANGUAGE_COOKIE, languageDirection, resolveLanguage } from "@/lib/i18n/languages";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wodana SaaS",
  description: "The operating system for interior-design businesses.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The document follows the chosen language; screens that are not yet translated set their own direction.
  const language = resolveLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value);
  return (
    <html
      className={fontVariables}
      data-density="comfortable"
      data-theme="light"
      dir={languageDirection(language)}
      lang={language}
    >
      <body data-app-root>
        <I18nProvider language={language}><BlockedSaveBoundary>{children}</BlockedSaveBoundary></I18nProvider>
        <RouteFade />
      </body>
    </html>
  );
}
