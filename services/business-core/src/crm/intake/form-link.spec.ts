import { describe, expect, it } from "vitest";
import { resolveFormLink } from "./form-link";

const choices = {
  sources: [{ id: "palm_living_enquiry" }, { id: "self_generated", allowedRoles: ["SALES"] }, { id: "returning_customer" }, { id: "referral" }],
  channels: { palm_living_enquiry: [{ id: "whatsapp" }, { id: "qr_code" }], self_generated: [{ id: "networking" }], returning_customer: [{ id: "old_leads" }], referral: [{ id: "external" }] },
};

describe("form link presets (PLM-036 / PLM-028)", () => {
  it("presets a valid source, channel and placement", () => {
    expect(resolveFormLink(choices, { source: "palm_living_enquiry", channel: "qr_code", placement: "showroom-door" }))
      .toEqual({ source: "palm_living_enquiry", channel: "qr_code", placement: "showroom-door" });
  });

  it("never lets a public link pick a restricted or system source", () => {
    expect(resolveFormLink(choices, { source: "self_generated", channel: "networking" })).toBeNull();
    expect(resolveFormLink(choices, { source: "returning_customer", channel: "old_leads" })).toBeNull();
    expect(resolveFormLink(choices, { source: "referral", channel: "external" })).toBeNull();
  });

  it("ignores a channel from another source and unsafe placement text", () => {
    expect(resolveFormLink(choices, { source: "palm_living_enquiry", channel: "old_leads", placement: "Door<script>" })).toBeNull();
    expect(resolveFormLink(choices, { source: "x", channel: "y", placement: "magazine-ad" })).toEqual({ placement: "magazine-ad" });
  });
});
