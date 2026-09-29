import { beforeEach, describe, expect, it, vi } from "vitest";

const tellClients = vi.fn();
const notifyUserInApp = vi.fn();
vi.mock("../client-portal/portal-notices", () => ({ tellClients: (...args: unknown[]) => tellClients(...args) }));
vi.mock("../notifications/default-templates", () => ({ notifyUserInApp: (...args: unknown[]) => notifyUserInApp(...args) }));

import { processClientDecisions, reminderDays, reminderRound } from "./client-decision-reminders";

const rows = (list: unknown[]) => ({ rows: list, rowCount: list.length });

function db(input: { days?: number[] | null; quotes?: unknown[]; designs?: unknown[] }) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("decision_reminder_days")) return rows([{ days: input.days ?? null, today: "2026-10-10" }]);
      if (sql.includes("FROM commercial_quotes")) return rows(input.quotes ?? []);
      if (sql.includes("FROM pre_project_design_versions version")) return rows(input.designs ?? []);
      return rows([]);
    }),
  };
}

describe("client decision reminders (Q-8)", () => {
  beforeEach(() => {
    tellClients.mockReset().mockResolvedValue({ queued: 1 });
    notifyUserInApp.mockReset().mockResolvedValue({ queued: true });
  });

  it("reads the firm's days, sorted and bounded, with 2 and 5 by default", () => {
    expect(reminderDays(undefined)).toEqual([2, 5]);
    expect(reminderDays([7, 3, 3, 0, 90])).toEqual([3, 7]);
    expect(reminderDays([])).toEqual([]);
  });

  it("knows which round is due", () => {
    expect(reminderRound(1, [2, 5])).toBe(0);
    expect(reminderRound(2, [2, 5])).toBe(1);
    expect(reminderRound(4, [2, 5])).toBe(1);
    expect(reminderRound(9, [2, 5])).toBe(2);
  });

  it("reminds the client and the case owner of an issued quote, once per round, with a link to the quote", async () => {
    const database = db({ quotes: [{ id: "q1", caseId: "case-1", title: "Kitchen", number: 1, clientName: "Aisha", waited: 5, validUntil: "2026-10-30", ownerUserId: "owner-1" }] });
    await expect(processClientDecisions(database, "w1")).resolves.toEqual({ sent: 1, clients: 1 });
    expect(tellClients).toHaveBeenCalledWith(database, expect.objectContaining({ caseId: "case-1", event: "decision_waiting", recordId: "quote:q1:reminder:2", title: "Kitchen", due: "2026-10-30" }));
    expect(notifyUserInApp).toHaveBeenCalledWith(database, expect.objectContaining({
      recipientUserId: "owner-1", code: "commercial.decision_waiting", deepLink: "/workspace/pre-projects/cases/case-1/quotations?quote=q1",
      idempotencyKey: "commercial.decision_waiting:quote:q1:2:owner-1", variables: expect.objectContaining({ note: "With Aisha for 5 days." }),
    }));
  });

  it("tells the case owner and the design's author about a design with the client, and waits before the first day", async () => {
    const database = db({ designs: [
      { id: "v1", caseId: "case-1", title: "Living room", number: 2, clientName: "Aisha", waited: 2, ownerUserId: "owner-1", authorUserId: "designer-1" },
      { id: "v2", caseId: "case-1", title: "Bedroom", number: 1, clientName: "Aisha", waited: 1, ownerUserId: "owner-1", authorUserId: "designer-1" },
    ] });
    await expect(processClientDecisions(database, "w1")).resolves.toEqual({ sent: 2, clients: 1 });
    expect(tellClients).toHaveBeenCalledTimes(1);
    expect(tellClients).toHaveBeenCalledWith(database, expect.objectContaining({ recordId: "design:v1:reminder:1", title: "Living room R2" }));
    expect(notifyUserInApp.mock.calls.map(([, input]) => input.recipientUserId)).toEqual(["owner-1", "designer-1"]);
  });

  it("sends nothing when the firm turned the reminders off", async () => {
    const database = db({ days: [], quotes: [{ id: "q1", caseId: "case-1", title: "Kitchen", number: 1, clientName: "", waited: 9, validUntil: null, ownerUserId: "owner-1" }] });
    await expect(processClientDecisions(database, "w1")).resolves.toEqual({ sent: 0, clients: 0 });
    expect(tellClients).not.toHaveBeenCalled();
  });
});
