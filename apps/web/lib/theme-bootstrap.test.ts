import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "@/next.config";
import { themeBootstrapScript } from "./theme-bootstrap";

function runAt(path: string, { stored, prefersDark }: { stored?: string; prefersDark?: boolean }) {
  window.history.replaceState(null, "", path);
  if (stored) window.localStorage.setItem("wodana-theme", stored); else window.localStorage.removeItem("wodana-theme");
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: Boolean(prefersDark) && query.includes("dark"), media: query }));
  document.documentElement.setAttribute("data-theme", "light");
  new Function(themeBootstrapScript)();
  return document.documentElement.getAttribute("data-theme");
}

describe("theme bootstrap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    document.documentElement.setAttribute("data-theme", "light");
    window.history.replaceState(null, "", "/");
  });

  it("puts the stored theme on the page before it paints", () => {
    expect(runAt("/workspace", { stored: "dark" })).toBe("dark");
    expect(runAt("/workspace", { stored: "light", prefersDark: true })).toBe("light");
  });

  it("uses the device's theme when none is stored", () => {
    expect(runAt("/login", { prefersDark: true })).toBe("dark");
    expect(runAt("/login", {})).toBe("light");
    expect(runAt("/workspace", { stored: "sepia", prefersDark: true })).toBe("dark");
  });

  it("keeps client and supplier pages light", () => {
    expect(runAt("/portal/palm", { stored: "dark" })).toBe("light");
    expect(runAt("/enquiry/abc", { prefersDark: true })).toBe("light");
    expect(runAt("/quotation/case-1", { stored: "dark" })).toBe("light");
    expect(runAt("/vendor/order", { stored: "dark" })).toBe("light");
    expect(runAt("/portals", { stored: "dark" })).toBe("dark");
  });

  it("never throws when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(runAt("/workspace", { prefersDark: true })).toBe("dark");
  });

  it("is allowed by the site's script policy", async () => {
    const rules = await nextConfig.headers!();
    const policy = rules.flatMap((rule) => rule.headers).find((header) => header.key === "Content-Security-Policy")!.value;
    const scriptSources = policy.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src"))!;
    // A nonce or hash policy would need the bootstrap's nonce or hash here instead.
    expect(scriptSources).toContain("'unsafe-inline'");
  });
});
