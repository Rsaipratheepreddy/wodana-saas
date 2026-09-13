import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllGlobals());

describe("GET /api/geo/locations", () => {
  it("rejects invalid country codes before calling the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new Request("http://localhost/api/geo/locations?countryCode=UAE"));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns normalized administrative areas for the selected country", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        error: false,
        data: { states: [{ name: "Dubai", state_code: "DU" }, { name: "Abu Dhabi Emirate", state_code: "AZ" }] },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new Request("http://localhost/api/geo/locations?countryCode=AE"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [
      { id: "Abu Dhabi Emirate", label: "Abu Dhabi Emirate" },
      { id: "Dubai", label: "Dubai" },
    ] });
    const upstream = fetchMock.mock.calls[0]?.[0] as URL;
    expect(upstream.searchParams.get("country")).toBe("United Arab Emirates");
  });

  it("returns only cities for the selected region", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ error: false, data: ["Dubai"] }) });
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new Request("http://localhost/api/geo/locations?countryCode=AE&region=Dubai"));

    expect(await response.json()).toEqual({ items: [{ id: "Dubai", label: "Dubai" }] });
    const upstream = fetchMock.mock.calls[0]?.[0] as URL;
    expect(upstream.pathname).toContain("/state/cities/q");
    expect(upstream.searchParams.get("state")).toBe("Dubai");
  });
});
