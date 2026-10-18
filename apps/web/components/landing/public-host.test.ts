import { beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ value: "localhost:3000" as string | null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(host.value ? { host: host.value } : {}), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
}));

const { requirePublicHost } = await import("./public-host");

describe("public pages' hosts", () => {
  beforeEach(() => { host.value = "localhost:3000"; });

  it("serves the public site on Wodana's own hosts", async () => {
    for (const value of ["localhost:3000", "wodana.ai", "www.wodana.ai"]) {
      host.value = value;
      await expect(requirePublicHost()).resolves.toBeUndefined();
    }
  });

  it("sends a firm's own host to its sign-in", async () => {
    host.value = "demo-interiors.wodana.ai";
    await expect(requirePublicHost()).rejects.toThrow("REDIRECT /login");
    host.value = "portal.example-firm.com";
    await expect(requirePublicHost()).rejects.toThrow("REDIRECT /login");
  });

  it("does not serve a malformed host", async () => {
    host.value = "bad host/..";
    await expect(requirePublicHost()).rejects.toThrow("NOT_FOUND");
  });

  const pages = [
    () => import("@/app/about/page"), () => import("@/app/careers/page"), () => import("@/app/team/page"),
    () => import("@/app/privacy/page"), () => import("@/app/terms/page"), () => import("@/app/contact/page"),
  ];

  it("guards every public page", async () => {
    host.value = "demo-interiors.wodana.ai";
    for (const load of pages) {
      const page = (await load()).default as () => Promise<unknown>;
      await expect(page()).rejects.toThrow("REDIRECT /login");
    }
  });

  it("gives each company page its own title and description", async () => {
    const titles: string[] = [];
    for (const load of pages) {
      const metadata = await (await load()).generateMetadata();
      expect(metadata.description).toBeTruthy();
      titles.push(String(metadata.title));
    }
    expect(titles).toEqual(["About · Wodana", "Careers · Wodana", "Team · Wodana", "Privacy policy · Wodana", "Terms of service · Wodana", "Contact · Wodana"]);
  });
});
