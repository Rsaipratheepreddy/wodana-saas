import { describe, expect, it } from "vitest";
import { noticeQuoteStep } from "./quote-notices";

/** A database that answers the notice's reads and records what it was asked. */
function fakeDb() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const query = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    if (sql.includes("FROM pre_project_cases")) return { rows: [{ clientName: "QA Client", ownerUserId: "owner" }], rowCount: 1 };
    if (sql.includes("FROM users")) return { rows: [{ name: "Sara" }], rowCount: 1 };
    if (sql.includes("permission.code")) return { rows: [{ userId: "approver" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  return { query, queries };
}

const input = { workspaceId: "ws", caseId: "case", quoteId: "quote", number: 2, title: "VO-1 · TV wall", action: "submit", actorUserId: "sara", revision: 3 };

describe("quote review notices", () => {
  it("tells the people who can approve a variation, not the QS", async () => {
    const db = fakeDb();
    await noticeQuoteStep(db, { ...input, reviewPermission: "commercial.approve" });
    const reviewers = db.queries.find((query) => query.sql.includes("permission.code"))!;
    expect(reviewers.params).toEqual(["ws", "commercial.approve"]);
    expect(reviewers.sql).not.toContain("commercial.estimate");
  });

  it("tells the estimators when the review is a QS estimate review", async () => {
    const db = fakeDb();
    await noticeQuoteStep(db, { ...input, reviewPermission: "commercial.estimate" });
    expect(db.queries.find((query) => query.sql.includes("permission.code"))!.params).toEqual(["ws", "commercial.estimate"]);
  });

  it("goes to approvers when no review permission is named", async () => {
    const db = fakeDb();
    await noticeQuoteStep(db, input);
    expect(db.queries.find((query) => query.sql.includes("permission.code"))!.params).toEqual(["ws", "commercial.approve"]);
  });
});
