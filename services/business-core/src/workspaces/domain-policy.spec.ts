import { describe, expect, it } from "vitest";
import { domainDnsChallenge, normalizeCustomDomain, txtAnswerMatches } from "./domain-policy";

describe("custom-domain safety policy", () => {
  it("normalizes a controlled hostname and creates a unique TXT proof location", () => {
    expect(normalizeCustomDomain("  Portal.Example.COM. ")).toBe("portal.example.com");
    expect(domainDnsChallenge("portal.example.com", "opaque-value")).toEqual({
      type: "TXT", name: "_wodana-verify.portal.example.com", value: "wodana-verify=opaque-value",
    });
    expect(txtAnswerMatches([["wodana-", "verify=opaque-value"]], "wodana-verify=opaque-value")).toBe(true);
    expect(txtAnswerMatches([["wodana-verify=old"]], "wodana-verify=opaque-value")).toBe(false);
  });

  it.each(["wodana.ai", "plm.wodana.ai", "api.wodana.ai", "127.0.0.1", "[::1]", "localhost",
    "portal.localhost", "https://portal.example.com", "portal.example.com/path", "portal..example.com",
    "-portal.example.com", "portal-.example.com", "portal_example.com", "example", ""])(
    "rejects unsafe or platform-owned hostname %s", (hostname) => {
      expect(() => normalizeCustomDomain(hostname)).toThrow();
    },
  );
});
