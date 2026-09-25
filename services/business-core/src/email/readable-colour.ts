const HEX = /^#[0-9a-f]{6}$/i;

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const rgb = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const hex = (values: number[]) => `#${values.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** Contrast of a colour against white text (WCAG ratio). */
export function contrastWithWhite(color: string) {
  return 1.05 / (luminance(rgb(color)) + 0.05);
}

/**
 * Tenant brand colours are used as button and header fills with white text in the client portal,
 * documents and email. Keeps the hue but darkens a light colour until white text reads at 4.5:1.
 */
export function readableOnWhite(color: string | null | undefined, fallback: string): string {
  if (!color || !HEX.test(color)) return fallback;
  if (contrastWithWhite(color) >= 4.5) return color;
  const base = rgb(color);
  for (let keep = 1; keep >= 0; keep -= 0.02) {
    const candidate = base.map((value) => value * keep);
    if (1.05 / (luminance(candidate) + 0.05) >= 4.5) return hex(candidate);
  }
  return "#000000";
}
