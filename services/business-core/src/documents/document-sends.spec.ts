import { describe, expect, it } from "vitest";
import { deviceLabel, sendState } from "./document-sends";

describe("document sends (§0.3 P4)", () => {
  const row = (patch: Partial<Parameters<typeof sendState>[0]> = {}) => ({ status: "sent", messageStatus: null, notificationStatus: null, openedAt: null, signedAt: null, ...patch });

  it("reads where a send got to: signed beats opened beats delivered beats sent", () => {
    expect(sendState(row())).toBe("sent");
    expect(sendState(row({ notificationStatus: "delivered" }))).toBe("delivered");
    expect(sendState(row({ messageStatus: "read" }))).toBe("opened");
    expect(sendState(row({ openedAt: "2026-10-17T10:00:00Z", messageStatus: "delivered" }))).toBe("opened");
    expect(sendState(row({ signedAt: "2026-10-17T11:00:00Z", status: "failed" }))).toBe("signed");
  });

  it("says failed when it never left or its channel failed later", () => {
    expect(sendState(row({ status: "failed" }))).toBe("failed");
    expect(sendState(row({ messageStatus: "failed" }))).toBe("failed");
    expect(sendState(row({ notificationStatus: "failed" }))).toBe("failed");
  });

  it("names the signer's device in a few words", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1")).toBe("Chrome on iPhone");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")).toBe("Safari on macOS");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0")).toBe("Edge on Windows");
    expect(deviceLabel(null)).toBeNull();
  });
});
