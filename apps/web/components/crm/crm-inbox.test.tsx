import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { crmScreenFixture } from "@/lib/crm/screens";
import { CrmInbox } from "./crm-inbox";
afterEach(() => vi.unstubAllGlobals());
function setup(overrides = {}) {
  const data = structuredClone(crmScreenFixture("conversations"));
  const record = { ...data.items[0], channel: "whatsapp", partyName: "Everyday contact", leadId: null, unreadCount: 0, status: "open", canSend: true, whatsappConnected: true, lastInboundAt: new Date().toISOString(), version: 3, messages: [{ id: "incoming", direction: "inbound", status: "delivered", bodyText: "Hello there", createdAt: new Date().toISOString() }, { id: "note", direction: "internal", bodyText: "Old internal note", createdAt: new Date().toISOString() }], ...overrides };
  data.items = [record, { ...record, id: "email-chat", channel: "email", partyName: "Email person" }];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, status: 200, json: async () => url.includes(`/conversations/${record.id}?`) ? record : init?.method === "POST" ? { id: "sent-message" } : { data: [record], nextCursor: null } }));
  vi.stubGlobal("fetch", fetcher); return { data, record, fetcher };
}
describe("WhatsApp inbox", () => {
  it("shows ordinary contacts, excludes other channels and removes notes and templates", async () => {
    const { data, record, fetcher } = setup();render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    expect(await screen.findByText("Hello there")).toBeInTheDocument();
    expect(screen.queryByText("Old internal note")).not.toBeInTheDocument();expect(screen.queryByText("Email person")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /template|Private team note|All channels/i })).not.toBeInTheDocument();
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes("channel=whatsapp"))).toBe(true));
  });
  it("sends one reply with a retry identity, then clears the draft", async () => {
    const user = userEvent.setup(), { data, record, fetcher } = setup();render(<CrmInbox initialData={data} initialRecordId={record.id} />);
    const input = await screen.findByRole("textbox", { name: "Message" });await user.type(input, "Hello!");await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Message queued")).toBeInTheDocument();expect(input).toHaveValue("");
    const calls = fetcher.mock.calls.filter(([url, init]) => url.includes("/messages?") && init?.method === "POST");expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ direction: "outbound", purpose: "service", bodyText: "Hello!", clientMessageId: expect.any(String) });
  });
  it("retains a failed draft and uses the same identity on retry", async () => {
    const user = userEvent.setup(), { data, record } = setup();const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { if (init?.method === "POST" && url.includes("/messages?")) { bodies.push(String(init.body)); return { ok: false, status: 503, json: async () => ({ message: "Temporarily unavailable" }) }; }return { ok: true, json: async () => url.includes(`/conversations/${record.id}?`) ? record : { data: [record], nextCursor: null } }; }));
    render(<CrmInbox initialData={data} initialRecordId={record.id} />);const input = await screen.findByRole("textbox", { name: "Message" });await user.type(input, "Keep this draft");await user.click(screen.getByRole("button", { name: "Send message" }));expect(await screen.findByRole("alert")).toHaveTextContent("Temporarily unavailable");expect(input).toHaveValue("Keep this draft");await user.click(screen.getByRole("button", { name: "Send message" }));await waitFor(() => expect(bodies).toHaveLength(2));expect(bodies[0]).toBe(bodies[1]);
  });
  it.each([{ lastInboundAt: null }, { lastInboundAt: new Date(Date.now() - 86400001).toISOString() }, { whatsappConnected: false }, { canSend: false }, { status: "closed" }])("blocks replies when the chat is not eligible: %j", async (overrides) => {
    const user = userEvent.setup(), { data, record, fetcher } = setup(overrides);render(<CrmInbox initialData={data} initialRecordId={record.id} />);const input = await screen.findByRole("textbox", { name: "Message" });if (!input.hasAttribute("readonly")) await user.type(input, "Draft");expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();expect(fetcher.mock.calls.some(([url]) => url.includes("/messages?"))).toBe(false);
  });
  it("resolves using the current conversation version", async () => {
    const user = userEvent.setup(), { data, record, fetcher } = setup();render(<CrmInbox initialData={data} initialRecordId={record.id} />);await user.click(await screen.findByRole("button", { name: "Resolve" }));await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));expect(JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "PATCH")?.[1]?.body))).toEqual({ version: 3, status: "closed" });
  });
});
