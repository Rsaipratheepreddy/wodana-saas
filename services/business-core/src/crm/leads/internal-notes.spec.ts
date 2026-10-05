import { describe, expect, it, vi } from "vitest";
import { canReadNotes, isNotesField, notesReader, redactNotes } from "./internal-notes";

const db = (visibility: "team" | "sales", team: string[] = []) => ({
  query: vi.fn(async (sql: string) => {
    if (sql.includes("FROM workspace_sales_settings")) return { rowCount: 1, rows: [{ takeoverCap: 2, unownedEscalationMinutes: 15, clientReviewMinutes: 30, duplicateWindowDays: 90, salesAdminMembershipId: null, internalNotesVisibility: visibility, version: 1 }] };
    if (sql.includes("FROM workspace_memberships")) return { rowCount: 1, rows: [{ id: "me" }] };
    if (sql.includes("FROM crm_lead_team")) return { rowCount: team.length, rows: team.map((leadId) => ({ leadId })) };
    return { rowCount: 0, rows: [] };
  }),
});

describe("who reads internal notes (PLM-024)", () => {
  it("lets the enquiry team read them by default: the owner and the people tagged on it", async () => {
    const reader = await notesReader(db("team", ["tagged"]) as never, "ws", "u1", false, ["mine", "tagged", "other"]);
    expect(canReadNotes(reader, { id: "mine", ownerMembershipId: "me" })).toBe(true);
    expect(canReadNotes(reader, { id: "tagged", ownerMembershipId: "someone" })).toBe(true);
    expect(canReadNotes(reader, { id: "other", ownerMembershipId: "someone" })).toBe(false);
    expect(canReadNotes(reader, { id: null })).toBe(false);
  });
  it("lets whoever assigns enquiries read every enquiry's notes, and everyone with Sales access when the firm says so", async () => {
    expect(canReadNotes(await notesReader(db("team") as never, "ws", "u1", true, ["other"]), { id: "other" })).toBe(true);
    expect(canReadNotes(await notesReader(db("sales") as never, "ws", "u1", false, ["other"]), { id: "other" })).toBe(true);
  });
  it("removes only the notes from the details, and recognises a notes change in the history", () => {
    expect(redactNotes({ emirate: "dubai", internalNotes: "VIP" }, false)).toEqual({ emirate: "dubai" });
    expect(redactNotes({ emirate: "dubai", internalNotes: "VIP" }, true)).toEqual({ emirate: "dubai", internalNotes: "VIP" });
    expect(redactNotes(null, false)).toBeNull();
    expect(isNotesField("details.internalNotes")).toBe(true);
    expect(isNotesField("details.emirate")).toBe(false);
  });
});
