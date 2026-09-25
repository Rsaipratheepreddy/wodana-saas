import { describe, expect, it, vi } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { LocalAuthService } from "./local-auth.service";

describe("public custom-host sign-in binding", () => {
  it("resolves only an active organization with fresh ownership, TLS and routing evidence", async () => {
    const branding = {
      displayName: "Example", loginSlug: "example", logoUrl: null, primaryColor: "#E4E3DE",
      secondaryColor: "#000000", headingFont: "alta", bodyFont: "montserrat",
    };
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [branding] });
    const service = new LocalAuthService({ query } as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.getTenantBrandingForHost("portal.example.com")).resolves.toEqual(branding);
    expect(query).toHaveBeenCalledWith("SELECT * FROM wodana_public_tenant_host($1::varchar)", ["portal.example.com"]);
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
});
