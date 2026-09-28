import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { crmScreenFixture } from "@/lib/crm/screens";
import { CrmInbox } from "./crm-inbox";
afterEach(() => vi.unstubAllGlobals());

const ME = "10000000-0000-4000-8000-000000000001", ALI = "10000000-0000-4000-8000-000000000002";
const LABEL = "20000000-0000-4000-8000-000000000001", TEMPLATE = "30000000-0000-4000-8000-000000000001";

function setup(overrides: Record<string, unknown> = {}, options: { context?: Record<string, unknown> } = {}) {
  const data = structuredClone(crmScreenFixture("conversations"));
  const now = new Date().toISOString();
  const record = {
    ...data.items[0], channel: "whatsapp", partyName: "Everyday contact", leadId: null, unreadCount: 0, status: "open", canSend: true, whatsappConnected: true,
    lastInboundAt: now, windowClosesAt: new Date(Date.now() + 5 * 3_600_000).toISOString(), waitingSince: now, version: 3, ownerMembershipId: ME, ownerName: "Sara Khan",
    replyingAs: { businessName: "Palm Studio", number: "+1 555 0100" }, labels: [{ id: LABEL, name: "Quote request", color: "viz-2" }],
    events: [{ id: "event", kind: "assigned", method: "relationship", reason: null, snoozedUntil: null, createdAt: now, actorName: null, ownerName: "Sara Khan", labelName: null, labelColor: null }],
    messages: [{ id: "incoming", direction: "inbound", status: "delivered", bodyText: "Hello there", createdAt: now }, { id: "note", direction: "internal", senderName: "Ali Noor", bodyText: "Call her after 5", createdAt: now },
      { id: "auto", direction: "outbound", status: "read", authorship: "automation", senderType: "system", bodyText: "Thank you for contacting us.", metadata: { automatic: "crm.enquiry.created" }, createdAt: now }],
    ...overrides,
  };
  const other = { ...record, id: "email-chat", channel: "email", partyName: "Email person", labels: [], waitingSince: null };
  const context = { conversationId: record.id, leadId: null, party: null, enquiries: [], opportunities: [], projects: [], variables: { "contact.first_name": "Noura", "enquiry.reference": "E-1042" }, ...options.context };
  const payloads: Record<string, unknown> = {
    "inbox/summary": { mine: 1, unassigned: 4, team: 6, all: 9, snoozed: 2, unreadForMe: 1, membershipId: ME },
    "inbox/labels": [{ id: LABEL, name: "Quote request", color: "viz-2", status: "active", version: 1 }],
    "inbox/owners": [{ id: ME, displayName: "Sara Khan", openChats: 3, away: false, isMe: true }, { id: ALI, displayName: "Ali Noor", openChats: 2, away: false, isMe: false }],
    "inbox/quick-replies": [{ id: "q1", shortcut: "address", body: "Hi {{contact.first_name}}, our studio is on Beach Road.", status: "active", version: 1, scope: "workspace", canEdit: true }],
    "inbox/settings": { autoAssign: true, queueId: null, signatureEnabled: false, version: 1, canManage: true, queues: [], whatsapp: { connected: true, number: "+1 555 0100", accountName: null }, seats: 4, businessName: "Palm Studio", workday: { start: "09:00", days: [1, 2, 3, 4, 5] } },
    "inbox/templates": [{ id: TEMPLATE, code: "quote_ready", locale: "en_US", body: "Hi {{1}}, your enquiry {{2}} is ready.", positions: [1, 2], usable: true, variables: [{ position: 1, source: "contact.first_name" }, { position: 2, source: "enquiry.reference" }], mappingVersion: 1 }],
  };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url, "http://localhost").pathname.replace("/api/workspace/crm/data/", "");
    const json = init?.method === "POST" || init?.method === "PUT" ? (path.endsWith("/messages") ? { id: "sent-message" } : { ok: true })
      : init?.method === "PATCH" ? record
      : path === `conversations/${record.id}` ? record : path === "conversations/email-chat" ? other : path.endsWith("/context") ? context : path in payloads ? payloads[path] : { data: [record, other], nextCursor: null };
    return { ok: true, status: 200, json: async () => json };
  });
  vi.stubGlobal("fetch", fetcher);
  const posted = (suffix: string, method = "POST") => fetcher.mock.calls.filter(([url, init]) => String(url).includes(suffix) && init?.method === method).map(([, init]) => JSON.parse(String(init?.body)));
  return { data, record, fetcher, posted };
}

