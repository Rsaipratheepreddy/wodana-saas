import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(resolve(process.cwd(), "styles/tokens.css"), "utf8");
const globals = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

function relativeLuminance(hex: string) {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);

  if (!channels || channels.length !== 3) {
    throw new Error(`Invalid color: ${hex}`);
  }

  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("web foundations", () => {
  it("defines the semantic contracts used by product UI", () => {
    const requiredTokens = [
      "--wd-color-canvas",
      "--wd-color-surface",
      "--wd-color-text",
      "--wd-color-text-secondary",
      "--wd-color-border",
      "--wd-color-action-primary",
      "--wd-color-action-on-primary",
      "--wd-color-focus",
      "--wd-font-sans",
      "--wd-font-arabic",
      "--wd-control-md",
      "--wd-table-row",
      "--wd-duration-fast",
      "--wd-radius-sm",
    ];

    requiredTokens.forEach((token) => expect(tokens).toContain(token));
  });

  it("keeps compatibility contracts while the web app migrates", () => {
    ["--wd-ink", "--wd-muted", "--wd-line", "--wd-surface", "--wd-focus"].forEach(
      (token) => expect(tokens).toContain(token),
    );
  });

  it("supports themes, density and reduced motion", () => {
    expect(tokens).toContain('[data-theme="dark"]');
    expect(tokens).toContain('[data-theme="high-contrast"]');
    expect(tokens).toContain('[data-density="compact"]');
    expect(tokens).toContain("prefers-reduced-motion: reduce");
  });

  it("meets WCAG AA contrast for core light and dark combinations", () => {
    expect(contrast("#1a1e1c", "#f8f8f6")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#555b56", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#676d68", "#f1f2ef")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", "#46705a")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#f2f4f1", "#141715")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#bdc3bd", "#1b1f1d")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#111111", "#8fbba2")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps global CSS structural and supports Arabic, RTL and numeric data", () => {
    expect(globals).toContain(":lang(ar)");
    expect(globals).toContain('[dir="rtl"]');
    expect(globals).toContain("unicode-bidi: isolate");
    expect(globals).toContain("font-variant-numeric: tabular-nums");
    expect(globals).toContain("@keyframes wd-root-enter");
    expect(globals).not.toMatch(/(?:^|\n)main\s*\{/);
    expect(globals).not.toMatch(/(?:^|\n)nav\s*\{/);
    expect(globals).not.toMatch(/(?:^|\n)h1\s*\{/);
  });
});
