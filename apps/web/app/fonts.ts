import { Cormorant_Garamond, Inter, JetBrains_Mono, Montserrat, Playfair_Display, Noto_Sans_Arabic, Plus_Jakarta_Sans, Noto_Sans_Devanagari, Noto_Sans_Telugu, Noto_Sans_Malayalam, Noto_Sans_Tamil } from "next/font/google";

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

// Rounded geometric Latin type; Noto families cover the supported scripts.
export const jakarta = Plus_Jakarta_Sans({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-jakarta", fallback: ["Arial", "sans-serif"] });
export const notoHindi = Noto_Sans_Devanagari({ subsets: ["devanagari"], display: "swap", preload: false, variable: "--font-noto-hindi" });
export const notoTelugu = Noto_Sans_Telugu({ subsets: ["telugu"], display: "swap", preload: false, variable: "--font-noto-telugu" });
export const notoMalayalam = Noto_Sans_Malayalam({ subsets: ["malayalam"], display: "swap", preload: false, variable: "--font-noto-malayalam" });
export const notoTamil = Noto_Sans_Tamil({ subsets: ["tamil"], display: "swap", preload: false, variable: "--font-noto-tamil" });
// Editorial faces for client documents (quotation styles); not preloaded on app pages.
export const cormorant = Cormorant_Garamond({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700"], display: "swap", preload: false, variable: "--font-cormorant", fallback: ["Georgia", "serif"] });
export const playfair = Playfair_Display({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, variable: "--font-playfair", fallback: ["Georgia", "serif"] });
export const fontVariables = `${jakarta.variable} ${cormorant.variable} ${playfair.variable} ${inter.variable} ${montserrat.variable} ${jetBrainsMono.variable} ${notoSansArabic.variable} ${notoHindi.variable} ${notoTelugu.variable} ${notoMalayalam.variable} ${notoTamil.variable}`;
