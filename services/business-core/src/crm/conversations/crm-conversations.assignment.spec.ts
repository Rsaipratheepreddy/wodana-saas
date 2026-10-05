import { describe, expect, it, vi } from "vitest";
import { CrmConversationsService } from "./crm-conversations.service";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const actorUserId = "33333333-3333-4333-8333-333333333333";
const ownerUserId = "44444444-4444-4444-8444-444444444444";
const leadId = "55555555-5555-4555-8555-555555555555";

function service(newOwnerUserId: string) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const conversation = { id: conversationId, party_id: "party", lead_id: leadId, channel: "whatsapp", subject: null, status: "open", owner_membership_id: null, version: 1 };
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    // The team inbox: the new owner is someone who works the inbox; who they are, the client and who assigned it.
    if (sql.startsWith("SELECT 1 FROM (")) return { rows: [{}], rowCount: 1 };
    if (sql.includes("JOIN users account ON account.id = membership.user_id")) return { rows: [{ userId: newOwnerUserId, displayName: "Owner" }], rowCount: 1 };
    if (sql.includes('AS "clientName"')) return { rows: [{ clientName: "Dr Maya Nair", actorName: "Sara" }], rowCount: 1 };
    if (sql.includes("FROM crm_conversations") && sql.includes("FOR UPDATE")) return { rows: [conversation], rowCount: 1 };
    if (sql.includes("FROM crm_conversations")) return { rows: [conversation], rowCount: 1 };
    if (sql.includes("FROM workspace_memberships WHERE id")) return { rows: [{}], rowCount: 1 };
    if (sql.startsWith("UPDATE crm_conversations")) return { rows: [{ ...conversation, owner_membership_id: "membership", version: 2 }], rowCount: 1 };
    if (sql.includes("FROM workspace_memberships owner")) return { rows: [{ ownerUserId: newOwnerUserId, assignedBy: "Sara", client: "Dr Maya Nair" }], rowCount: 1 };
    if (sql.includes("FROM notification_preferences")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM notification_templates")) return { rows: [{ id: "template", subject: "Conversation with {{client}} is yours", body: "{{assignedBy}} assigned it to you. Reply from the inbox." }], rowCount: 1 };
    if (sql.includes("INSERT INTO notifications")) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const access = { withPermission: vi.fn(async (_actor: unknown, _ws: string, _code: string, work: (client: unknown, user: { userId: string }) => unknown) => work({ query }, { userId: actorUserId })),
    // An inbox manager (plan §5b): every chat is within reach.
    hasPermission: vi.fn(async (_client: unknown, _ws: string, _user: string, code: string) => code === "crm.inbox.manage") };
  const instance = new CrmConversationsService({} as never, access as never, { record: vi.fn() } as never, {} as never);
  return { instance, calls };
}

describe("giving a conversation to someone (FD-3)", () => {
  it("tells the new owner in the app, with a link the phone can open", async () => {
    const { instance, calls } = service(ownerUserId);
    await instance.updateConversation({} as never, workspaceId, conversationId, { version: 1, ownerMembershipId: "66666666-6666-4666-8666-666666666666" } as never);
    const notice = calls.find((call) => call.sql.includes("INSERT INTO notifications") && call.sql.includes("'in_app'"));
    expect(notice?.values).toEqual(expect.arrayContaining([ownerUserId, "crm.conversation.assigned", "Conversation with Dr Maya Nair is yours", "Sara assigned it to you. Reply from the inbox.",
      `/workspace/crm/conversations?record=${conversationId}&lead=${leadId}`, `conversation-assigned:${conversationId}:2`]));
  });

  it("says nothing when people take a conversation themselves", async () => {
    const { instance, calls } = service(actorUserId);
    await instance.updateConversation({} as never, workspaceId, conversationId, { version: 1, ownerMembershipId: "66666666-6666-4666-8666-666666666666" } as never);
    expect(calls.some((call) => call.sql.includes("INSERT INTO notifications"))).toBe(false);
  });
});
