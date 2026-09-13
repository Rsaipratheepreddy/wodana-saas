import { Inter, Noto_Sans_Arabic } from "next/font/google";

export const inter = Inter({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  fallback: ["Arial", "sans-serif"],
  variable: "--font-inter",
});

export const notoSansArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  display: "swap",
  fallback: ["Tahoma", "Arial", "sans-serif"],
  variable: "--font-noto-arabic",
});

export const fontVariables = `${inter.variable} ${notoSansArabic.variable}`;
