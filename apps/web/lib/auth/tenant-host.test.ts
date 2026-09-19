import { describe, expect, it } from "vitest";
import { classifyTenantHost, hostnameFromHeader, tenantSlugFromHost } from "./tenant-host";

describe("tenantSlugFromHost", () => {
  it("routes tenant subdomains to their own sign-in brand", () => {
    expect(tenantSlugFromHost("plm.wodana.ai")).toBe("plm");
    expect(tenantSlugFromHost("Iglo.Wodana.Ai:443")).toBe("iglo");
  });

  it("ignores system and unrelated hosts", () => {
    expect(tenantSlugFromHost("www.wodana.ai")).toBeNull();
    expect(tenantSlugFromHost("api.wodana.ai")).toBeNull();
    expect(tenantSlugFromHost("plm.example.com")).toBeNull();
    expect(tenantSlugFromHost("nested.plm.wodana.ai")).toBeNull();
  });

  it("separates generic, tenant and unresolved custom hosts", () => {
    expect(classifyTenantHost("localhost:3102")).toEqual({ kind: "generic" });
    expect(classifyTenantHost("plm.wodana.ai:443")).toEqual({ kind: "tenant", slug: "plm" });
    expect(classifyTenantHost("portal.example.com")).toEqual({ kind: "custom", hostname: "portal.example.com" });
    expect(classifyTenantHost("nested.plm.wodana.ai")).toEqual({ kind: "custom", hostname: "nested.plm.wodana.ai" });
    expect(classifyTenantHost("portal.example.com/redirect")).toEqual({ kind: "invalid" });
    expect(hostnameFromHeader("user@portal.example.com")).toBeNull();
  });
});
