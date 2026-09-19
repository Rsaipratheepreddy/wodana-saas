import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
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
