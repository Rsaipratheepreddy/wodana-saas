import type { CSSProperties } from "react";

export const DEFAULT_WORKSPACE_PRIMARY_COLOR = "#0B7F5D";
export const WORKSPACE_PRIMARY_COLOR_EVENT = "wodana:workspace-primary-color";

type Rgb = { red: number; green: number; blue: number };
type WorkspaceBrandStyle = CSSProperties & Record<`--wd-workspace-brand-${string}`, string>;

function parseHex(value: string): Rgb {
  return {
    red: Number.parseInt(value.slice(1, 3), 16),
    green: Number.parseInt(value.slice(3, 5), 16),
    blue: Number.parseInt(value.slice(5, 7), 16),
  };
}

function toHex({ red, green, blue }: Rgb): string {
  return `#${[red, green, blue]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function mix(color: Rgb, target: Rgb, targetWeight: number): Rgb {
  return {
    red: color.red + (target.red - color.red) * targetWeight,
    green: color.green + (target.green - color.green) * targetWeight,
    blue: color.blue + (target.blue - color.blue) * targetWeight,
  };
}

function luminance(color: Rgb): number {
  const channels = [color.red, color.green, color.blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(left: Rgb, right: Rgb): number {
  const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function readableForeground(background: Rgb): Rgb {
  const white = parseHex("#FFFFFF");
  const ink = parseHex("#111111");
  return contrast(background, white) >= contrast(background, ink) ? white : ink;
}

function ensureContrast(color: Rgb, background: Rgb, target: Rgb, minimum: number): Rgb {
  if (contrast(color, background) >= minimum) return color;
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(color, target, step / 20);
    if (contrast(candidate, background) >= minimum) return candidate;
  }
  return target;
}

export function normalizeWorkspacePrimaryColor(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null;
}

export function workspacePrimaryColorStyle(value: string | null | undefined): WorkspaceBrandStyle | undefined {
  const normalized = normalizeWorkspacePrimaryColor(value);
  if (!normalized) return undefined;

  const seed = parseHex(normalized);
  const white = parseHex("#FFFFFF");
  const black = parseHex("#000000");
  const darkSurface = parseHex("#181818");
  const lightForeground = readableForeground(seed);
  const darkPrimary = ensureContrast(seed, darkSurface, white, 3);
  const darkForeground = readableForeground(darkPrimary);
  const lightPalette = [0.92, 0.83, 0.68, 0.48, 0.27, 0.1].map((weight) => toHex(mix(seed, white, weight)));
  const darkPalette = [0.2, 0.28, 0.38, 0.48, 0.58, 0.7].map((weight) => toHex(mix(seed, darkSurface, weight)));

  return {
    "--wd-workspace-brand-light-50": lightPalette[0],
    "--wd-workspace-brand-light-100": lightPalette[1],
    "--wd-workspace-brand-light-200": lightPalette[2],
    "--wd-workspace-brand-light-300": lightPalette[3],
    "--wd-workspace-brand-light-400": lightPalette[4],
    "--wd-workspace-brand-light-500": lightPalette[5],
    "--wd-workspace-brand-light-600": normalized,
    "--wd-workspace-brand-light-700": toHex(mix(seed, black, 0.16)),
    "--wd-workspace-brand-light-800": toHex(mix(seed, black, 0.3)),
    "--wd-workspace-brand-light-900": toHex(mix(seed, black, 0.42)),
    "--wd-workspace-brand-light-950": toHex(mix(seed, black, 0.65)),
    "--wd-workspace-brand-light-on": toHex(lightForeground),
    "--wd-workspace-brand-dark-50": darkPalette[0],
    "--wd-workspace-brand-dark-100": darkPalette[1],
    "--wd-workspace-brand-dark-200": darkPalette[2],
    "--wd-workspace-brand-dark-300": darkPalette[3],
    "--wd-workspace-brand-dark-400": darkPalette[4],
    "--wd-workspace-brand-dark-500": darkPalette[5],
    "--wd-workspace-brand-dark-600": toHex(darkPrimary),
    "--wd-workspace-brand-dark-700": toHex(mix(darkPrimary, white, 0.12)),
    "--wd-workspace-brand-dark-800": toHex(mix(darkPrimary, white, 0.24)),
    "--wd-workspace-brand-dark-900": toHex(mix(darkPrimary, white, 0.34)),
    "--wd-workspace-brand-dark-950": toHex(mix(darkPrimary, white, 0.48)),
    "--wd-workspace-brand-dark-on": toHex(darkForeground),
  };
}

export function announceWorkspacePrimaryColor(primaryColor: string | null): void {
  window.dispatchEvent(new CustomEvent(WORKSPACE_PRIMARY_COLOR_EVENT, { detail: { primaryColor } }));
}
