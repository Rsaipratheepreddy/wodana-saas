import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { vendorCodeBase } from "./vendor-directory.service";
import { CreateVendorDto, CreateVendorSiteDto, VendorLifecycleDto } from "./vendor.dto";

describe("vendor directory contract", () => {
  it("generates stable, bounded internal codes without requiring the user to provide one", () => {
    expect(vendorCodeBase(" Al Noor Décor & Joinery ")).toBe("AL_NOOR_DECOR_JOINERY");
    expect(vendorCodeBase("***")).toBe("VENDOR");
    expect(vendorCodeBase("A".repeat(100))).toHaveLength(72);
  });

  it("accepts a minimal draft and normalizes optional commercial identity", async () => {
    const value = plainToInstance(CreateVendorDto, {
      id: "d0a15ae5-086c-43dc-a146-1bf5b6c4a966",
      version: 0,
      displayName: "  Local Joiner  ",
      capabilities: [],
      defaultCurrency: " aed ",
      website: "https://vendor.example/path",
    });
    expect(await validate(value)).toEqual([]);
    expect(value.displayName).toBe("Local Joiner");
    expect(value.defaultCurrency).toBe("AED");
  });

  it("rejects duplicate/unknown capabilities and unsafe identity data", async () => {
    const value = plainToInstance(CreateVendorDto, {
      id: "d0a15ae5-086c-43dc-a146-1bf5b6c4a966",
      version: 0,
      code: "bad code",
      displayName: "Vendor",
      capabilities: ["materials", "materials", "banking"],
      defaultCurrency: "dirham",
      website: "javascript:alert(1)",
    });
    expect((await validate(value)).length).toBeGreaterThanOrEqual(4);
  });

  it("allows a named store without forcing contact or address data", async () => {
    const value = plainToInstance(CreateVendorSiteDto, {
      id: "18816112-f3f8-43bd-86db-c9a815305c8d",
      version: 0,
      name: " Deira Store ",
      siteType: "store",
      isPrimary: true,
    });
    expect(await validate(value)).toEqual([]);
    expect(value.name).toBe("Deira Store");
  });

  it("requires lifecycle versions and bounds archive explanations", async () => {
    const valid = plainToInstance(VendorLifecycleDto, { version: 2, action: "archive", reason: "No longer approved" });
    expect(await validate(valid)).toEqual([]);
    const invalid = plainToInstance(VendorLifecycleDto, { version: 0, action: "delete", reason: "x".repeat(501) });
    expect((await validate(invalid)).length).toBe(3);
  });
});
