import { describe, expect, it } from "vitest";
import { firstName, inboundSummary, normalizeTemplateParameter, renderTemplate, snoozeProblem, templateParametersProblem, templatePlaceholders, withSignature } from "./inbox-rules";

describe("inbox rules", () => {
  it("reads a provider template's numbered variables once each, in order", () => {
    expect(templatePlaceholders("Hi {{1}}, your quote {{2}} is ready. {{1}}, reply here.")).toEqual([1, 2]);
    expect(templatePlaceholders("Hello {{ 2 }} and {{1}}")).toEqual([1, 2]);
    expect(templatePlaceholders("No variables")).toEqual([]);
    expect(templatePlaceholders("Named {{clientName}} is a workspace notice, not a provider variable")).toEqual([]);
  });

  it("fills every placeholder and names the one that is missing", () => {
    expect(renderTemplate("Hi {{1}}, quote {{2}}", ["Noura", "V2"])).toBe("Hi Noura, quote V2");
    expect(templateParametersProblem([1, 2], ["Noura", "V2"])).toBeNull();
    expect(templateParametersProblem([1, 2], ["Noura", "  "])).toBe("Fill in {{2}}");
    expect(templateParametersProblem([1, 2], ["Noura"])).toBe("This template needs 2 values");
    expect(templateParametersProblem([1, 3], ["a", "b"])).toMatch(/numbered/);
    expect(templateParametersProblem([1], ["x".repeat(1025)])).toMatch(/longer/);
  });

  it("keeps a parameter on one line, as WhatsApp requires", () => {
    expect(normalizeTemplateParameter(" Villa\n12\tJumeirah      Park ")).toBe("Villa 12 Jumeirah   Park");
  });

  it("uses a real first name and never the placeholder an unknown number gets", () => {
    expect(firstName("Noura Al Hashimi")).toBe("Noura");
    expect(firstName("WhatsApp +971501234567")).toBeNull();
    expect(firstName("+971 50 123 4567")).toBeNull();
    expect(firstName("  ")).toBeNull();
  });

  it("signs a reply only when the firm turned the signature on, and only once", () => {
    expect(withSignature("We will call you at 4.", "Sara Khan", true)).toBe("We will call you at 4.\n— Sara");
    expect(withSignature("We will call you at 4.\n— Sara", "Sara Khan", true)).toBe("We will call you at 4.\n— Sara");
    expect(withSignature("We will call you at 4.", "Sara Khan", false)).toBe("We will call you at 4.");
    expect(withSignature("Hello", null, true)).toBe("Hello");
  });

  it("accepts a snooze between one minute and ninety days ahead", () => {
    const now = new Date("2026-09-28T10:00:00Z");
    expect(snoozeProblem(new Date("2026-09-29T09:00:00Z"), now)).toBeNull();
    expect(snoozeProblem(new Date("2026-09-28T10:00:30Z"), now)).toBe("Choose a time in the future");
    expect(snoozeProblem(new Date("2027-01-01T10:00:00Z"), now)).toMatch(/90 days/);
    expect(snoozeProblem(new Date("nonsense"), now)).toMatch(/Choose when/);
  });

  it("writes one notice per chat: the message, then a count while more arrive", () => {
    expect(inboundSummary(1, "Can you visit on Thursday?")).toBe("Can you visit on Thursday?");
    expect(inboundSummary(1, "Image received", ["image"])).toBe("Sent a photo");
    expect(inboundSummary(10, "Image received", Array(10).fill("image"))).toBe("Sent 10 photos");
    expect(inboundSummary(3, "ok", ["text", "image", "text"])).toBe("3 new messages");
    expect(inboundSummary(1, "x".repeat(200))).toHaveLength(140);
  });
});
