import { describe, expect, it, vi } from "vitest";
import { effectivePortalBrand, portalOwnedBrand } from "./effective-brand";

const stale = { name: "Old name", logo: "data:image/png;base64,AAAA", primaryColor: "#76538f", accentColor: "#e99a72", welcomeTitle: "Welcome home", welcomeText: "Track your villa", supportPhone: "+971 4 000 0000", layout: "soft" as const };

describe("one tenant brand for portal, quotes and vendor pages", () => {
  it("takes name, logo and colours from the tenant record and keeps only portal content", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ name: "Palm Living", slug: "palm-living", logoUrl: null, logoAssetId: "a1", primaryColor: "#0f5c4a", secondaryColor: null }] }) };
    const brand = await effectivePortalBrand(db as never, "w1", stale);
    expect(brand).toEqual({
      name: "Palm Living", logo: "/api/auth/tenant-logo/palm-living?v=a1", primaryColor: "#0f5c4a", accentColor: "#0f5c4a",
      welcomeTitle: "Welcome home", welcomeText: "Track your villa", supportPhone: "+971 4 000 0000", layout: "soft",
    });
  });

  it("falls back to a neutral brand, never the old purple and peach", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const brand = await effectivePortalBrand(db as never, "w1", null);
    expect(brand.primaryColor).toBe("#292d32");
    expect(brand.logo).toBe("");
  });

  it("stores only portal-owned content", () => {
    expect(portalOwnedBrand(stale)).toEqual({ welcomeTitle: "Welcome home", welcomeText: "Track your villa", supportPhone: "+971 4 000 0000", layout: "soft" });
  });
});
