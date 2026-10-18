import { describe, expect, it, vi } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { LocalAuthService } from "./local-auth.service";

describe("public custom-host sign-in binding", () => {
  it("resolves only an active organization with fresh ownership, TLS and routing evidence", async () => {
    const branding = {
      displayName: "Example", loginSlug: "example", logoUrl: null, primaryColor: "#E4E3DE",
      secondaryColor: "#000000", headingFont: "alta", bodyFont: "montserrat",
      loginBackgroundUrl: "/api/auth/tenant-background/example?v=7c1d0c2e-3b51-4a39-9f6e-0d7c1a2b3c4d",
    };
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [branding] });
    const service = new LocalAuthService({ query } as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.getTenantBrandingForHost("portal.example.com")).resolves.toEqual(branding);
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM wodana_public_tenant_host($1::varchar) host");
    // The sign-in background comes from the same public branding row as the slug's own lookup.
    expect(sql).toContain("'/api/auth/tenant-background/' || login_slug");
    expect(values).toEqual(["portal.example.com"]);
  });

  it("gives a tenant's own sign-in background by slug, and none when it has not set one", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ displayName: "Example", loginSlug: "example", loginBackgroundUrl: null }] });
    const service = new LocalAuthService({ query } as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.getTenantBranding("example")).resolves.toMatchObject({ loginBackgroundUrl: null });
    expect(query.mock.calls[0][0]).toContain("WHEN login_background_asset_id IS NOT NULL");
  });

  it("fails closed for an unknown, removed or incomplete host", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const service = new LocalAuthService({ query } as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.getTenantBrandingForHost("unbound.example.com")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getTenantBrandingForHost("bad:443/path")).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("public organization sign-in lookup", () => {
  const palm = {
    displayName: "Palm Living", loginSlug: "palm-living", logoUrl: null,
    primaryColor: "#E4E3DE", secondaryColor: "#000000", headingFont: "alta", bodyFont: "montserrat",
  };

  it("accepts a slug or workspace ID without searching names", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [palm] });
    const service = new LocalAuthService({ query } as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.resolveOrganization("Palm Living")).resolves.toEqual(palm);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("branding.login_slug = $1 OR branding.workspace_id::text = $2"), ["palm-living", "palm living"]);
    await expect(service.resolveOrganization("00000000-0000-4000-8000-000000000001")).resolves.toEqual(palm);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("falls back to exact case-insensitive name and rejects ambiguous names", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [palm] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 2, rows: [palm, { ...palm, loginSlug: "other" }] });
    const service = new LocalAuthService({ query } as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.resolveOrganization("Palm Living")).resolves.toEqual(palm);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("lower(branding.display_name) = $1"), ["palm living"]);
    await expect(service.resolveOrganization("Palm Living")).rejects.toBeInstanceOf(ConflictException);
  });

  it("does not resolve unknown organizations", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const service = new LocalAuthService({ query } as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.resolveOrganization("Unknown Company")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("keeps an archived organization's login address closed, by slug and by name", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const service = new LocalAuthService({ query } as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.getTenantBranding("retired-studio")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.resolveOrganization("Retired Studio")).rejects.toBeInstanceOf(NotFoundException);
    for (const [sql] of query.mock.calls) expect(sql).toContain("tenant_login_open(");
    expect(query).toHaveBeenCalledTimes(3);
  });
});
