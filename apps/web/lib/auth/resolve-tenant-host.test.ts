import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./server", () => ({ businessApiUrl: (path: string) => `http://core.test/api/v1${path}` }));

import { resolveTenantHost } from "./resolve-tenant-host";

afterEach(() => vi.unstubAllGlobals());

describe("tenant host resolver", () => {
  it("does not contact Business Core for the generic site", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveTenantHost("localhost:3102")).toEqual({ kind: "generic" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves exact platform and active custom hosts, never an arbitrary tenant slug", async () => {
    const branding = {
      displayName: "Palm", loginSlug: "plm", logoUrl: null, primaryColor: "#E4E3DE",
      secondaryColor: "#000000", headingFont: "alta", bodyFont: "montserrat",
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => branding });
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveTenantHost("plm.wodana.ai")).toEqual({ kind: "tenant", branding });
    expect(fetchMock.mock.calls[0][0]).toBe("http://core.test/api/v1/auth/tenant/plm");
    expect(await resolveTenantHost("portal.example.com")).toEqual({ kind: "tenant", branding });
    expect(fetchMock.mock.calls[1][0]).toBe("http://core.test/api/v1/auth/tenant-host/portal.example.com");
  });

  it("fails closed for unknown custom and malformed hosts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveTenantHost("unbound.example.com")).toBeNull();
    expect(await resolveTenantHost("user@unbound.example.com")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
