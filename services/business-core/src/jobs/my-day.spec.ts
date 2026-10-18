import { NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { JourneyLane, JourneyView } from "./job-journey";
import {
  couldBeMine, laneSeats, lanesOf, mineBecause, orderMyDay, readJobsMyDay, urgencyOf, type MyDayDeps, type MyDayViewer,
} from "./my-day";

const viewer = (patch: Partial<MyDayViewer> = {}): MyDayViewer => ({ membershipId: "member-me", name: "Designer One", sharedLanes: new Set(), jobLanes: new Map(), timeZone: "UTC", ...patch });

describe("which job steps are mine (§0.3 My day)", () => {
  it("a named owner decides: me by my name, never someone else's step whatever my seats", () => {
    const me = viewer({ sharedLanes: new Set<JourneyLane>(["sales"]), jobLanes: new Map([["job-1", new Set<JourneyLane>(["design"])]]) });
    expect(mineBecause("job-1", { owner: "Designer One", lane: "design" }, me)).toBe("owner");
    expect(mineBecause("job-1", { owner: " Designer One ", lane: "sales" }, me)).toBe("owner");
    expect(mineBecause("job-1", { owner: "Account Manager", lane: "sales" }, me)).toBeNull();
    expect(mineBecause("job-1", { owner: "Account Manager", lane: "design" }, me)).toBeNull();
  });

  it("an owner is matched by membership: someone with my name is not me, and a renamed me still is", () => {
    const me = viewer({ sharedLanes: new Set<JourneyLane>(["sales"]) });
    expect(mineBecause("job-1", { owner: "Designer One", ownerId: "member-other", lane: "sales" }, me)).toBeNull();
    expect(mineBecause("job-1", { owner: "D. One", ownerId: "member-me", lane: "sales" }, me)).toBe("owner");
    expect(couldBeMine("job-1", "Designer One", me, "member-other")).toBe(false);
    expect(couldBeMine("job-1", "D. One", me, "member-me")).toBe(true);
  });

  it("an unowned step is mine through a seat: shared lanes by a workspace seat, design and delivery only by a seat on that job", () => {
    const finance = viewer({ name: "Finance", sharedLanes: new Set<JourneyLane>(["finance"]) });
    expect(mineBecause("job-1", { owner: null, lane: "finance" }, finance)).toBe("seat");
    expect(mineBecause("job-1", { owner: null, lane: "sales" }, finance)).toBeNull();
    // A design seat in the workspace is not a seat on every job: only the jobs I am on.
    const designer = viewer({ sharedLanes: new Set(), jobLanes: new Map([["job-1", new Set<JourneyLane>(["design"])]]) });
    expect(mineBecause("job-1", { owner: null, lane: "design" }, designer)).toBe("seat");
    expect(mineBecause("job-2", { owner: null, lane: "design" }, designer)).toBeNull();
    // A seat on the job works a shared lane on that job too (the account manager of this case).
    const manager = viewer({ jobLanes: new Map([["job-3", new Set<JourneyLane>(["sales"])]]) });
    expect(mineBecause("job-3", { owner: null, lane: "sales" }, manager)).toBe("seat");
    // The client's steps are nobody's on the staff side.
    expect(mineBecause("job-1", { owner: null, lane: "client" }, viewer({ sharedLanes: new Set<JourneyLane>(["sales", "finance"]), jobLanes: new Map([["job-1", new Set<JourneyLane>(["design", "delivery", "sales"])]]) }))).toBeNull();
  });

  it("maps seats to lanes from the standard seats and the firm's own design-team role codes", () => {
    expect([...lanesOf(["account_manager", "finance_reviewer"])].sort()).toEqual(["finance", "sales"]);
    expect([...lanesOf(["senior_designer"])]).toEqual([]);
    const seats = laneSeats({ lead_designer: "senior_designer", technicalLeadRoleCode: "workshop_head", sales_admin: "front_desk" });
    expect([...lanesOf(["senior_designer"], seats)]).toEqual(["design"]);
    expect([...lanesOf(["workshop_head"], seats)]).toEqual(["delivery"]);
    expect([...lanesOf(["front_desk"], seats)]).toEqual(["sales"]);
  });

  it("only reads the journeys that could be mine", () => {
    expect(couldBeMine("job-1", "Designer One", viewer())).toBe(true);
    expect(couldBeMine("job-1", "Someone Else", viewer({ sharedLanes: new Set<JourneyLane>(["sales"]) }))).toBe(false);
    expect(couldBeMine("job-1", null, viewer())).toBe(false);
    expect(couldBeMine("job-1", null, viewer({ jobLanes: new Map([["job-1", new Set<JourneyLane>(["design"])]]) }))).toBe(true);
  });
});

describe("the order of My day", () => {
  const now = new Date("2026-10-17T08:00:00Z");
  it("reads due dates on my calendar: late, today, later", () => {
    expect(urgencyOf("2026-10-16", now, "UTC")).toBe("late");
    expect(urgencyOf("2026-10-17", now, "UTC")).toBe("today");
    expect(urgencyOf("2026-10-18", now, "UTC")).toBe("later");
    expect(urgencyOf("2026-10-17T07:59:00Z", now, "UTC")).toBe("late");
    expect(urgencyOf("2026-10-17T20:00:00Z", now, "UTC")).toBe("today");
    // 20:00 UTC is already tomorrow four hours east of it.
    expect(urgencyOf("2026-10-17T21:00:00Z", now, "Asia/Kolkata")).toBe("later");
    expect(urgencyOf(null, now, "UTC")).toBe("later");
  });

  it("puts late first, then due today, then the rest; earliest first, undated last", () => {
    const item = (reference: string, urgency: "late" | "today" | "later", dueAt: string | null) => ({ reference, urgency, step: { dueAt } });
    const ordered = orderMyDay([
      item("J-6", "later", null), item("J-5", "later", "2026-10-20"), item("J-4", "today", "2026-10-17T15:00:00Z"), item("J-3", "today", "2026-10-17T09:00:00Z"),
      item("J-2", "late", "2026-10-15"), item("J-1", "late", "2026-10-10T10:00:00Z"),
    ]);
    expect(ordered.map((entry) => entry.reference)).toEqual(["J-1", "J-2", "J-3", "J-4", "J-5", "J-6"]);
  });
});

describe("reading My day", () => {
  const journey = (id: string, owner: string | null, lane: JourneyLane, dueAt: string | null): JourneyView => ({
    jobId: id, reference: id.toUpperCase(), title: `Villa ${id}`, client: "Client", chapters: [], lanes: [], steps: [], next: [], value: null, targetDate: null,
    now: { key: "contact", chapter: "win", lane, label: "First contact", state: "now", doneAt: null, doneBy: null, dueAt, href: `/workspace/crm/leads?lead=${id}`, owner, ownerId: null, doneWhen: "A call is logged" },
  });
  const journeys: Record<string, JourneyView> = {
    a: journey("a", "Designer One", "sales", "2026-10-18"),
    b: journey("b", null, "finance", "2026-10-10"),
    c: journey("c", "Someone Else", "sales", "2026-10-01"),
    d: journey("d", null, "design", "2026-10-17"),
    e: journey("e", null, "design", null),
  };
  const row = (id: string) => ({ id, reference: id.toUpperCase(), title: null, client: null, chapter: "win" as const,
    now: { label: "First contact", owner: journeys[id].now!.owner, dueAt: journeys[id].now!.dueAt, late: false }, progress: { done: 2, total: 40 }, value: null, targetDate: null });

  it("reads the Jobs list a page at a time, opens only the candidates' journeys, and orders what is mine", async () => {
    const opened: string[] = [];
    const deps: MyDayDeps = {
      now: () => new Date("2026-10-17T08:00:00Z"),
      jobs: {
        overview: (async (_actor: unknown, _ws: string, limit?: string, offset?: string) => {
          const all = ["a", "b", "c", "d", "e", "gone"].map((id) => (id === "gone" ? { ...row("a"), id: "gone" } : row(id)));
          const start = Number(offset);
          return { items: all.slice(start, start + Number(limit)), total: all.length, limit: Number(limit), offset: start };
        }) as never,
        journey: (async (_actor: unknown, _ws: string, id: string) => {
          opened.push(id);
          if (id === "gone") throw new NotFoundException("Job not found.");
          return journeys[id];
        }) as never,
      },
      access: { asMember: (async () => viewer({ sharedLanes: new Set<JourneyLane>(["finance"]), jobLanes: new Map([["d", new Set<JourneyLane>(["design"])]]) })) as never },
    };
    const result = await readJobsMyDay(deps, {} as never, "ws");
    expect(result.items.map((item) => [item.jobId, item.urgency, item.why])).toEqual([["b", "late", "seat"], ["d", "today", "seat"], ["a", "later", "owner"]]);
    expect(result.counts).toEqual({ late: 1, today: 1, later: 1, total: 3 });
    expect(result.items[0]).toMatchObject({ step: { label: "First contact", doneWhen: "A call is logged", lane: "finance", href: "/workspace/crm/leads?lead=b" }, progress: { done: 2, total: 40 } });
    // Someone else's named step is never opened; a job that left my sight is skipped.
    expect(opened).not.toContain("c");
    expect(opened).toContain("gone");
    expect(result.truncated).toBe(false);
    expect(result.today).toBe("2026-10-17");
  });
});
