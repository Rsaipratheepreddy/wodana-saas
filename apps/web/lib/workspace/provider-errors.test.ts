import { describe, expect, it } from "vitest";
import type { Translate } from "@/lib/i18n/keys";
import { failureReason } from "./delivery-health";
import { deliveryFailureReason } from "@/lib/crm/delivery-failure";
import { providerErrorCode, providerErrorMessage, providerProblem } from "./provider-errors";

const t = ((key: string) => key) as Translate;

describe("provider errors in Wodana's words", () => {
  it("reads the code from either error shape, and only a safe one", () => {
    expect(providerErrorCode({ error: { code: "reconnect_required", message: "Token has been expired or revoked." } })).toBe("reconnect_required");
    expect(providerErrorCode({ code: "no_calendars_selected" })).toBe("no_calendars_selected");
    expect(providerErrorCode({ error: "invalid_grant" })).toBeUndefined();
    expect(providerErrorCode({ code: "<script>" })).toBeUndefined();
  });

  it("says what to do: reconnect, change a setting, or try later", () => {
    expect(providerProblem("reconnect_required")).toBe("reconnect");
    expect(providerProblem("calendar_read_consent_required")).toBe("reconnect");
    expect(providerProblem("no_calendars_selected")).toBe("setup");
    expect(providerProblem("event_list_failed")).toBe("unavailable");
    expect(providerProblem(undefined)).toBe("unavailable");
  });

  it("never tells a failed Google call in Google's words", () => {
    expect(providerErrorMessage(t, "reconnect_required", "Token has been expired or revoked.")).toBe("This account isn't connected anymore. Reconnect it in Connections.");
    expect(providerErrorMessage(t, "oauth_refresh_failed", "Token has been expired or revoked.")).toBe("The provider couldn't complete this. Try again in a moment.");
    expect(providerErrorMessage(t, "event_create_failed", "Invalid attendee")).not.toContain("Invalid attendee");
    // Wodana's own (already masked) sentence for another provider stays.
    expect(providerErrorMessage(t, "provider_request_failed", "Provider rejected the request.")).toBe("Provider rejected the request.");
  });

  it("tells why a client message wasn't delivered without WhatsApp's codes", () => {
    expect(deliveryFailureReason(t, "131047")).toBe("More than 24 hours since the client's last message. Send an approved template.");
    expect(deliveryFailureReason(t, "132001")).toBe("The message template isn't approved or doesn't match.");
    expect(deliveryFailureReason(t, "999999")).toBe("WhatsApp didn't deliver it. Try again later.");
    expect(deliveryFailureReason(t, "reconnect_required")).toBe("This account isn't connected anymore. Reconnect it in Connections.");
    expect(deliveryFailureReason(t, "something_new")).toBe("The provider didn't deliver it. Try again later.");
  });

  it("explains a Gmail send that failed because Google's access ended", () => {
    expect(failureReason(t, { code: "reconnect_required", message: "Token has been expired or revoked.", at: "2026-10-14T08:00:00Z" } as never))
      .toBe("This account isn't connected anymore. Reconnect it in Connections.");
    expect(failureReason(t, { code: "oauth_refresh_failed", message: "Token has been expired or revoked.", at: "2026-10-14T08:00:00Z" } as never))
      .not.toContain("revoked");
  });
});
