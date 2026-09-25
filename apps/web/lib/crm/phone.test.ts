import { describe, expect, it } from "vitest";
import { formatPhoneForDisplay, phoneCountry, whatsappUrl } from "./phone";

describe("CRM WhatsApp contact links", () => {
  it("uses a contact country ahead of the workspace locale", () => {
    expect(phoneCountry("gb", "en-AE")).toBe("GB");
    expect(whatsappUrl("07911 123456", phoneCountry("GB", "en-AE"))).toBe("https://wa.me/447911123456");
  });

  it("normalizes a legacy local UAE mobile from the workspace locale", () => {
    expect(whatsappUrl("050 123 4567", phoneCountry(undefined, "en-AE"))).toBe("https://wa.me/971501234567");
    expect(whatsappUrl("+971 50 123 4567")).toBe("https://wa.me/971501234567");
  });

  it("does not create a broken chat for ambiguous or invalid numbers", () => {
    expect(whatsappUrl("050 123 4567")).toBeNull();
    expect(whatsappUrl("050123", phoneCountry(undefined, "en-AE"))).toBeNull();
    expect(whatsappUrl("Support: +971 50 123 4567", phoneCountry(undefined, "en-AE"))).toBeNull();
    expect(phoneCountry(undefined, "not a locale")).toBeUndefined();
  });

  it("formats a valid phone for display without inventing digits for invalid input", () => {
    expect(formatPhoneForDisplay("+971528638482")).toBe("+971 52 863 8482");
    expect(formatPhoneForDisplay("050 123 4567", "AE")).toBe("+971 50 123 4567");
    expect(formatPhoneForDisplay("050123", "AE")).toBe("050123");
    expect(formatPhoneForDisplay(" ")).toBe("Not provided");
  });
});
