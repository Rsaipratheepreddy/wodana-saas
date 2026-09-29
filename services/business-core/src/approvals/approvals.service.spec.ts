import { describe, expect, it, vi } from "vitest";
import type { ApprovalRow } from "./approval-sources";

const rows: ApprovalRow[] = [];
vi.mock("./approval-sources", () => ({ waitingFor: vi.fn(async () => ({ rows, count: rows.length, counts: {} })) }));
const { ApprovalsService } = await import("./approvals.service");

const base = { subject: null, project: null, amount: null, currency: null, since: "2026-09-28T00:00:00.000Z", href: "/x", canDecide: true, reason: null, version: 4, parentId: null };
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function service() {
  const calls: Array<[string, unknown[]]> = [];
  const record = (name: string) => vi.fn(async (...args: unknown[]) => { calls.push([name, args]); return {}; });
  const client = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
  const access = { asMember: vi.fn(async (_a: unknown, _w: string, work: (c: unknown, u: unknown) => unknown) => work(client, { userId: "u1", displayName: "Layla" })), hasPermission: vi.fn(async () => true) };
  const instance = new ApprovalsService(access as never, { command: record("commercial") } as never, { command: record("orders") } as never, { command: record("factory") } as never,
    { decideAdjustment: record("inventory") } as never, { command: record("payables") } as never, { command: record("runs") } as never, { command: record("site") } as never, { command: record("pettyCash") } as never);
  return { instance, calls };
}

describe("deciding in the row", () => {
  it("sends each decision through its module's own command, with the module's words", async () => {
    rows.splice(0, rows.length,
      { ...base, kind: "order", group: "orders", id: id(1), title: "PO-1", decide: { approve: "approve", other: "return", approveNeedsNote: false } },
      { ...base, kind: "output", group: "factory", id: id(2), parentId: id(9), title: "WO-1", decide: { approve: "approve", other: "reject", approveNeedsNote: false } },
      { ...base, kind: "quote_review", group: "quotes", id: id(3), parentId: id(8), title: "Q-1", decide: { approve: "qs_approve", other: "return", approveNeedsNote: false } },
      { ...base, kind: "receipt", group: "payments", id: id(4), parentId: id(8), title: "Advance", decide: { approve: "verify_payment", other: null, approveNeedsNote: false } },
    );
    const { instance, calls } = service();
    await instance.decide({} as never, "w", { kind: "order", id: id(1), decision: "return", note: "Wrong supplier" });
    await instance.decide({} as never, "w", { kind: "output", id: id(2), decision: "reject", note: "Scratched" });
    await instance.decide({} as never, "w", { kind: "quote_review", id: id(3), decision: "approve" });
    await instance.decide({} as never, "w", { kind: "receipt", id: id(4), decision: "approve" });
    expect(calls).toEqual([
      ["orders", [{}, "w", id(1), { action: "return", version: 4, note: "Wrong supplier" }]],
      ["factory", [{}, "w", id(9), { action: "decide_report", reportId: id(2), decision: "refuse", version: 4, note: "Scratched" }]],
      ["commercial", [{}, "w", id(8), { action: "qs_approve", revision: 4, quoteId: id(3) }]],
      ["commercial", [{}, "w", id(8), { action: "verify_payment", revision: 4, paymentId: id(4) }]],
    ]);
  });

  it("refuses what isn't waiting for this person, what must be opened, and answers that don't apply", async () => {
    rows.splice(0, rows.length,
      { ...base, kind: "deal_approval", group: "deals", id: id(5), title: "Deal", decide: null },
      { ...base, kind: "receipt", group: "payments", id: id(4), title: "Advance", decide: { approve: "verify_payment", other: null, approveNeedsNote: false } },
    );
    const { instance, calls } = service();
    await expect(instance.decide({} as never, "w", { kind: "order", id: id(1), decision: "approve" })).rejects.toThrow(/no longer waiting/);
    await expect(instance.decide({} as never, "w", { kind: "deal_approval", id: id(5), decision: "approve" })).rejects.toThrow(/Open it/);
    await expect(instance.decide({} as never, "w", { kind: "receipt", id: id(4), decision: "return" })).rejects.toThrow(/doesn't apply/);
    await expect(instance.decide({} as never, "w", { kind: "receipt", id: "nope", decision: "approve" })).rejects.toThrow(/Choose what/);
    expect(calls).toEqual([]);
  });
});
