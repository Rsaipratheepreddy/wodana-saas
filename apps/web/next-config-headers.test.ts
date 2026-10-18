import { describe, expect, it } from "vitest";
// The matcher Next.js uses for `headers()` sources.
// @ts-expect-error compiled module without types
import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import nextConfig from "./next.config";

async function headersFor(path: string) {
  const rules = await nextConfig.headers!();
  return rules.filter((rule) => pathToRegexp(rule.source, [], {}).test(path)).flatMap((rule) => rule.headers);
}
const framable = (headers: Array<{ key: string; value: string }>) =>
  !headers.some((header) => header.key === "X-Frame-Options") && headers.some((header) => header.key === "Content-Security-Policy" && header.value.includes("frame-ancestors *"));

describe("framing (booking embeds)", () => {
  it("lets only the public booking page be framed by other sites", async () => {
    expect(framable(await headersFor("/book/palm/design-consultation"))).toBe(true);
  });
  it("keeps the signed manage page, the staff app and everything else unframable", async () => {
    for (const path of ["/book/palm/manage/abc.def", "/workspace/crm/leads", "/login", "/book/palm", "/enquiry/abc/extra", "/apifoo"]) {
      const headers = await headersFor(path);
      expect(framable(headers), path).toBe(false);
      expect(headers.find((header) => header.key === "X-Frame-Options")?.value, path).toBe("DENY");
      expect(headers.some((header) => header.key === "Content-Security-Policy"), path).toBe(true);
    }
  });
  it("lets firms embed a lead form with the copied embed code", async () => {
    expect(framable(await headersFor("/enquiry/form-token-123"))).toBe(true);
  });
  it("lets our own pages show files from /api (the signing page's PDF) but no other site", async () => {
    const headers = await headersFor("/api/esign/token-1/document");
    expect(headers.filter((header) => header.key === "X-Frame-Options").map((header) => header.value)).toEqual(["SAMEORIGIN"]);
    const policies = headers.filter((header) => header.key === "Content-Security-Policy").map((header) => header.value);
    expect(policies).toHaveLength(1);
    expect(policies[0]).toContain("frame-ancestors 'self'");
  });
  it("allows the note video players in frame-src", async () => {
    const policy = (await headersFor("/workspace/crm/leads")).find((header) => header.key === "Content-Security-Policy")?.value ?? "";
    expect(policy).toContain("https://www.youtube-nocookie.com");
    expect(policy).toContain("https://player.vimeo.com");
  });
});
