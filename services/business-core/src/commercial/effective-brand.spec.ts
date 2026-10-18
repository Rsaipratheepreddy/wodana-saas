import { describe, expect, it, vi } from "vitest";
import { effectivePortalBrand } from "./effective-brand";

describe("one tenant brand for quotes, the gallery and vendor pages", () => {
  it("takes name, logo and colours from the tenant record and the welcome text from the portal settings", async () => {
    const db = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ name: "Palm Living", slug: "palm-living", logoUrl: null, logoAssetId: "a1", primaryColor: "#0f5c4a", secondaryColor: null }] })
      .mockResolvedValueOnce({ rows: [{ welcomeTitle: "Welcome home", welcomeText: "Track your villa", supportPhone: "+97140000000" }] }) };
    const brand = await effectivePortalBrand(db as never, "w1");
    expect(brand).toEqual({
      name: "Palm Living", logo: "/api/auth/tenant-logo/palm-living?v=a1", primaryColor: "#0f5c4a", accentColor: "#0f5c4a",
      welcomeTitle: "Welcome home", welcomeText: "Track your villa", supportPhone: "+97140000000", layout: "minimal",
    });
  });

  it("falls back to a neutral brand, never the old purple and peach", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const brand = await effectivePortalBrand(db as never, "w1");
    expect(brand.primaryColor).toBe("#292d32");
    expect(brand.logo).toBe("");
  });
});
