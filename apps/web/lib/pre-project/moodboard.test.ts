import { describe, expect, it } from "vitest";
import { blankEntry, type ScopeEntry } from "./content";
import { linkPlatform, pinKind } from "./moodboard";

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
});
