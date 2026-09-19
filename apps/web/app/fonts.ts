import { Inter, JetBrains_Mono, Montserrat, Noto_Sans_Arabic } from "next/font/google";

export const inter = Inter({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  fallback: ["Arial", "sans-serif"],
  adjustFontFallback: true,
  variable: "--font-inter",
});

export const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  fallback: ["Consolas", "monospace"],
  adjustFontFallback: true,
  preload: false,
  variable: "--font-jetbrains-mono",
});

export const montserrat = Montserrat({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  fallback: ["Arial", "sans-serif"],
  adjustFontFallback: true,
  variable: "--font-montserrat",
});

export const notoSansArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  display: "swap",
  fallback: ["Tahoma", "Arial", "sans-serif"],
  preload: false,
  variable: "--font-noto-arabic",
});

export const fontVariables = `${inter.variable} ${montserrat.variable} ${jetBrainsMono.variable} ${notoSansArabic.variable}`;
