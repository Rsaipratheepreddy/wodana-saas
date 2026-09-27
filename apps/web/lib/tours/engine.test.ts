import { describe, expect, it, vi } from "vitest";
import { TourRunner, type TourHost } from "./engine";
import { readingTime, tourMinutes } from "./timing";
import { tourById, tourForPath, tours } from "./tours";
import type { Tour } from "./types";
import { installWriteGuard, isAllowedDuringTour } from "./write-guard";
import en from "../i18n/en.json";

type Fake = TourHost & { said: string[]; navigated: string[]; pressed: string[]; dismissed: HTMLElement[]; silenced: number };

/** A page made of plain elements; every wait resolves at once, so a whole tour runs in a tick. */
function fakeHost(targets: Record<string, HTMLElement>, overlays: HTMLElement[] = []): Fake {
  let path = "/workspace";
  const host: Fake = {
    said: [], navigated: [], pressed: [], dismissed: [], silenced: 0,
    path: () => path,
    navigate: (href) => { host.navigated.push(href); path = href.split("?")[0]; },
    find: (target) => targets[target] ?? null,
    reveal: () => undefined,
    press: (element) => { host.pressed.push(element.dataset.tour ?? ""); },
    fill: (field, value) => { field.value = value; },
    overlays: () => overlays.filter((overlay) => !host.dismissed.includes(overlay)),
    dismiss: (overlay) => { host.dismissed.push(overlay); },
    line: (tour, step, values) => {
      const fallbacks: Record<string, string> = Object.fromEntries((tour.examples ?? []).map((example) => [example.key, example.fallback]));
      return step.narration.replace(/\{(\w+)\}/g, (token, key: string) => values[key] ?? fallbacks[key] ?? token);
    },
    narrate: async (_tour, _step, text) => { host.said.push(text); },
    silence: () => { host.silenced += 1; },
    sleep: async () => undefined,
    random: () => 0.5,
  };
  return host;
}

function element(tour: string, attributes: Record<string, string> = {}, tag = "button") {
  const node = document.createElement(tag);
  node.dataset.tour = tour;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  document.body.append(node);
  return node;
}

const tour: Tour = {
  id: "test",
  title: "Home at a glance",
  screens: ["/workspace"],
  examples: [{ key: "client", source: "client", fallback: "our client" }],
  steps: [
    { id: "one", route: "/workspace/crm/leads", target: "list", action: "point", woddy: "hello", narration: "One {client}." as never },
    { id: "two", target: "tab", action: "click", woddy: "working", narration: "Two." as never },
    { id: "three", target: "field", action: "type", value: "Oak", woddy: "working", narration: "Three." as never },
    { id: "four", action: "wait", woddy: "celebrating", narration: "Four." as never },
  ],
};

async function settle(runner: TourRunner) {
  for (let turn = 0; turn < 200 && runner.getSnapshot().status === "running"; turn += 1) await Promise.resolve();
}

describe("tour engine", () => {
  it("plays the steps in order, navigating, pressing safe controls and filling examples from the screen", async () => {
    const field = element("field", {}, "input") as HTMLInputElement;
    const host = fakeHost({ list: element("list"), client: element("client", { title: "Rashid" }), tab: element("tab", { "data-tour-safe": "" }), field });
    const runner = new TourRunner(host);
    runner.start(tour);
    await settle(runner);
    expect(host.navigated).toEqual(["/workspace/crm/leads"]);
    expect(host.said).toEqual(["One Rashid.", "Two.", "Three.", "Four."]);
    expect(host.pressed).toEqual(["tab"]);
    expect(runner.getSnapshot()).toMatchObject({ status: "finished", mood: "celebrating" });
    // Typed text is only for show: it is cleared once the step is over.
    expect(field.value).toBe("");
  });

  it("skips a step whose target never appears, with a note, and carries on", async () => {
    const host = fakeHost({ list: element("list"), field: element("field", {}, "input") });
    const runner = new TourRunner(host);
    const seen: boolean[] = [];
    runner.subscribe(() => { seen.push(runner.getSnapshot().missing); });
    runner.start(tour);
    await settle(runner);
    expect(seen).toContain(true);
    expect(host.said).toEqual(["One our client.", "Three.", "Four."]);
    expect(host.pressed).toEqual([]);
    expect(runner.getSnapshot().status).toBe("finished");
  });

  it("never presses a control that is not marked safe", async () => {
    const host = fakeHost({ list: element("list"), tab: element("tab"), field: element("field", {}, "input") });
    const runner = new TourRunner(host);
    runner.start(tour);
    await settle(runner);
    expect(host.pressed).toEqual([]);
    expect(host.said).toHaveLength(4);
  });

  it("exits cleanly: stops speaking, clears typed text and closes the dialogs it opened", async () => {
    const field = element("field", {}, "input") as HTMLInputElement;
    const before = document.createElement("div");
    const opened = document.createElement("div");
    document.body.append(before, opened);
    const overlays = [before];
    const host = fakeHost({ list: element("list"), tab: element("tab", { "data-tour-safe": "" }), field }, overlays);
    host.press = () => { overlays.push(opened); };
    let release = () => undefined as void;
    host.narrate = async (_tour, step, text) => { host.said.push(text); if (step.id === "three") await new Promise<void>((resolve) => { release = resolve; }); };
    const runner = new TourRunner(host);
    runner.start(tour);
    for (let turn = 0; turn < 200 && host.said.length < 3; turn += 1) await Promise.resolve();
    expect(field.value).toBe("Oak");
    runner.exit();
    release();
    expect(runner.getSnapshot().status).toBe("idle");
    expect(field.value).toBe("");
    expect(host.dismissed).toEqual([opened]);
    expect(host.silenced).toBeGreaterThan(0);
  });

  it("pauses, resumes and steps back and forward", async () => {
    const host = fakeHost({ list: element("list"), tab: element("tab", { "data-tour-safe": "" }), field: element("field", {}, "input") });
    let release = () => undefined as void;
    host.narrate = async (_tour, _step, text) => { host.said.push(text); await new Promise<void>((resolve) => { release = resolve; }); };
    const runner = new TourRunner(host);
    runner.start(tour);
    for (let turn = 0; turn < 50 && !host.said.length; turn += 1) await Promise.resolve();
    runner.pause();
    expect(runner.getSnapshot().status).toBe("paused");
    runner.next();
    expect(runner.getSnapshot()).toMatchObject({ status: "running", index: 1 });
    runner.back();
    expect(runner.getSnapshot().index).toBe(0);
    runner.exit();
    release();
  });
});

