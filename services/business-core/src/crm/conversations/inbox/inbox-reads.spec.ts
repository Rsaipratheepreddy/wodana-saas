import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { applyConversationChange, mayReopen, REOPEN_REFUSED, reopenSql } from "./inbox-commands";
import { markConversationRead, unreadSql } from "./inbox-reads";

const RESOLVER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const OWNER_MEMBERSHIP = "33333333-3333-4333-8333-333333333333";
const resolved = { id: "chat", status: "closed", resolved_by: RESOLVER, owner_membership_id: OWNER_MEMBERSHIP, version: 4 };

describe("who may reopen a resolved chat", () => {
  it("is the person who resolved it, or an inbox manager", () => {
    expect(mayReopen(resolved, { userId: RESOLVER, membershipId: null, manager: false })).toBe(true);
    expect(mayReopen(resolved, { userId: OTHER, membershipId: OWNER_MEMBERSHIP, manager: false })).toBe(false);
    expect(mayReopen(resolved, { userId: OTHER, membershipId: null, manager: true })).toBe(true);
  });

  it("counts a chat the system resolved as resolved by its owner", () => {
    const quiet = { ...resolved, resolved_by: null };
    expect(mayReopen(quiet, { userId: OTHER, membershipId: OWNER_MEMBERSHIP, manager: false })).toBe(true);
    expect(mayReopen(quiet, { userId: OTHER, membershipId: "44444444-4444-4444-8444-444444444444", manager: false })).toBe(false);
    expect(mayReopen({ ...quiet, owner_membership_id: null }, { userId: OTHER, membershipId: null, manager: false })).toBe(false);
  });

  it("leaves every other state alone", () => {
    for (const status of ["open", "unresolved", "snoozed", "spam"]) expect(mayReopen({ ...resolved, status }, { userId: OTHER, membershipId: null, manager: false })).toBe(true);
  });

  it("is the same rule for a list's rows, never null", () => {
    const sql = reopenSql("$3", "$2", "$4");
    expect(sql).toContain("conversation.status = 'closed'");
    expect(sql).toContain("conversation.resolved_by = $3::uuid");
    expect(sql).toContain("conversation.owner_membership_id = $2::uuid");
    expect(sql).toMatch(/COALESCE\(\$4::boolean OR[\s\S]*, false\)\)$/);
  });

  it("refuses anyone else with a 403 and changes nothing", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const record = vi.fn();
    const attempt = applyConversationChange({ query } as never, { record } as never, { workspaceId: "ws", before: resolved, change: { status: "open" }, actorUserId: OTHER, method: "manual", expectedVersion: 4,
      reopener: { membershipId: OWNER_MEMBERSHIP, manager: false } });
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    await expect(attempt).rejects.toThrow(REOPEN_REFUSED);
    expect(query).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("lets the resolver reopen it, audited like resolve, and a new resolve names who resolved", async () => {
    const query = vi.fn(async (sql: string) => sql.startsWith("UPDATE crm_conversations")
      ? { rows: [{ ...resolved, status: "open", resolved_by: null, version: 5 }], rowCount: 1 } : { rows: [], rowCount: 1 });
    const record = vi.fn();
    const { changed } = await applyConversationChange({ query } as never, { record } as never, { workspaceId: "ws", before: resolved, change: { status: "open" }, actorUserId: RESOLVER, method: "manual", expectedVersion: 4 });
    expect(changed).toBe(true);
    const update = (query.mock.calls as unknown as Array<[string, unknown[]]>).find(([sql]) => sql.startsWith("UPDATE crm_conversations"))!;
    expect(update[0]).toContain("resolved_by = CASE WHEN $3::varchar = 'closed'");
    expect(update[1][8]).toBe(RESOLVER);
    expect((query.mock.calls as unknown as Array<[string, unknown[]]>).some(([sql, values]) => sql.includes("INSERT INTO crm_conversation_events") && values[2] === "reopened")).toBe(true);
    expect(record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "crm.conversation.updated.v1", before: expect.objectContaining({ status: "closed", resolvedBy: RESOLVER }), after: expect.objectContaining({ status: "open" }) }));
  });
});

describe("unread for each person", () => {
  it("compares the latest client message with this person's own read and the chat's baseline", () => {
    const sql = unreadSql("$3");
    expect(sql).toContain("conversation.last_inbound_at IS NOT NULL");
    expect(sql).toContain("seen.user_id = $3::uuid");
    expect(sql).toContain("COALESCE(conversation.read_baseline_at, '-infinity'::timestamptz)");
  });

  it("marks a chat read for one person, never moving a read back in time", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    await markConversationRead({ query } as never, "ws", "chat", RESOLVER);
    const [sql, values] = (query.mock.calls as unknown as Array<[string, unknown[]]>)[0];
    expect(sql).toContain("ON CONFLICT (workspace_id, conversation_id, user_id) DO UPDATE SET last_read_at = greatest(");
    expect(values).toEqual(["ws", "chat", RESOLVER]);
  });
});
