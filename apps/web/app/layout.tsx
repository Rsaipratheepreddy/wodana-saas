import type { Metadata } from "next";
import { RouteFade } from "@/components/route-fade";
import { fontVariables } from "./fonts";
import "flag-icons/css/flag-icons.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wodana SaaS",
  description: "The operating system for interior-design businesses.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      className={fontVariables}
      data-density="comfortable"
      data-theme="light"
      dir="ltr"
      lang="en"
    >
      <body data-app-root>
        {children}
        <RouteFade />
      </body>
    </html>
  );
}
