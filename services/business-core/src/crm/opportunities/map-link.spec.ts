import { describe, expect, it, vi } from "vitest";
import { isShortMapLink, resolveMapLink } from "./map-link";

const redirecting = (hops: Record<string, string | null>) => vi.fn(async (url: string) => {
  const location = hops[url];
  return { status: location ? 302 : 200, headers: { get: (name: string) => (name === "location" ? location ?? null : null) } } as unknown as Response;
}) as unknown as typeof fetch;

describe("short map links", () => {
  it("knows the Google short-link hosts and nothing else", () => {
    expect(isShortMapLink("https://maps.app.goo.gl/AbCdEf12345")).toBe(true);
    expect(isShortMapLink(" https://goo.gl/maps/xyz ")).toBe(true);
    expect(isShortMapLink("https://www.google.com/maps/@25.2,55.27,15z")).toBe(false);
    expect(isShortMapLink("ftp://maps.app.goo.gl/x")).toBe(false);
    expect(isShortMapLink("not a link")).toBe(false);
  });

  it("follows the redirect to the long link without reading a page, through Google's consent page", async () => {
    const fetchImpl = redirecting({
      "https://maps.app.goo.gl/AbCdEf12345": "https://consent.google.com/m?continue=https%3A%2F%2Fwww.google.com%2Fmaps%2Fplace%2FVilla%2F%4025.11%2C55.13%2C17z",
    });
    expect(await resolveMapLink("https://maps.app.goo.gl/AbCdEf12345", fetchImpl)).toBe("https://www.google.com/maps/place/Villa/@25.11,55.13,17z");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "manual" });
  });

  it("resolves nothing for a long link, a short link that doesn't redirect, or a redirect off the web", async () => {
    expect(await resolveMapLink("https://www.google.com/maps/@25.2,55.27,15z", redirecting({}))).toBeNull();
    expect(await resolveMapLink("https://maps.app.goo.gl/none", redirecting({}))).toBeNull();
    expect(await resolveMapLink("https://maps.app.goo.gl/app", redirecting({ "https://maps.app.goo.gl/app": "comgooglemaps://?q=25,55" }))).toBeNull();
  });
});
