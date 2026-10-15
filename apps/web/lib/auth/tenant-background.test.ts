import { describe, expect, it } from "vitest";
import { tenantBackgroundUrl } from "./tenant-background";

describe("tenantBackgroundUrl", () => {
  it("is null when the tenant has no background of its own, so the default image shows", () => {
    expect(tenantBackgroundUrl("palm-living", null)).toBeNull();
    expect(tenantBackgroundUrl("palm-living", undefined)).toBeNull();
  });

  it("is this app's address for the tenant, versioned by the asset", () => {
    expect(tenantBackgroundUrl("palm-living", "/api/auth/tenant-background/palm-living?v=7C1D0C2E-3B51-4A39-9F6E-0D7C1A2B3C4D"))
      .toBe("/api/auth/tenant-background/palm-living?v=7c1d0c2e-3b51-4a39-9f6e-0d7c1a2b3c4d");
  });

  it("never carries anything else from the backend into the CSS url()", () => {
    expect(tenantBackgroundUrl("palm-living", `https://evil.example/x.jpg?v=1") ; background: red`)).toBe("/api/auth/tenant-background/palm-living");
    expect(tenantBackgroundUrl("Bad Slug\")", "/api/auth/tenant-background/x?v=7c1d0c2e-3b51-4a39-9f6e-0d7c1a2b3c4d")).toBeNull();
  });
});
