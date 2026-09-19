import type { CSSProperties } from "react";

export const DEFAULT_WORKSPACE_PRIMARY_COLOR = "#4A46F3";
export const WORKSPACE_PRIMARY_COLOR_EVENT = "wodana:workspace-primary-color";

type Rgb = { red: number; green: number; blue: number };
type Oklch = { lightness: number; chroma: number; hue: number };
export type WorkspaceBrandTheme = {
  primaryColor?: string | null;
  secondaryColor?: string | null;
  headingFont?: string | null;
  bodyFont?: string | null;
};

type WorkspaceBrandStyle = CSSProperties & Record<`--wd-${string}`, string>;

const WHITE: Rgb = { red: 255, green: 255, blue: 255 };
const INK: Rgb = { red: 17, green: 17, blue: 17 };

function parseHex(value: string): Rgb {
  return {
    red: Number.parseInt(value.slice(1, 3), 16),
    green: Number.parseInt(value.slice(3, 5), 16),
    blue: Number.parseInt(value.slice(5, 7), 16),
  };
}

function toHex({ red, green, blue }: Rgb): string {
  return `#${[red, green, blue]
    .map((channel) => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function mixRgb(foreground: Rgb, background: Rgb, foregroundWeight: number): Rgb {
  const weight = Math.max(0, Math.min(1, foregroundWeight));
  return {
    red: foreground.red * weight + background.red * (1 - weight),
    green: foreground.green * weight + background.green * (1 - weight),
    blue: foreground.blue * weight + background.blue * (1 - weight),
  };
}

function linearize(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function encode(channel: number): number {
  return 255 * (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055);
}

function luminance(color: Rgb): number {
  return linearize(color.red) * 0.2126 + linearize(color.green) * 0.7152 + linearize(color.blue) * 0.0722;
}

function contrast(left: Rgb, right: Rgb): number {
  const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function readableForeground(background: Rgb): Rgb {
  return contrast(background, WHITE) >= contrast(background, INK) ? WHITE : INK;
}

function toOklch(color: Rgb): Oklch {
  const red = linearize(color.red);
  const green = linearize(color.green);
  const blue = linearize(color.blue);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { lightness, chroma: Math.hypot(a, b), hue: Math.atan2(b, a) };
}

function linearRgb({ lightness, chroma, hue }: Oklch) {
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    red: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    green: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    blue: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

function colorAt(lightness: number, chroma: number, hue: number): Rgb {
  const targetLightness = Math.max(0, Math.min(1, lightness));
  let low = 0;
  let high = Math.max(0, chroma);
  for (let step = 0; step < 22; step += 1) {
    const middle = (low + high) / 2;
    const candidate = linearRgb({ lightness: targetLightness, chroma: middle, hue });
    if (Object.values(candidate).every((channel) => channel >= 0 && channel <= 1)) low = middle;
    else high = middle;
  }
  const color = linearRgb({ lightness: targetLightness, chroma: low, hue });
  return { red: encode(color.red), green: encode(color.green), blue: encode(color.blue) };
}

function accessibleLightPrimary(seed: Rgb, colour: Oklch): Rgb {
  if (contrast(seed, WHITE) >= 4.5) return seed;
  const chroma = Math.min(colour.chroma, 0.16);
  for (let lightness = colour.lightness; lightness >= 0; lightness -= 0.005) {
    const candidate = colorAt(lightness, chroma, colour.hue);
    if (contrast(candidate, WHITE) >= 4.5) return candidate;
  }
  return INK;
}

function accessibleLightText(lightness: number, chroma: number, hue: number): string {
  for (let next = lightness; next >= 0; next -= 0.005) {
    const candidate = colorAt(next, chroma, hue);
    if (contrast(candidate, WHITE) >= 4.5) return toHex(candidate);
  }
  return toHex(INK);
}

export function normalizeWorkspacePrimaryColor(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null;
}

export function workspacePrimaryColorStyle(value: string | null | undefined | WorkspaceBrandTheme): WorkspaceBrandStyle | undefined {
  const brand = typeof value === "object" && value !== null ? value : { primaryColor: value };
  const surfaceColor = normalizeWorkspacePrimaryColor(brand.primaryColor);
  const normalized = normalizeWorkspacePrimaryColor(brand.secondaryColor) ?? surfaceColor;
  const fontStyle: WorkspaceBrandStyle = {
    ...(brand.bodyFont === "montserrat" ? {
      "--wd-workspace-font-body": "var(--font-montserrat), Montserrat, ui-sans-serif, sans-serif",
    } : {}),
    ...(brand.headingFont === "alta" ? {
      "--wd-workspace-font-heading": "Alta, var(--font-montserrat), Montserrat, ui-sans-serif, sans-serif",
      "--wd-workspace-heading-transform": "uppercase",
      "--wd-workspace-heading-tracking": "0.045em",
    } : {}),
  };
  if (!normalized) return Object.keys(fontStyle).length ? fontStyle : undefined;

  const seed = parseHex(normalized);
  const source = toOklch(seed);
  const chroma = Math.min(source.chroma, 0.16);
  const lightPrimary = accessibleLightPrimary(seed, source);
  const primaryLightness = toOklch(lightPrimary).lightness;
  const lightStep = (weight: number, saturation: number) => toHex(colorAt(primaryLightness + (1 - primaryLightness) * weight, chroma * saturation, source.hue));
  const darkStep = (lightness: number, saturation: number) => toHex(colorAt(lightness, chroma * saturation * 0.85, source.hue));
  const darkPrimary = colorAt(0.75, chroma * 0.85, source.hue);
  const lightPalette = [
    lightStep(0.96, 0.08), lightStep(0.9, 0.18), lightStep(0.78, 0.36),
    lightStep(0.63, 0.56), lightStep(0.44, 0.75), lightStep(0.23, 0.9),
  ];
  const darkPalette = [
    darkStep(0.23, 0.25), darkStep(0.29, 0.35), darkStep(0.37, 0.5),
    darkStep(0.46, 0.65), darkStep(0.56, 0.78), darkStep(0.65, 0.9),
  ];

  if (surfaceColor && brand.secondaryColor) {
    const surface = parseHex(surfaceColor);
    lightPalette[0] = toHex(mixRgb(surface, WHITE, 0.3));
    lightPalette[1] = toHex(mixRgb(surface, WHITE, 0.55));
    lightPalette[2] = toHex(surface);
  }

  return {
    ...fontStyle,
    "--wd-workspace-brand-light-50": lightPalette[0],
    "--wd-workspace-brand-light-100": lightPalette[1],
    "--wd-workspace-brand-light-200": lightPalette[2],
    "--wd-workspace-brand-light-300": lightPalette[3],
    "--wd-workspace-brand-light-400": lightPalette[4],
    "--wd-workspace-brand-light-500": lightPalette[5],
    "--wd-workspace-brand-light-600": toHex(lightPrimary),
    "--wd-workspace-brand-light-700": accessibleLightText(Math.max(0, primaryLightness - 0.07), chroma * 0.9, source.hue),
    "--wd-workspace-brand-light-800": toHex(colorAt(Math.max(0, primaryLightness - 0.13), chroma * 0.8, source.hue)),
    "--wd-workspace-brand-light-900": toHex(colorAt(Math.max(0, primaryLightness - 0.2), chroma * 0.65, source.hue)),
    "--wd-workspace-brand-light-950": toHex(colorAt(Math.max(0, primaryLightness - 0.27), chroma * 0.5, source.hue)),
    "--wd-workspace-brand-light-on": toHex(WHITE),
    "--wd-workspace-brand-dark-50": darkPalette[0],
    "--wd-workspace-brand-dark-100": darkPalette[1],
    "--wd-workspace-brand-dark-200": darkPalette[2],
    "--wd-workspace-brand-dark-300": darkPalette[3],
    "--wd-workspace-brand-dark-400": darkPalette[4],
    "--wd-workspace-brand-dark-500": darkPalette[5],
    "--wd-workspace-brand-dark-600": toHex(darkPrimary),
    "--wd-workspace-brand-dark-700": darkStep(0.81, 0.78),
    "--wd-workspace-brand-dark-800": darkStep(0.87, 0.65),
    "--wd-workspace-brand-dark-900": darkStep(0.92, 0.48),
    "--wd-workspace-brand-dark-950": darkStep(0.96, 0.32),
    "--wd-workspace-brand-dark-on": toHex(readableForeground(darkPrimary)),
  };
}

export function announceWorkspacePrimaryColor(primaryColor: string | null): void {
  window.dispatchEvent(new CustomEvent(WORKSPACE_PRIMARY_COLOR_EVENT, { detail: { primaryColor } }));
}
