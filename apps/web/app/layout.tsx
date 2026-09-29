import type { Metadata } from "next";
import { RouteFade } from "@/components/route-fade";
import { BlockedSaveBoundary } from "@/design-system/foundations/blocked-save-alert";
import { I18nProvider } from "@/lib/i18n/i18n-provider";
import { languageDirection } from "@/lib/i18n/languages";
import { dictionaryFor } from "@/lib/i18n/messages";
import { getServerLanguage } from "@/lib/i18n/server";
import { themeBootstrapScript } from "@/lib/theme-bootstrap";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wodana SaaS",
  description: "The operating system for interior-design businesses.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The document follows the chosen language (the language cookie); the workspace layout refines it for a
  // signed-in person who has not chosen on this device yet.
  const language = await getServerLanguage();
  return (
    <html
      className={fontVariables}
      data-density="comfortable"
      data-theme="light"
      dir={languageDirection(language)}
      lang={language}
      // The bootstrap below swaps data-theme for the stored or device theme before paint.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body data-app-root>
        <I18nProvider dictionary={dictionaryFor(language)} language={language}><BlockedSaveBoundary>{children}</BlockedSaveBoundary></I18nProvider>
        <RouteFade />
      </body>
    </html>
  );
}
