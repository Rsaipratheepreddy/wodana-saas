import { describe, expect, it } from "vitest";
import { IDENTITY_VARIANT_COUNT, identityInitials, identityStyle, identityVariant } from "./identity";

describe("brand identities", () => {
  it("uses company initials in the organization mark", () => {
    expect(identityInitials("Iglo Architects")).toBe("IA");
    expect(identityInitials("Iglo Administrator")).toBe("IA");
    expect(identityInitials(" Wodana ")).toBe("W");
  });
  it("keeps names stable across casing, whitespace, unicode and repeated renders", () => {
    expect(identityVariant("  IGLO   Administrator ")).toBe(identityVariant("Iglo Administrator"));
    expect(identityVariant("Amélie")).toBe(identityVariant("Ame\u0301lie"));
    for (const name of ["", "Noura Haddad", "عائشة أحمد", "李 明", "👩🏽‍💻", "a".repeat(1000)]) {
      const variant = identityVariant(name);
      expect(variant).toBeGreaterThanOrEqual(0);
      expect(variant).toBeLessThan(IDENTITY_VARIANT_COUNT);
      expect(identityStyle(name).backgroundImage).toBe("none");
      expect(identityStyle(name).backgroundColor).toBe(`var(--wd-identity-color-${variant})`);
    }
  });

  it("offers all six variations without random colors", () => {
    const variants = new Set(Array.from({ length: 100 }, (_, index) => identityVariant(`Person ${index}`)));
    expect(variants.size).toBe(6);
  });

  it("preserves uploaded photos and company logos without a gradient overlay", () => {
    const style = identityStyle("Iglo", "/logo.png?version=2");
    expect(style.backgroundImage).toBe('url("/logo.png?version=2")');
    expect(style.color).toBeUndefined();
    expect(style.backgroundSize).toBe("cover");
    expect(style.backgroundRepeat).toBe("no-repeat");
  });

  it("supports contained company marks on the tenant brand surface", () => {
    const style = identityStyle("Palm Living", "/palm.png", { fit: "contain", surface: "brand" });
    expect(style.backgroundSize).toBe("contain");
    expect(style.backgroundColor).toContain("--wd-workspace-brand-light-100");
  });

  it("handles single names, whitespace, empty names and non-Latin initials", () => {
    expect(identityInitials("  Noura   Haddad  ")).toBe("NH");
    expect(identityInitials("Woddy")).toBe("W");
    expect(identityInitials("   ")).toBe("?");
    expect(identityInitials("李 明")).toBe("李明");
  });
});
