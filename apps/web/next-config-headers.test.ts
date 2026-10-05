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
    for (const path of ["/book/palm/manage/abc.def", "/workspace/crm/leads", "/login", "/book/palm"]) {
      const headers = await headersFor(path);
      expect(framable(headers), path).toBe(false);
      expect(headers.some((header) => header.key === "Content-Security-Policy"), path).toBe(true);
    }
  });
});
