import { beforeEach, describe, expect, it, vi } from "vitest";

const tellClients = vi.fn(async () => ({ queued: 1, reason: null, names: ["Aisha"] }));
vi.mock("../client-portal/portal-notices", () => ({ tellClients }));

const { amountText, noticeReceiptReturned, noticeReceiptStep } = await import("./commercial-notices");

/** A database that answers the notice's reads and records every notice it was asked to write. */
function fakeDb(holders: Record<string, string[]>) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return {
    queries,
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (sql.includes("FROM pre_project_cases")) return { rows: [{ clientName: "Aisha", ownerUserId: "sara" }], rowCount: 1 };
      if (sql.includes("FROM users WHERE id")) return { rows: [{ name: "Layla" }], rowCount: 1 };
      if (sql.includes("permission.code = $2")) {
        const rows = (holders[String(params[1])] ?? []).map((userId) => ({ userId }));
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("FROM notification_templates")) return { rows: [{ id: "t", subject: "s", body: "b" }], rowCount: 1 };
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: "n", correlationId: "c" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
}
const told = (db: ReturnType<typeof fakeDb>) => db.queries.filter((query) => query.sql.includes("INSERT INTO notifications"))
  .map((query) => `${query.params[2]}:${query.params[3]}:${query.sql.includes("'in_app'") ? "app" : "email"}`).sort();

const payment = { id: "pay-1", title: "Advance", amount: 1234.5, currency: "AED" };

describe("client payment hand-offs", () => {
  beforeEach(() => tellClients.mockClear());

  it("tells everyone who verifies receipts that one was reported, in the app and by email; never the reporter", async () => {
    const db = fakeDb({ "commercial.finance.verify": ["layla", "sara"] });
    await noticeReceiptStep(db, { workspaceId: "ws", caseId: "case", payment, step: "reported", actorUserId: "sara", revision: 4, reporterUserId: "sara", dealWaiting: false });
    expect(told(db)).toEqual(["layla:commercial.receipt_reported:app", "layla:commercial.receipt_reported:email"]);
    expect(tellClients).not.toHaveBeenCalled();
  });

  it("tells the reporter, the Account Manager, waiting deal approvers and the client that it was verified", async () => {
    const db = fakeDb({ "commercial.deal.approve": ["olivia", "layla"] });
    await noticeReceiptStep(db, { workspaceId: "ws", caseId: "case", payment, step: "verified", actorUserId: "layla", revision: 5, reporterUserId: "omar", dealWaiting: true, demo: false });
    expect(told(db)).toEqual(["olivia:commercial.receipt_verified:app", "omar:commercial.receipt_verified:app", "sara:commercial.receipt_verified:app"]);
    expect(tellClients).toHaveBeenCalledWith(db, expect.objectContaining({ event: "payment_checked", caseId: "case", recordId: "verified:pay-1", title: "Advance",
      note: "We received your payment of AED 1234.50 for Advance. Thank you." }));
  });

  it("tells the person who recorded a returned receipt why, in the app and by email; never the client", async () => {
    const db = fakeDb({});
    await noticeReceiptReturned(db, { workspaceId: "ws", caseId: "case", payment, reason: "The bank shows 900", actorUserId: "layla", reporterUserId: "omar", revision: 6 });
    expect(told(db)).toEqual(["omar:commercial.receipt_returned:app", "omar:commercial.receipt_returned:email"]);
    expect(tellClients).not.toHaveBeenCalled();
    const quiet = fakeDb({});
    await noticeReceiptReturned(quiet, { workspaceId: "ws", caseId: "case", payment, reason: "x", actorUserId: "layla", reporterUserId: "layla", revision: 6 });
    expect(told(quiet)).toEqual([]);
  });

  it("doesn't tell the client twice when Finance already answered their own payment report", async () => {
    const db = fakeDb({});
    const base = db.query.bind(db);
    db.query = async (sql: string, params: unknown[] = []) => sql.includes("client_portal_payment_notices") ? { rows: [{}], rowCount: 1 } : base(sql, params);
    await noticeReceiptStep(db, { workspaceId: "ws", caseId: "case", payment, step: "verified", actorUserId: "layla", revision: 5, reporterUserId: null, dealWaiting: false });
    expect(tellClients).not.toHaveBeenCalled();
  });

  it("asks nobody extra when no deal waits on the money", async () => {
    const db = fakeDb({ "commercial.deal.approve": ["olivia"] });
    await noticeReceiptStep(db, { workspaceId: "ws", caseId: "case", payment, step: "verified", actorUserId: "layla", revision: 5, reporterUserId: null, dealWaiting: false });
    expect(told(db)).toEqual(["sara:commercial.receipt_verified:app"]);
  });

  it("writes amounts exactly in the currency's minor units", () => {
    expect(amountText(1234.5, "AED")).toBe("AED 1234.50");
    expect(amountText(1234.5678, "KWD")).toBe("KWD 1234.568");
    expect(amountText(1500.4, "JPY")).toBe("JPY 1500");
  });
});