describe("CRM inbox", () => {
  it("shows the views with counts, the wait, labels, the chat's history and team notes", async () => {
    const { data, record, fetcher } = setup(); render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    expect(await screen.findByText("Hello there")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Mine\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unassigned\s*4/ })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Team note" })).toHaveTextContent("Call her after 5");
    expect(screen.getByText("Thank you for contacting us.").closest("article")).toHaveTextContent(/Automatic.*Welcome on a new enquiry/);
    expect(screen.getByLabelText("Read")).toBeInTheDocument();
    expect(screen.getByText("Assigned to Sara Khan automatically")).toBeInTheDocument();
    expect(screen.getByText("Replying as Palm Studio · +1 555 0100")).toBeInTheDocument();
    expect(screen.getAllByText("Waiting 0 m").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Quote request").length).toBeGreaterThan(0);
    expect(screen.getByText(/Window closes in 4 h/)).toBeInTheDocument();
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("conversations?") && String(url).includes("view=mine") && String(url).includes("status=open"))).toBe(true));
  });
  it("sends one reply with a retry identity, then clears the draft", async () => {
    const user = userEvent.setup(), { data, record, posted } = setup(); render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    const input = await screen.findByRole("textbox", { name: "Message" }); await user.type(input, "Hello!"); await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Message queued")).toBeInTheDocument(); expect(input).toHaveValue("");
    expect(posted("/messages")).toEqual([{ direction: "outbound", purpose: "service", bodyText: "Hello!", clientMessageId: expect.any(String) }]);
  });
  it("retains a failed draft and uses the same identity on retry", async () => {
    const user = userEvent.setup(), { data, record, fetcher } = setup(); const bodies: string[] = [];
    const base = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => { if (init?.method === "POST" && String(url).includes("/messages?")) { bodies.push(String(init.body)); return { ok: false, status: 503, json: async () => ({ message: "Temporarily unavailable" }) }; } return base(url, init); });
    render(<CrmInbox initialData={data} initialRecordId={record.id} />); const input = await screen.findByRole("textbox", { name: "Message" }); await user.type(input, "Keep this draft"); await user.click(screen.getByRole("button", { name: "Send message" })); expect(await screen.findByRole("alert")).toHaveTextContent("Temporarily unavailable"); expect(input).toHaveValue("Keep this draft"); await user.click(screen.getByRole("button", { name: "Send message" })); await waitFor(() => expect(bodies).toHaveLength(2)); expect(bodies[0]).toBe(bodies[1]);
  });
  it.each([{ whatsappConnected: false }, { canSend: false }, { status: "closed" }])("blocks replies when the chat is not eligible: %j", async (overrides) => {
    const user = userEvent.setup(), { data, record, posted } = setup(overrides); render(<CrmInbox initialData={data} initialRecordId={record.id} />); const input = await screen.findByRole("textbox", { name: "Message" }); if (!input.hasAttribute("readonly")) await user.type(input, "Draft"); expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled(); expect(posted("/messages")).toEqual([]);
  });
  it("offers only a template once WhatsApp's 24-hour window has closed, filled from the chat's records", async () => {
    const user = userEvent.setup(), { data, record, posted } = setup({ lastInboundAt: new Date(Date.now() - 86_400_001).toISOString(), windowClosesAt: new Date(Date.now() - 1).toISOString() });
    render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    await user.click(await screen.findByRole("button", { name: "Choose template" }));
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Hi Noura, your enquiry E-1042 is ready.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Send template" }));
    await waitFor(() => expect(posted("/messages")).toEqual([{ direction: "outbound", purpose: "service", templateId: TEMPLATE, clientMessageId: expect.any(String) }]));
  });
  it("names a template value this chat does not have and sends only once it is typed", async () => {
    const user = userEvent.setup(), { data, record, posted } = setup({}, { context: { variables: { "contact.first_name": "Noura" } } });
    render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    await user.click(await screen.findByRole("button", { name: "Templates" }));
    const dialog = await screen.findByRole("dialog");
    const missing = await within(dialog).findByRole("textbox", { name: /\{\{2\}\} · Enquiry reference/ });
    expect(within(dialog).getByRole("button", { name: "Send template" })).toBeDisabled();
    await user.type(missing, "your villa");
    expect(within(dialog).getByText("Hi Noura, your enquiry your villa is ready.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Send template" }));
    await waitFor(() => expect(posted("/messages")).toEqual([{ direction: "outbound", purpose: "service", templateId: TEMPLATE, templateParameters: ["Noura", "your villa"], clientMessageId: expect.any(String) }]));
  });
  it("fills a quick reply after / from the chat's records", async () => {
    const user = userEvent.setup(), { data, record } = setup(); render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    const input = await screen.findByRole("textbox", { name: "Message" });
    await screen.findByRole("button", { name: /Mine\s*1/ });
    await user.type(input, "/addr");
    expect(await screen.findByRole("option", { name: /\/address/ })).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(input).toHaveValue("Hi Noura, our studio is on Beach Road."));
  });
  it("adds an internal note that mentions a teammate and is never sent", async () => {
    const user = userEvent.setup(), { data, record, posted } = setup(); render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    await user.click(await screen.findByRole("radio", { name: "Note" }));
    const input = screen.getByRole("textbox", { name: "Note" });
    await user.type(input, "Please call @Al");
    await user.click(await screen.findByRole("option", { name: "Ali Noor" }));
    await user.type(input, "after 5");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(posted("/messages")).toEqual([{ direction: "internal", bodyText: "Please call @Ali Noor after 5", mentions: [ALI], clientMessageId: expect.any(String) }]));
  });
  it("assigns, snoozes and resolves with the version the person saw", async () => {
    const user = userEvent.setup(), { data, record, posted } = setup(); render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    await screen.findByText("Hello there");
    await user.click(await screen.findByRole("button", { name: /Sara Khan/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Ali Noor/ }));
    await waitFor(() => expect(posted(`conversations/${record.id}?`, "PATCH")).toEqual([{ version: 3, ownerMembershipId: ALI }]));
    await user.click(screen.getByRole("button", { name: "Snooze" }));
    await user.click(await screen.findByRole("menuitem", { name: "Next working morning" }));
    await waitFor(() => expect(posted(`conversations/${record.id}?`, "PATCH")[1]).toEqual({ version: 3, status: "snoozed", snoozedUntil: expect.stringMatching(/T09:00:00\.000Z$/) }));
    // The next chat opens after a snooze; Resolve acts on it.
    expect(await screen.findByRole("heading", { name: "Email person" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(posted("conversations/email-chat?", "PATCH")).toEqual([{ version: 3, status: "closed" }]));
  });
  it("blocks a number and hides a message only after saying what it does", async () => {
    const user = userEvent.setup(), { data, record, posted } = setup({ partyId: "party-1", canManage: true }); render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    await screen.findByText("Hello there");
    await user.click(screen.getByRole("button", { name: "More chat actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Mark as spam" }));
    const confirm = await screen.findByRole("dialog");
    expect(confirm).toHaveTextContent("nobody is told");
    await user.click(within(confirm).getByRole("button", { name: "Mark as spam" }));
    await waitFor(() => expect(posted(`conversations/${record.id}/block`, "PUT")).toEqual([{ blocked: true, spam: true }]));
    await user.click(screen.getAllByRole("button", { name: "Hide message" })[0]);
    const hide = await screen.findByRole("dialog");
    expect(hide).toHaveTextContent("stays on the client's phone");
    await user.click(within(hide).getByRole("button", { name: "Hide message" }));
    await waitFor(() => expect(posted("/hidden", "PUT")).toEqual([{ hidden: true }]));
  });
  it("shows who hid a message, and lets an administrator show it again", async () => {
    const now = new Date().toISOString();
    const user = userEvent.setup(), { data, record, posted } = setup({ canManage: true, messages: [{ id: "gone", direction: "inbound", status: "delivered", bodyText: null, hiddenAt: now, hiddenByName: "Sara Khan", createdAt: now }] });
    render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    expect(await screen.findByText(/Hidden by Sara Khan/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show again" }));
    await waitFor(() => expect(posted("conversations/" + record.id + "/messages/gone/hidden", "PUT")).toEqual([{ hidden: false }]));
  });
  it("resolves several chats at once", async () => {
    const user = userEvent.setup(), { data, record, posted } = setup(); render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    await screen.findByText("Hello there");
    await user.click(screen.getByRole("button", { name: "Select chats" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Everyday contact" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Email person" }));
    const bar = screen.getByRole("toolbar", { name: "Bulk actions" });
    expect(bar).toHaveTextContent("2 selected");
    await user.click(within(bar).getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(posted("inbox/bulk")).toEqual([{ conversationIds: [record.id, "email-chat"], action: "resolve" }]));
  });
  it("starts a conversation only on a channel that can hold one: WhatsApp or email, never the client portal", async () => {
    const user = userEvent.setup(), { data, record } = setup(); render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    await user.click((await screen.findAllByRole("button", { name: "New conversation" }))[0]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Channel/ }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["WhatsApp", "Email"]);
    expect(screen.queryByText(/portal/i)).not.toBeInTheDocument();
  });
});
