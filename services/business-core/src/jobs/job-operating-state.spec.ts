import { describe, expect, it } from "vitest";
import { deriveJobOperatingState, type JobOperatingSource } from "./job-operating-state";

const source = (
  type: JobOperatingSource["type"],
  status: string,
  details: Record<string, unknown> = {},
): JobOperatingSource => ({
  type, id: `${type}-1`, caseId: type === "quote" ? "case-1" : null,
  version: 3, status, createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:00:00.000Z",
  owner: { membershipId: "member-1", name: "Operations" },
  nextAction: null, details,
});

describe("Job operating projection", () => {
  it("derives the lifecycle from source evidence instead of a mutable Job phase", () => {
    expect(deriveJobOperatingState({ sources: [source("enquiry", "open")] }).phase).toBe("intake");
    expect(deriveJobOperatingState({ sources: [source("lead", "attempting_contact")] }).phase).toBe("qualify");
    expect(deriveJobOperatingState({ sources: [source("case", "active", { phase: "design" })] }).phase).toBe("design_scope");
    expect(deriveJobOperatingState({ sources: [source("quote", "accepted")] }).phase).toBe("agree");
    expect(deriveJobOperatingState({ sources: [source("project", "active", { phase: "handover" })] }).phase).toBe("handover");
    expect(deriveJobOperatingState({ sources: [source("project", "completed", { phase: "completed" })] }).phase).toBe("aftercare");
  });

  it("does not infer a stale phase or action when later sources are hidden", () => {
    const state = deriveJobOperatingState({ sources: [source("lead", "qualified")], hiddenSourceCount: 1 });
    expect(state.phase).toBe("unknown");
    expect(state.accessLimited).toBe(true);
    expect(state.nextAction).toBeNull();
  });

  it("uses a manual stage only inside its current derived phase", () => {
    const lead = source("lead", "new");
    const common = { stage: "First response", reason: "Operations agreed the response step.", setBy: "user-1", setByName: "Ops", setAt: "2026-09-01T09:00:00.000Z", version: 2 };
    expect(deriveJobOperatingState({ sources: [lead], manualStage: { ...common, phase: "qualify" } }).stage.manual).toBe(true);
    const advanced = deriveJobOperatingState({ sources: [source("case", "active", { phase: "design" })], manualStage: { ...common, phase: "qualify" } });
    expect(advanced.stage).toMatchObject({ manual: false, label: "Design & scope" });
  });

  it("puts blockers and client decisions ahead of routine work", () => {
    const held = deriveJobOperatingState({ sources: [source("case", "on_hold", { phase: "design", holdReason: "Site access is not confirmed." })] });
    expect(held.flags.blocked.active).toBe(true);
    expect(held.nextAction?.title).toBe("Site access is not confirmed.");
    const waiting = deriveJobOperatingState({ sources: [source("quote", "issued")] });
    expect(waiting.flags.awaiting_client.active).toBe(true);
    expect(waiting.nextAction?.title).toBe("Get the client decision");
  });

  it("surfaces overdue accountable actions as at risk with source and route", () => {
    const lead = source("lead", "connected");
    lead.nextAction = { title: "Call the client", dueAt: "2026-09-01T09:00:00.000Z", reason: "CRM next action" };
    const state = deriveJobOperatingState({ sources: [lead], now: new Date("2026-09-02T09:00:00.000Z") });
    expect(state.flags.at_risk.active).toBe(true);
    expect(state.nextAction).toMatchObject({ title: "Call the client", route: "/workspace/crm/leads?lead=lead-1", source: { type: "lead", version: 3 } });
  });
});
