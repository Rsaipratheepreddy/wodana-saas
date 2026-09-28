import { describe, expect, it, vi } from "vitest";
import { TourRunner, actorAt, fillRoute, type TourHost } from "./engine";
import { TOUR_PERSONAS } from "./personas";
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
  for (let turn = 0; turn < 5000 && ["preparing", "running"].includes(runner.getSnapshot().status); turn += 1) await Promise.resolve();
}

/** Every snapshot the runner publishes, for checking the order of phases and statuses. */
function record(runner: TourRunner) {
  const seen: Array<ReturnType<TourRunner["getSnapshot"]>> = [];
  runner.subscribe(() => { seen.push(runner.getSnapshot()); });
  return seen;
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

  it("prepares behind the loader: opens the first screen and shows the tour only once its first target is there", async () => {
    const list = element("list");
    const targets: Record<string, HTMLElement> = {};
    const host = fakeHost(targets);
    let polls = 0;
    host.find = (target) => { if (target === "list" && ++polls > 3) targets.list = list; return targets[target] ?? null; };
    const runner = new TourRunner(host);
    const seen = record(runner);
    runner.start({ ...tour, steps: tour.steps.slice(0, 1) });
    expect(runner.getSnapshot().status).toBe("preparing");
    await settle(runner);
    expect(host.navigated).toEqual(["/workspace/crm/leads"]);
    const firstRunning = seen.findIndex((state) => state.status === "running");
    expect(seen.slice(0, firstRunning).every((state) => state.status === "preparing")).toBe(true);
    expect(seen[firstRunning]).toMatchObject({ progress: 1 });
    // Nothing is pointed at or said until the tour shows.
    expect(seen.slice(0, firstRunning).some((state) => state.pointer || state.phase === "speaking")).toBe(false);
    expect(polls).toBeGreaterThan(3);
  });

  it("shows a short persona switch when another person takes over, and keeps the actor until the next one", async () => {
    const host = fakeHost({ list: element("list"), tab: element("tab", { "data-tour-safe": "" }), field: element("field", {}, "input") });
    const runner = new TourRunner(host);
    const seen = record(runner);
    const steps = tour.steps.map((step, index) => ({ ...step, actor: index === 0 ? "sales" as const : index === 2 ? "finance" as const : undefined }));
    runner.start({ ...tour, steps });
    await settle(runner);
    const switches = seen.filter((state, index) => state.phase === "switching" && seen[index - 1]?.phase !== "switching").map((state) => state.actor);
    expect(switches).toEqual(["sales", "finance"]);
    // The cursor doesn't move while someone takes over.
    expect(seen.filter((state) => state.phase === "switching").every((state) => !state.pointer)).toBe(true);
    expect(seen.filter((state) => state.index === 1 && state.phase === "speaking").every((state) => state.actor === "sales")).toBe(true);
    expect(seen.filter((state) => state.index === 3 && state.phase === "speaking").every((state) => state.actor === "finance")).toBe(true);
  });

  it("returns to records opened earlier (captured from the address) and skips a step whose record is unknown", async () => {
    const host = fakeHost({ list: element("list"), detail: element("detail"), portal: element("portal") });
    let where = "/workspace/pre-projects/cases/11111111-2222-4333-8444-555555555555/requirements?quote=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    host.location = () => where;
    host.navigate = (href) => { host.navigated.push(href); where = href; };
    host.path = () => where.split("?")[0];
    const runner = new TourRunner(host);
    const seen = record(runner);
    runner.start({
      id: "journey", title: "Home at a glance", screens: [],
      captures: [{ key: "case", pattern: "/pre-projects/cases/([0-9a-f-]{36})" }, { key: "quote", pattern: "[?&]quote=([0-9a-f-]{36})" }],
      steps: [
        { id: "one", route: where, target: "list", action: "point", woddy: "hello", narration: "One." as never },
        { id: "two", route: "/workspace/client-view/{case}", target: "portal", action: "wait", woddy: "hello", narration: "Two." as never },
        { id: "three", route: "/workspace/projects/{project}/site", target: "detail", action: "point", woddy: "hello", narration: "Three." as never },
        { id: "recap", action: "wait", woddy: "celebrating", narration: "Four." as never },
      ],
    });
    await settle(runner);
    expect(host.navigated).toContain("/workspace/client-view/11111111-2222-4333-8444-555555555555");
    // No project was opened, so the site step is skipped with a note and nothing is guessed.
    expect(host.navigated.some((href) => href.includes("/projects/"))).toBe(false);
    expect(seen.some((state) => state.index === 2 && state.missing)).toBe(true);
    expect(host.said).toEqual(["One.", "Two.", "Four."]);
    // Opening another screen shows the loading state, with the cursor out of sight.
    expect(seen.filter((state) => state.phase === "loading").every((state) => !state.pointer)).toBe(true);
    expect(seen.some((state) => state.phase === "loading")).toBe(true);
  });

  it("moves the cursor into a dialog the step opened, never pointing behind it", async () => {
    const dialog = document.createElement("div");
    const sheet = element("sheet");
    dialog.append(sheet);
    document.body.append(dialog);
    const overlays: HTMLElement[] = [];
    const host = fakeHost({ list: element("list"), row: element("row", { "data-tour-safe": "" }), sheet }, overlays);
    host.press = () => { overlays.push(dialog); };
    const runner = new TourRunner(host);
    const seen = record(runner);
    runner.start({ ...tour, steps: [tour.steps[0], { id: "two", target: "row", action: "click", waitFor: "sheet", woddy: "working", narration: "Two." as never }] });
    await settle(runner);
    const speaking = seen.find((state) => state.index === 1 && state.phase === "speaking");
    expect(speaking?.pointer?.dataset.tour).toBe("sheet");
    expect(speaking?.spotlight?.dataset.tour).toBe("sheet");
  });

  it("points at the row of the job it follows, and at the first row when that job isn't known", async () => {
    const list = element("list"), first = element("row"), followed = element("row");
    const find = (target: string, record?: string) => (target === "list" ? list : target === "row" ? (record ? (record === "c2" ? followed : null) : first) : null);
    const steps = [tour.steps[0], { id: "two", target: "row#{case}|row", action: "point" as const, woddy: "hello" as const, narration: "Two." as never }];
    for (const [values, expected] of [[{ case: "c2" }, followed], [{ case: "c9" }, first], [{}, first]] as const) {
      const host = fakeHost({});
      host.find = find;
      const runner = new TourRunner(host);
      const seen = record(runner);
      runner.start({ ...tour, steps }, values);
      await settle(runner);
      expect(seen.find((state) => state.index === 1 && state.phase === "moving")?.pointer).toBe(expected);
    }
  });

  it("takes the first target that is on screen when a step names alternatives", async () => {
    const host = fakeHost({ list: element("list"), status: element("status") });
    const runner = new TourRunner(host);
    runner.start({ ...tour, steps: [tour.steps[0], { id: "two", target: "send|status", action: "point", woddy: "hello", narration: "Two." as never }] });
    const seen = record(runner);
    await settle(runner);
    expect(seen.find((state) => state.index === 1 && state.phase === "moving")?.pointer?.dataset.tour).toBe("status");
    expect(host.said).toEqual(["One our client.", "Two."]);
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
        if (step.caption) expect(en).toHaveProperty([step.caption]);
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

  it("follows the whole journey in the full walkthrough: people, the client's side and back, with short captions", () => {
    const journey = tourById("full-journey")!;
    expect(tours[0]).toBe(journey);
    expect(journey.steps.length).toBeGreaterThanOrEqual(20);
    expect(journey.steps.length).toBeLessThanOrEqual(30);
    expect(journey.steps[0].id).toBe("greeting");
    const actors = journey.steps.map((step) => step.actor).filter(Boolean);
    expect(new Set(actors)).toEqual(new Set(["sales", "designer", "estimator", "approver", "finance", "buyer", "factory", "site", "client"]));
    // The client's side sits in the middle, then the tour returns to staff.
    const client = journey.steps.findIndex((step) => step.actor === "client");
    expect(client).toBeGreaterThan(5);
    expect(journey.steps.slice(client + 1).some((step) => step.actor && step.actor !== "client")).toBe(true);
    const captured = new Set(journey.captures?.map((capture) => capture.key));
    for (const step of journey.steps) {
      // Every record a route returns to was captured earlier; captions stay short on screen.
      for (const [, key] of step.route?.matchAll(/\{(\w+)\}/g) ?? []) expect(captured.has(key), `${step.id}: {${key}}`).toBe(true);
      expect(step.caption, step.id).toBeTruthy();
      expect(step.caption!.split(/\s+/).length, step.id).toBeLessThanOrEqual(14);
    }
    for (const item of tours) for (const step of item.steps) if (step.actor) expect(Object.keys(TOUR_PERSONAS)).toContain(step.actor);
    expect(actorAt(journey, 0)).toBeNull();
    expect(actorAt(journey, 2)).toBe("sales");
    expect(fillRoute("/workspace/client-view/{case}", { case: "abc" })).toBe("/workspace/client-view/abc");
    expect(fillRoute("/workspace/projects/{project}/site", {})).toBeNull();
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
