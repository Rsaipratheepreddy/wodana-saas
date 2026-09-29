import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { translator } from "@/lib/i18n/messages";
import images from "./landing-images.json";
import { SHOTS } from "./landing-shots";
import { Screenshot } from "./screenshot";

const t = translator("en");
const KB = 1024;

describe("landing screenshots", () => {
  it("serves static AVIF and WebP variants, dark first, with no runtime optimizer", () => {
    const { container } = render(<Screenshot priority shot={SHOTS.home} sizes="71rem" t={t} />);
    const image = screen.getByRole("img", { name: "Wodana home with the day's work across sales and projects" });
    expect(image).toHaveAttribute("loading", "eager");
    expect(image).toHaveAttribute("fetchpriority", "high");
    expect(image).toHaveAttribute("width", "2880");
    expect(image).toHaveAttribute("height", "1800");
    expect(image.getAttribute("src")).toMatch(/^\/landing\/opt\/home-1080\.[0-9a-f]{8}\.webp$/);
    const sources = [...container.querySelectorAll("source")].map((source) => [source.getAttribute("type"), source.getAttribute("media")]);
    expect(sources).toEqual([
      ["image/avif", "(prefers-color-scheme: dark)"], ["image/webp", "(prefers-color-scheme: dark)"], ["image/avif", null], ["image/webp", null],
    ]);
    expect(container.innerHTML).not.toContain("/_next/image");
  });

  it("keeps a deferred screen empty until the page has loaded", async () => {
    Object.defineProperty(document, "readyState", { configurable: true, get: () => "loading" });
    render(<Screenshot decorative defer shot={SHOTS.pipeline} sizes="71rem" t={t} />);
    const image = document.querySelector("img")!;
    expect(image).not.toHaveAttribute("src");
    expect(document.querySelector("source")).toBeNull();
    Object.defineProperty(document, "readyState", { configurable: true, get: () => "complete" });
    await act(async () => { window.dispatchEvent(new Event("load")); });
    const loaded = document.querySelector("img")!;
    expect(loaded.getAttribute("src")).toMatch(/pipeline-1080\./);
    expect(loaded).toHaveAttribute("loading", "lazy");
    expect(loaded).toHaveAttribute("decoding", "async");
    expect(document.querySelectorAll("source")).toHaveLength(4);
    Reflect.deleteProperty(document, "readyState");
  });

  it("has every generated variant on disk, no larger than 1440 pixels and within the size budget", () => {
    type Variant = { w: number; avif: string; webp: string };
    for (const [name, entry] of Object.entries(images) as [string, { light: Variant[]; dark?: Variant[] }][]) {
      const phone = name.startsWith("app-");
      for (const variant of [...entry.light, ...(entry.dark ?? [])]) {
        expect(variant.w).toBeLessThanOrEqual(1440);
        for (const path of [variant.avif, variant.webp]) {
          const file = join(process.cwd(), "public", path);
          expect(existsSync(file), path).toBe(true);
          if (path.endsWith(".avif")) expect(statSync(file).size, path).toBeLessThanOrEqual((phone ? 40 : 90) * KB);
        }
      }
    }
  });
});
