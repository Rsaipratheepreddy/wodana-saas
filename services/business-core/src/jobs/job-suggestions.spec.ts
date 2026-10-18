import { describe, expect, it } from "vitest";
import { candidates } from "./job-suggestions";

const now = (patch: Record<string, unknown>) => ({ key: "proposal_1", chapter: "win", lane: "sales", label: "Proposal 1 sent", state: "now", doneAt: null, doneBy: null, dueAt: null, href: null,
  owner: "Sam Sales", doneWhen: "x", ...patch });
const people = [{ membershipId: "m1", name: "Sam Sales" }];
const today = new Date("2026-10-17T09:00:00Z");

describe("suggestions inside the step now (§0.3 P11)", () => {
  it("offers to nudge a late step's owner in the job chat, with its source and confidence", () => {
    const [nudge] = candidates({ jobId: "j", client: "Layla Al Mazrouei", now: now({ dueAt: "2026-10-14T09:00:00Z" }) as never }, people, today);
    expect(nudge).toMatchObject({ kind: "nudge_owner", title: "Nudge Sam Sales", source: "The step's due date and owner", confidence: 0.9,
      action: { type: "thread_message", body: "@Sam Sales Proposal 1 sent is 3 days late. Can you update it today?", mentions: ["m1"] } });
  });

  it("drafts a client reminder to copy (never sends it) when the step waits on the client", () => {
    const [reminder] = candidates({ jobId: "j", client: "Layla Al Mazrouei", now: now({ lane: "client", label: "Proposal 1 accepted", owner: null }) as never }, people, today);
    expect(reminder).toMatchObject({ kind: "client_reminder", action: { type: "copy" } });
    expect(reminder.action.body).toContain("Hi Layla");
  });

  it("suggests nothing for a step on time, an owner not on the job, or a finished job", () => {
    expect(candidates({ jobId: "j", client: null, now: now({ dueAt: "2026-10-20T09:00:00Z" }) as never }, people, today)).toEqual([]);
    expect(candidates({ jobId: "j", client: null, now: now({ dueAt: "2026-10-01T09:00:00Z", owner: "Someone else" }) as never }, people, today)).toEqual([]);
    expect(candidates({ jobId: "j", client: null, now: null }, people, today)).toEqual([]);
  });
});
