import { describe, expect, it } from "vitest";
import { deliveryMessage } from "./send-quote-dialog";

const t = ((key: string, values: Record<string, string> = {}) => key.replace(/\{(\w+)\}/g, (_all, name: string) => values[name] ?? "")) as never;
const sent = { portal: true as const, channel: null, emailed: [], decider: "Sofia Bennett", deciderHasEmail: true };

describe("what the sender is told after Send to client (M3)", () => {
  it("names what was queued, never claiming it was delivered", () => {
    expect(deliveryMessage({ ...sent, channel: "email", emailed: ["Sofia Bennett"], reason: null }, t)).toEqual({ tone: "success", message: "Queued · email to Sofia Bennett" });
    expect(deliveryMessage({ ...sent, channel: "whatsapp", emailed: [], reason: null }, t).message).toBe("Queued · WhatsApp to Sofia Bennett");
  });

  it("says both channels when a proposal goes by WhatsApp and email", () => {
    expect(deliveryMessage({ ...sent, channel: "whatsapp", emailed: ["Sofia Bennett"], reason: null }, t).message)
      .toBe("Queued · WhatsApp to Sofia Bennett and email to Sofia Bennett");
  });

  it("only blames missing emails when nobody on the case has one", () => {
    expect(deliveryMessage({ ...sent, reason: "no_contact" }, t).message).toContain("nobody on the case has an email address");
    expect(deliveryMessage({ ...sent, reason: "portal_off" }, t).message).toContain("the client portal is turned off");
    expect(deliveryMessage({ ...sent, reason: "paused" }, t).message).toContain("paused");
    expect(deliveryMessage({ ...sent, reason: "not_sent" }, t).message).toContain("they turned these emails off");
    expect(deliveryMessage({ ...sent, reason: "demo_test_contacts_only" }, t).message).toContain("only emails test contacts");
  });
});
