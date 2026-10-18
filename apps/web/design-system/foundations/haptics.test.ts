import { afterEach, describe, expect, it, vi } from "vitest";
import { emitHapticFeedback } from "./haptics";

afterEach(() => vi.unstubAllGlobals());

describe("optional haptic feedback", () => {
  it("returns false when the browser has no vibration support", () => {
    vi.stubGlobal("navigator", {});
    expect(emitHapticFeedback()).toBe(false);
  });

  it("respects reduced motion and only vibrates when supported", () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate });
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    expect(emitHapticFeedback("selection")).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(emitHapticFeedback("success")).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(12);
  });
});
