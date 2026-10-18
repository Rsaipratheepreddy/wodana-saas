import { describe, expect, it } from "vitest";
import { clientContactFacts } from "./client-contact";

const enquiry = { mobile: "+971 55 318 4420", email: "rania@example.test", mobileCountryCode: "AE", phone: "+971 4 000 0000", phoneCountryCode: "AE" };

describe("the client contact shown on a deal", () => {
  it("prefers the client record's primary active contact points", () => {
    const contacts = [
      { type: "phone", value: "+971500000001", countryCode: "AE", isPrimary: false, status: "active" },
      { type: "phone", rawValue: "+971 50 000 0002", value: "+971500000002", countryCode: "AE", isPrimary: true, status: "active" },
      { type: "email", value: "old@example.test", status: "archived" },
      { type: "email", value: "client@example.test", status: "active" },
    ];
    expect(clientContactFacts(contacts, enquiry)).toEqual({ phone: "+971 50 000 0002", countryCode: "AE", email: "client@example.test" });
  });

  it("falls back to what was typed on the enquiry when the client record holds no contact points (B09)", () => {
    expect(clientContactFacts([], enquiry)).toEqual({ phone: "+971 55 318 4420", countryCode: "AE", email: "rania@example.test" });
    expect(clientContactFacts(undefined, enquiry)).toEqual({ phone: "+971 55 318 4420", countryCode: "AE", email: "rania@example.test" });
  });

  it("mixes the two sources field by field and uses the landline when the enquiry has no mobile", () => {
    const phoneOnly = [{ type: "phone", value: "+971500000003", countryCode: "AE", status: "active" }];
    expect(clientContactFacts(phoneOnly, enquiry)).toEqual({ phone: "+971500000003", countryCode: "AE", email: "rania@example.test" });
    expect(clientContactFacts([], { phone: " +44 20 7946 0000 ", phoneCountryCode: "GB", email: null })).toEqual({ phone: "+44 20 7946 0000", countryCode: "GB", email: "" });
  });

  it("reports nothing when neither source has a phone or an email", () => {
    expect(clientContactFacts([{ type: "phone", value: "+971500000004", status: "archived" }], null)).toEqual({ phone: "", countryCode: undefined, email: "" });
  });
});
