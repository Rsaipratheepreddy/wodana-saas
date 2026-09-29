import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { crmScreenFixture } from "@/lib/crm/screens";
import { CrmInbox } from "./crm-inbox";
afterEach(() => vi.unstubAllGlobals());

const ME = "10000000-0000-4000-8000-000000000001", ALI = "10000000-0000-4000-8000-000000000002";
const LABEL = "20000000-0000-4000-8000-000000000001", TEMPLATE = "30000000-0000-4000-8000-000000000001";

function setup(overrides: Record<string, unknown> = {}, options: { context?: Record<string, unknown>; payloads?: Record<string, unknown> } = {}) {
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
    "inbox/stages": { enquiry: [{ id: "lead:connected", status: "connected" }], opportunity: [{ id: "opportunity:s1", name: "Site visit", pipeline: "Sales" }], project: [{ id: "project:joinery", name: "Joinery" }] },
    "inbox/labels": [{ id: LABEL, name: "Quote request", color: "viz-2", status: "active", version: 1 }],
    "inbox/owners": [{ id: ME, displayName: "Sara Khan", openChats: 3, away: false, isMe: true }, { id: ALI, displayName: "Ali Noor", openChats: 2, away: false, isMe: false }],
    "inbox/quick-replies": [{ id: "q1", shortcut: "address", body: "Hi {{contact.first_name}}, our studio is on Beach Road.", status: "active", version: 1, scope: "workspace", canEdit: true }],
    "inbox/settings": { autoAssign: true, queueId: null, signatureEnabled: false, version: 1, canManage: true, queues: [], whatsapp: { connected: true, number: "+1 555 0100", accountName: null }, seats: 4, businessName: "Palm Studio", workday: { start: "09:00", days: [1, 2, 3, 4, 5] } },
    "inbox/templates": [{ id: TEMPLATE, code: "quote_ready", locale: "en_US", body: "Hi {{1}}, your enquiry {{2}} is ready.", positions: [1, 2], usable: true, variables: [{ position: 1, source: "contact.first_name" }, { position: 2, source: "enquiry.reference" }], mappingVersion: 1 }],
    ...options.payloads,
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
  it("says what to do when no template can be sent, and shows the ones Meta hasn't approved with their state", async () => {
    const user = userEvent.setup(), { data, record } = setup({}, { payloads: { "inbox/templates": [
      { id: "t-pending", code: "site_visit_booked", locale: "en", body: "Hi {{1}}", positions: [1], usable: true, variables: [], mappingVersion: 0, approved: false, providerStatus: "pending" },
      { id: "t-rejected", code: "promo_offer", locale: "en", body: "Sale", positions: [], usable: true, variables: [], mappingVersion: 0, approved: false, providerStatus: "rejected", providerReason: "Promotional content in a utility template" },
    ] } });
    render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    await user.click(await screen.findByRole("button", { name: "Templates" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("No approved templates yet")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "New template" })).toHaveAttribute("href", "/workspace/settings/inbox#inbox-templates");
    expect(within(dialog).getByRole("option", { name: /site_visit_booked.*Waiting for Meta approval/ })).toBeDisabled();
    expect(within(dialog).getByRole("option", { name: /promo_offer.*Rejected/ })).toHaveTextContent("Promotional content in a utility template");
    expect(within(dialog).getByRole("button", { name: "Send template" })).toBeDisabled();
  });
  it("offers to connect WhatsApp when no number is connected", async () => {
    const { data, record } = setup({ whatsappConnected: false }, { payloads: { "inbox/templates": [] } });
    render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    expect(await screen.findByText(/Connect WhatsApp in Connections to reply/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect WhatsApp" })).toHaveAttribute("href", "/workspace/integrations");
    expect(screen.getByRole("button", { name: "Templates" })).toBeDisabled();
  });
  it("offers a new quick reply when the team has none, and marks an auto reply in the thread", async () => {
    const user = userEvent.setup(), { data, record } = setup({ messages: [
      { id: "incoming", direction: "inbound", status: "delivered", bodyText: "Hello there", createdAt: new Date().toISOString() },
      { id: "greeting", direction: "outbound", status: "sent", authorship: "automation", senderType: "system", bodyText: "Hi Noura, thanks for contacting Palm Studio.", metadata: { automatic: "auto_reply", autoReply: "greeting" }, createdAt: new Date().toISOString() },
    ] }, { payloads: { "inbox/quick-replies": [] } });
    render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    expect((await screen.findByText("Hi Noura, thanks for contacting Palm Studio.")).closest("article")).toHaveTextContent(/Automatic.*Auto reply/);
    await user.type(await screen.findByRole("textbox", { name: "Message" }), "/");
    expect(await screen.findByText("No quick replies yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New quick reply" })).toHaveAttribute("href", "/workspace/settings/inbox#new-quick-reply");
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
  it("treats an @Woddy line as an instruction: never sent, answered privately in the thread, a drafted reply put in the reply box", async () => {
    const user = userEvent.setup(), { data, record, fetcher, posted } = setup();
    const href = `/workspace/crm/conversations?record=${record.id}`;
    const answer = { runId: "r-1", answer: "Their quote is with them [S1].", sources: [{ key: "S1", type: "conversation", id: record.id, label: "Everyday contact · whatsapp", href }], cited: ["S1"],
      proposals: [], draft: { text: "Hi Noura, your quote is ready to review.", conversationId: record.id }, stopped: null };
    const base = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => url === "/api/workspace/woddy" ? { ok: true, status: 200, json: async () => answer } : base(url, init));
    render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    const input = await screen.findByRole("textbox", { name: "Message" });
    await user.type(input, "@Woddy draft the quote reply");
    expect(screen.getByText("Only Woddy reads this line. It is never sent.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ask Woddy" }));
    const reply = await screen.findByRole("article", { name: "Woddy's private reply" });
    expect(reply).toHaveTextContent("Their quote is with them");
    expect(within(reply).getAllByRole("link", { name: "Everyday contact · whatsapp" })[0]).toHaveAttribute("href", href);
    expect(within(reply).getByText("Only you see this")).toBeInTheDocument();
    // Nothing reached the client, not even as a note; the draft waits in the reply box for the person to send.
    expect(posted("/messages")).toEqual([]);
    await waitFor(() => expect(input).toHaveValue("Hi Noura, your quote is ready to review."));
    const ask = JSON.parse(String(fetcher.mock.calls.find(([url]) => url === "/api/workspace/woddy")![1]!.body));
    expect(ask).toMatchObject({ message: "draft the quote reply", surface: "inbox", context: { type: "conversation", id: record.id } });
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
  it("filters chats by their record's stage, and the view counts follow", async () => {
    const user = userEvent.setup(), { data, record, fetcher } = setup(); render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    await screen.findByText("Hello there");
    const stage = await screen.findByRole("group", { name: "Stage" });
    await user.click(within(stage).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Project · Joinery" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("conversations?") && String(url).includes("stage=project%3Ajoinery"))).toBe(true));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("inbox/summary?") && String(url).includes("stage=project%3Ajoinery"))).toBe(true));
    expect(within(stage).getByText("Project · Joinery")).toBeInTheDocument();
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

  it("sends a reply later while WhatsApp's window will still be open, and refuses a time after it closes", async () => {
    const user = userEvent.setup(), { data, record, posted } = setup(); render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    const input = await screen.findByRole("textbox", { name: "Message" });
    await user.type(input, "We are on our way");
    await user.click(screen.getByRole("button", { name: "Send later" }));
    const dialog = await screen.findByRole("dialog", { name: "Send later" });
    await user.click(within(dialog).getByRole("button", { name: "Schedule" }));
    await waitFor(() => expect(posted("/scheduled-messages")).toEqual([{ clientRequestId: expect.any(String), sendAt: expect.any(String), bodyText: "We are on our way" }]));
    const [scheduled] = posted("/scheduled-messages");
    expect(Date.parse(scheduled.sendAt) - Date.now()).toBeGreaterThan(50 * 60_000);
    expect(await screen.findByText("Scheduled")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("refuses to schedule free text after the window closes", async () => {
    const user = userEvent.setup(), { data, record, posted } = setup({ windowClosesAt: new Date(Date.now() + 30 * 60_000).toISOString() });
    render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    await user.type(await screen.findByRole("textbox", { name: "Message" }), "Tomorrow then");
    await user.click(screen.getByRole("button", { name: "Send later" }));
    const dialog = await screen.findByRole("dialog", { name: "Send later" });
    await user.click(within(dialog).getByRole("button", { name: "Schedule" }));
    expect(await within(dialog).findByText(/24-hour window will be closed by then/)).toBeInTheDocument();
    expect(posted("/scheduled-messages")).toEqual([]);
  });

  it("shows what is scheduled in the thread, and cancels it with its version", async () => {
    const sendAt = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const user = userEvent.setup(), { data, record, posted } = setup({ scheduledMessages: [
      { id: "s1", status: "scheduled", sendAt, bodyText: "See you at 5", templateId: null, templateCode: null, templateParameters: [], renderedText: "See you at 5\n— Sara", failureReason: null, createdByName: "Sara Khan", version: 2 },
      { id: "s2", status: "failed", sendAt, bodyText: "Too late", templateId: null, templateCode: null, templateParameters: [], renderedText: "Too late", failureReason: "Reopen this conversation before replying", createdByName: "Sara Khan", version: 3 },
    ] });
    render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    const section = await screen.findByRole("region", { name: "Scheduled messages" });
    expect(within(section).getByText(/^Scheduled for /)).toBeInTheDocument();
    expect(within(section).getByText("Not sent")).toBeInTheDocument();
    expect(within(section).getByText("Reopen this conversation before replying")).toBeInTheDocument();
    await user.click(within(section).getAllByRole("button", { name: "Cancel" })[0]);
    await user.click(await screen.findByRole("button", { name: "Cancel message" }));
    await waitFor(() => expect(posted("/scheduled-messages/s1/cancel")).toEqual([{ version: 2 }]));
  });

  it("shows one WhatsApp number's chats when the firm has two or more, and which number each chat is with", async () => {
    const A = "40000000-0000-4000-8000-000000000001", B = "40000000-0000-4000-8000-000000000002";
    const user = userEvent.setup(), { data, record, fetcher } = setup({ connectionId: B }, { payloads: { "inbox/summary": { mine: 1, unassigned: 4, team: 6, all: 9, snoozed: 2, unreadForMe: 1, membershipId: ME,
      numbers: [{ connectionId: A, number: "+1 555 0100", accountName: null, isDefault: true }, { connectionId: B, number: "+1 555 0200", accountName: "Showroom", isDefault: false }] } } });
    render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    expect((await screen.findAllByText("+1 555 0200 · Showroom")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /Number/ }));
    await user.click(await screen.findByRole("option", { name: "+1 555 0200 · Showroom" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("conversations?") && String(url).includes(`connectionId=${B}`))).toBe(true));
  });

  it("shows a client's photo, a voice note with a player and a document from storage; one still coming or lost says so", async () => {
    const now = new Date().toISOString();
    const file = (id: string, kind: string, status: string, extra: Record<string, unknown> = {}) => ({ id, kind, mimeType: null, fileName: null, byteSize: 2048, status, failureCode: null, ...extra });
    const { data, record } = setup({ messages: [
      { id: "photo", direction: "inbound", status: "delivered", bodyText: "Image received", metadata: { messageType: "image" }, attachment: file("f-photo", "image", "stored"), createdAt: now },
      { id: "voice", direction: "inbound", status: "delivered", bodyText: "Audio received", metadata: { messageType: "audio" }, attachment: file("f-voice", "audio", "stored", { fileName: "voice.ogg" }), createdAt: now },
      { id: "plan", direction: "outbound", status: "delivered", bodyText: "The plan", metadata: { messageType: "document" }, attachment: file("f-plan", "document", "stored", { fileName: "Plan.pdf" }), createdAt: now },
      { id: "coming", direction: "inbound", status: "delivered", bodyText: "Video received", metadata: { messageType: "video" }, attachment: file("f-video", "video", "pending"), createdAt: now },
      { id: "lost", direction: "inbound", status: "delivered", bodyText: "Document received", metadata: { messageType: "document" }, attachment: file("f-lost", "document", "failed", { failureCode: "media_expired" }), createdAt: now },
    ] });
    render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    const photo = await screen.findByRole("link", { name: /Open image/ });
    expect(photo).toHaveAttribute("href", expect.stringContaining(`/api/workspace/crm/attachments/${record.id}/f-photo?workspaceId=`));
    expect(screen.queryByText("Image received")).not.toBeInTheDocument();
    expect(screen.getByLabelText("voice.ogg").tagName).toBe("AUDIO");
    expect(screen.getByRole("link", { name: /Plan\.pdf/ })).toHaveAttribute("download", "Plan.pdf");
    expect(screen.getByText("The plan")).toBeInTheDocument();
    expect(screen.getByText("Getting the file…")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp no longer has this file.")).toBeInTheDocument();
  });

  it("attaches one file WhatsApp takes, uploads it first and sends it with the caption", async () => {
    const user = userEvent.setup(), { data, record, fetcher, posted } = setup();
    const base = fetcher.getMockImplementation()!;
    const uploads: string[] = [];
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/workspace/crm/attachments/")) { uploads.push(String(url)); return { ok: true, status: 200, json: async () => ({ id: String(url).split("/")[6].split("?")[0], kind: "document", status: "stored" }) }; }
      return base(url, init);
    });
    render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    await screen.findByRole("textbox", { name: "Message" });
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(picker, { target: { files: [new File(["MZ"], "setup.exe", { type: "application/octet-stream" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("WhatsApp can't send this type of file");
    fireEvent.change(picker, { target: { files: [new File([new Uint8Array(6 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Photos can be up to 5 MB on WhatsApp.");
    fireEvent.change(picker, { target: { files: [new File(["%PDF-1.7"], "Plan.pdf", { type: "application/pdf" })] } });
    expect(screen.getByText("Plan.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attach a file" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Our plan");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Message queued")).toBeInTheDocument();
    expect(uploads).toEqual([expect.stringContaining(`/api/workspace/crm/attachments/${record.id}/`)]);
    const [sent] = posted("/messages");
    expect(sent).toEqual({ direction: "outbound", purpose: "service", bodyText: "Our plan", attachmentId: uploads[0].split("/")[6].split("?")[0], clientMessageId: expect.any(String) });
    expect(screen.queryByText("Plan.pdf")).not.toBeInTheDocument();
  });
});
