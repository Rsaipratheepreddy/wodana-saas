import type { Metadata } from "next";
import { cookies } from "next/headers";
import { RouteFade } from "@/components/route-fade";
import { LANGUAGE_COOKIE, languageDirection, resolveLanguage } from "@/lib/i18n/languages";
import { fontVariables } from "./fonts";
import "flag-icons/css/flag-icons.min.css";
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
        {children}
        <RouteFade />
      </body>
    </html>
  );
}
