import { describe, expect, it } from "vitest";
import { BODY_LIMIT, fillPush, normalisePushTemplates, PUSH_EVENTS, pushVersion, renderPush, TITLE_LIMIT } from "./push-templates";

describe("push like a delivery app: the firm's wording (§0.3)", () => {
  it("fills the moment's facts, leaves an unknown one out and keeps to the lock screen's limits", () => {
    expect(renderPush({ title: "{job}", body: "Now: {step} · {chapter} ({done} of {total})", action: "open" },
      { job: "Villa 12 · J-000038", step: "Mood boards", chapter: "Design", done: "14", total: "41" }))
      .toEqual({ title: "Villa 12 · J-000038", body: "Now: Mood boards · Design (14 of 41)", category: "open" });
    expect(fillPush("{author} mentioned you {nope}", { author: "Sam" }, TITLE_LIMIT)).toBe("Sam mentioned you");
    const long = fillPush("{text}", { text: "x".repeat(400) }, BODY_LIMIT);
    expect(long).toHaveLength(BODY_LIMIT);
    expect(long.endsWith("…")).toBe(true);
  });

  it("offers each moment's own facts and buttons, and refuses others", () => {
    const step = PUSH_EVENTS.find((event) => event.key === "job_step")!;
    expect(normalisePushTemplates([{ key: "job_step", title: "{job} moved on", body: "{step} ({done}/{total})", action: "review", enabled: false }]))
      .toEqual([{ key: "job_step", title: "{job} moved on", body: "{step} ({done}/{total})", action: "review", enabled: false }]);
    expect(() => normalisePushTemplates([{ key: "job_step", title: "Hi {client}", body: "x", action: "open" }])).toThrow(`can use ${step.variables.map((name) => `{${name}}`).join(", ")}, not {client}`);
    expect(() => normalisePushTemplates([{ key: "job_step", title: "x", body: "y", action: "pay" }])).toThrow("Choose a button");
    expect(() => normalisePushTemplates([{ key: "job_step", title: "", body: "y", action: "open" }])).toThrow("title");
    expect(() => normalisePushTemplates([{ key: "job_step", title: "x", body: "y".repeat(BODY_LIMIT + 1), action: "open" }])).toThrow("characters");
    expect(() => normalisePushTemplates([{ key: "unknown", title: "x", body: "y", action: "open" }])).toThrow("isn't one the project sends");
    expect(() => normalisePushTemplates([{ key: "mention", title: "x", body: "y", action: "reply" }, { key: "mention", title: "x", body: "y", action: "reply" }])).toThrow("isn't one");
  });

  it("starts from the kit's wording for every moment, each with a sample that fits its own text", () => {
    for (const event of PUSH_EVENTS) {
      expect(event.actions).toContain(event.action);
      expect(normalisePushTemplates([{ key: event.key, title: event.title, body: event.body, action: event.action }])).toHaveLength(1);
      const shown = renderPush(event, event.sample);
      expect(shown.title).not.toMatch(/\{/);
      expect(shown.body).not.toMatch(/\{/);
    }
    expect(pushVersion(PUSH_EVENTS.map(({ key, title, body, action, enabled }) => ({ key, title, body, action, enabled })))).toHaveLength(16);
  });
});