describe("demo write guard", () => {
  it("lets reads through and refuses every write while a tour runs", async () => {
    const calls: string[] = [];
    const target = { fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { calls.push(`${init?.method ?? "GET"} ${String(input)}`); return new Response("{}"); }) as typeof fetch, location: { origin: "http://localhost" } as Location };
    const blocked = vi.fn();
    const remove = installWriteGuard(blocked, target);
    await target.fetch("/api/workspace/crm/leads");
    await expect(target.fetch("/api/workspace/crm/leads", { method: "POST", body: "{}" })).rejects.toMatchObject({ name: "AbortError" });
    await expect(target.fetch(new Request("http://localhost/api/x", { method: "DELETE" }))).rejects.toThrow("Demo mode");
    expect(calls).toEqual(["GET /api/workspace/crm/leads"]);
    expect(blocked).toHaveBeenCalledTimes(2);
    remove();
    await target.fetch("/api/workspace/crm/leads", { method: "POST" });
    expect(calls).toHaveLength(2);
  });

  it("keeps the session alive", () => {
    expect(isAllowedDuringTour("POST", "/api/auth/refresh")).toBe(true);
    expect(isAllowedDuringTour("PATCH", "/api/workspace/profile")).toBe(false);
    expect(isAllowedDuringTour("HEAD", "/tours/audio/en/home/intro.mp3")).toBe(true);
  });
});

describe("tour scripts", () => {
  it("every line, title and example is an English message key", () => {
    for (const item of tours) {
      expect(en).toHaveProperty([item.title]);
      for (const example of item.examples ?? []) expect(en).toHaveProperty([example.fallback]);
      for (const step of item.steps) {
        expect(en).toHaveProperty([step.narration]);
        if (step.voice) expect(en).toHaveProperty([step.voice]);
      }
    }
  });

  it("each tour opens with an intro, ends with a recap and names only safe actions", () => {
    for (const item of tours) {
      expect(item.steps[0].route, item.id).toBeTruthy();
      expect(item.steps.at(-1)?.id).toBe("recap");
      expect(new Set(item.steps.map((step) => step.id)).size).toBe(item.steps.length);
      for (const step of item.steps) {
        // A recorded line is spoken to everyone: it must not depend on names read from the screen.
        if (/\{\w+\}/.test(step.narration)) expect(step.voice, `${item.id}/${step.id}`).toMatch(/^[^{}]+$/);
        if (step.action === "type") expect(step.value).toBeTruthy();
      }
      if (item.next) expect(tourById(item.next)).toBeDefined();
    }
  });

  it("finds the tour for the screen and estimates a human pace", () => {
    expect(tourForPath("/workspace")?.id).toBe("home");
    expect(tourForPath("/workspace/crm/leads")?.id).toBe("enquiry-to-opportunity");
    expect(tourForPath("/workspace/projects/123/updates")?.id).toBe("client-portal");
    expect(tourForPath("/workspace/projects/123/plan")?.id).toBe("project");
    expect(tourForPath("/workspace/settings/profile")).toBeUndefined();
    expect(readingTime("Hi.")).toBe(2500);
    expect(readingTime(Array(180).fill("word").join(" "))).toBe(60_000);
    for (const item of tours) expect(tourMinutes(item)).toBeGreaterThanOrEqual(1);
  });
});
