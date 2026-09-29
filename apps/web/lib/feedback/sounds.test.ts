import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureFeedback, playFeedback, resetFeedbackForTests } from "./sounds";

class FakeParam { setValueAtTime() {} exponentialRampToValueAtTime() {} }
class FakeNode { gain = new FakeParam(); frequency = new FakeParam(); type = ""; connect(next: unknown) { return next; } start() {} stop() {} }
const started = vi.fn();
class FakeAudioContext {
  currentTime = 0; state = "running"; destination = {};
  createOscillator() { started(); return new FakeNode(); }
  createGain() { return new FakeNode(); }
  resume() { return Promise.resolve(); }
}

function reducedMotion(on: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: on && query.includes("reduce"), media: query }));
}

describe("feedback sounds", () => {
  beforeEach(() => {
    resetFeedbackForTests();
    started.mockClear();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    reducedMotion(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("never plays before the person has interacted with the page", () => {
    expect(playFeedback("notice")).toBe(false);
    expect(started).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pointerdown"));
    expect(playFeedback("notice")).toBe(true);
    expect(started).toHaveBeenCalled();
  });

  it("stays quiet while viewing as someone, when turned off, or with reduced motion", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    configureFeedback({ viewingAs: true });
    expect(playFeedback("approve")).toBe(false);
    configureFeedback({ viewingAs: false, enabled: false });
    expect(playFeedback("approve")).toBe(false);
    configureFeedback({ enabled: true });
    reducedMotion(true);
    expect(playFeedback("approve")).toBe(false);
    reducedMotion(false);
    expect(playFeedback("approve")).toBe(true);
  });

  it("plays one sound for a burst of the same moment", () => {
    window.dispatchEvent(new Event("pointerdown"));
    expect(playFeedback("reply")).toBe(true);
    expect(playFeedback("reply")).toBe(false);
    expect(playFeedback("send")).toBe(true);
  });
});
