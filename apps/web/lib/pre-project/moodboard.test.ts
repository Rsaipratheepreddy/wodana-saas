import { describe, expect, it } from "vitest";
import { blankEntry, type ScopeEntry } from "./content";
import { clampZoom, fitView, layoutPins, linkPlatform, pinKind, zoomAround } from "./moodboard";

const pin = (over: Partial<ScopeEntry> = {}): ScopeEntry => ({ ...blankEntry(), kind: "inspiration", ...over });

describe("moodboard", () => {
  it("knows each pin's kind and each link's platform", () => {
    expect(pinKind(pin({ assets: [{ id: "a", name: "a.jpg", mimeType: "image/jpeg", byteSize: 1, hasPreview: true }], referenceUrl: "https://x.test" }))).toBe("image");
    expect(pinKind(pin({ referenceUrl: "https://www.instagram.com/p/abc/" }))).toBe("link");
    expect(pinKind(pin())).toBe("note");
    expect(linkPlatform("https://www.instagram.com/reel/xyz/")).toMatchObject({ id: "instagram", label: "Instagram" });
    expect(linkPlatform("https://youtu.be/abc")).toMatchObject({ id: "youtube" });
    expect(linkPlatform("https://pin.it/abc")).toMatchObject({ id: "pinterest" });
    expect(linkPlatform("https://studio.example.com/ideas")).toMatchObject({ id: "web", label: "studio.example.com" });
  });

  it("keeps placed pins and flows new ones below them without overlap", () => {
    const placed = pin({ id: "p", board: { x: 40, y: 40, width: 300, z: 7, sentiment: "avoid" } });
    const layout = layoutPins([placed, pin({ id: "a" }), pin({ id: "b" })], 2);
    expect(layout.get("p")).toEqual(placed.board);
    expect(layout.get("a")!.y).toBeGreaterThan(40 + 300);
    expect(layout.get("b")!.x).toBeGreaterThan(layout.get("a")!.x);
    expect(layout.get("a")!.z).toBeGreaterThan(7);
  });

  it("zooms around the cursor and fits the board", () => {
    expect(clampZoom(9)).toBe(2.5);
    expect(clampZoom(0.01)).toBe(0.25);
    const next = zoomAround({ x: 0, y: 0, zoom: 1 }, { x: 100, y: 100 }, 2);
    expect(next).toEqual({ zoom: 2, x: -100, y: -100 });
    const fit = fitView([{ x: 0, y: 0, width: 240, z: 1, sentiment: "love" }, { x: 2000, y: 0, width: 240, z: 2, sentiment: "love" }], { width: 1000, height: 700 });
    expect(fit.zoom).toBeLessThan(1);
  });
});
