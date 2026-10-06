import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InboxSettingsPage } from "./inbox-settings";
afterEach(() => vi.unstubAllGlobals());

const WORKSPACE = "d004d45c-7140-4b0c-a68d-e87d012c2390", TEMPLATE = "30000000-0000-4000-8000-000000000001";

function setup(canManage = true) {
  const payloads: Record<string, unknown> = {
    "inbox/settings": { autoAssign: true, queueId: null, signatureEnabled: false, version: 2, canManage, queues: [{ id: "q", name: "Sales", isFallback: true }], whatsapp: { connected: true, number: "+1 555 0100", accountName: null }, seats: 4, businessName: "Palm Studio", workday: { start: "09:00", days: [1, 2, 3, 4, 5] } },
    "inbox/labels": [{ id: "l1", name: "Complaint", color: "viz-5", status: "active", version: 1, openChats: 2 }],
    "inbox/owners": [], "inbox/quick-replies": [],
    "inbox/templates": [
      { id: TEMPLATE, code: "quote_ready", locale: "en_US", body: "Hi {{1}}, quote {{2}} is ready.", positions: [1, 2], usable: true, variables: [], mappingVersion: 0, approved: true, providerStatus: "approved", category: "utility" },
      { id: "t2", code: "wd_enquiry_welcome", locale: "en", body: "Hello {{1}}, thank you.", positions: [1], usable: true, variables: [{ position: 1, source: "contact.first_name" }], mappingVersion: 1, approved: false, providerStatus: "rejected", providerReason: "Template name already exists", category: "utility" },
    ],
    "inbox/client-messages": { connected: true, events: [
      { event: "crm.enquiry.created", enabled: true, templateCode: "wd_enquiry_welcome", version: 0, emailFallback: false, channel: "none", template: { body: "Hello {{1}}, thank you.", providerStatus: "rejected", approved: false } },
      { event: "portal.invoice_issued", enabled: true, templateCode: "quote_ready", version: 2, emailFallback: true, channel: "whatsapp", template: { body: "Hi {{1}}, quote {{2}} is ready.", providerStatus: "approved", approved: true } },
      { event: "crm.enquiry.quiet", enabled: true, templateCode: "wd_enquiry_follow_up", version: 0, emailFallback: false, channel: "whatsapp", template: { body: "Hello {{1}}, we are following up on your enquiry {{2}}.", providerStatus: "approved", approved: true } },
      { event: "project.handover_thanks", enabled: true, templateCode: "wd_handover_review", version: 0, emailFallback: false, channel: "whatsapp", template: { body: "Hello {{1}}, {{2}} is complete.", providerStatus: "approved", approved: true } },
    ], timing: { quietDays: 3, quietSecondDays: null, quoteDays: 3, reviewUrl: null, version: 1 } },
    "inbox/auto-replies": {
      canManage, businessName: "Palm Studio",
      workspace: { connectionId: null, greeting: { enabled: false, text: "Hi {{contact.first_name}}, thanks for contacting {{business.name}}.", silenceDays: 14 },
        away: { enabled: false, text: "We are away and will reply soon.", windowHours: 12 }, hours: { workingDays: null, start: null, end: null, timeZone: null }, version: 0 },
      numbers: [
        { connectionId: "c1", number: "+1 555 0100", accountName: null, isDefault: true, override: null },
        { connectionId: "c2", number: "+1 555 0200", accountName: "Showroom", isDefault: false, override: null },
      ],
      defaults: { workingDays: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", timeZone: "Europe/London" },
    },
    "inbox/email-address": { available: true, address: canManage ? "palm-abcdefghij@in.example" : null, version: canManage ? 1 : 0, canManage },
    "inbox/starter-pack": { languages: ["en", "ar"], defaultLanguages: ["en"], items: [
      { key: "enquiry_welcome", event: "crm.enquiry.created", name: "wd_enquiry_welcome", language: "en", body: "Hello {{1}}…", status: "rejected" },
      { key: "quote_ready", event: "portal.quote_issued", name: "wd_quote_ready", language: "en", body: "Hello {{1}}…", status: null },
      { key: "quote_ready", event: "portal.quote_issued", name: "wd_quote_ready", language: "ar", body: "مرحبًا {{1}}…", status: null },
    ] },
  };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url, "http://localhost").pathname.replace("/api/workspace/crm/data/", "");
    return { ok: true, status: 200, json: async () => init?.method && init.method !== "GET" ? { ok: true } : payloads[path] ?? [] };
  });
  vi.stubGlobal("fetch", fetcher);
  const sent = (suffix: string, method: string) => fetcher.mock.calls.filter(([url, init]) => String(url).includes(suffix) && init?.method === method).map(([, init]) => JSON.parse(String(init?.body)));
  return { sent };
}

describe("Settings → Inbox", () => {
  it("shows the one number every seat replies from and saves assignment and signature with its version", async () => {
    const user = userEvent.setup(), { sent } = setup(); render(<InboxSettingsPage workspaceId={WORKSPACE} />);
    expect(await screen.findByText("Palm Studio · +1 555 0100")).toBeInTheDocument();
    expect(screen.getByText(/All 4 seats reply from this number/)).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Sign replies" }));
    await user.click(within(screen.getByRole("region", { name: "New chats" })).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent("inbox/settings", "PUT")).toEqual([{ version: 2, autoAssign: true, queueId: null, signatureEnabled: true, autoResolveDays: 7 }]));
  });

  it("sets how many quiet days resolve a chat (AU-2)", async () => {
    const user = userEvent.setup(), { sent } = setup(); render(<InboxSettingsPage workspaceId={WORKSPACE} />);
    const field = await screen.findByRole("textbox", { name: "Resolve quiet chats after (days)" });
    expect(field).toHaveValue("7");
    await user.clear(field);
    await user.type(field, "3");
    await user.click(within(screen.getByRole("region", { name: "New chats" })).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent("inbox/settings", "PUT")).toEqual([expect.objectContaining({ autoResolveDays: 3 })]));
  });

  it("turns the greeting on with a preview as the client reads it, and saves it with its version", async () => {
    const user = userEvent.setup(), { sent } = setup(); render(<InboxSettingsPage workspaceId={WORKSPACE} />);
    const section = await screen.findByRole("region", { name: "Auto replies" });
    await user.click(await within(section).findByRole("switch", { name: "Greeting message" }));
    expect(within(section).getByLabelText("Preview")).toHaveTextContent("Hi [Client first name], thanks for contacting Palm Studio.");
    await user.click(within(section).getByRole("switch", { name: "Away message" }));
    expect(within(section).getByText(/09:00–18:00 · Europe\/London/)).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent("inbox/auto-replies", "PUT")).toEqual([{
      version: 0, greetingEnabled: true, greetingText: "Hi {{contact.first_name}}, thanks for contacting {{business.name}}.", greetingSilenceDays: 14,
      awayEnabled: true, awayText: "We are away and will reply soon.", awayWindowHours: 12, workingDays: null, dayStart: null, dayEnd: null, timeZone: null,
    }]));
  });

  it("gives a second WhatsApp number its own auto replies", async () => {
    const user = userEvent.setup(), { sent } = setup(); render(<InboxSettingsPage workspaceId={WORKSPACE} />);
    const section = await screen.findByRole("region", { name: "Auto replies" });
    await user.click(await within(section).findByRole("button", { name: /Number/ }));
    await user.click(await screen.findByRole("option", { name: "+1 555 0200 · Showroom" }));
    await user.click(within(section).getByRole("button", { name: "Customise for this number" }));
    await user.click(within(section).getByRole("switch", { name: "Away message" }));
    await user.click(within(section).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent("inbox/auto-replies", "PUT")).toEqual([expect.objectContaining({ connectionId: "c2", version: 0, awayEnabled: true, greetingEnabled: false })]));
  });

  it("adds a label with a token colour", async () => {
    const user = userEvent.setup(), { sent } = setup(); render(<InboxSettingsPage workspaceId={WORKSPACE} />);
    await user.click(await screen.findByRole("button", { name: "Add label" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: /Name/ }), "Site visit");
    await user.click(within(dialog).getByRole("button", { name: "Colour 3" }));
    await user.click(within(dialog).getByRole("button", { name: "Save label" }));
    await waitFor(() => expect(sent("inbox/labels", "POST")).toEqual([{ name: "Site visit", color: "viz-3" }]));
  });

  it("maps each template variable to a record field", async () => {
    const user = userEvent.setup(), { sent } = setup(); render(<InboxSettingsPage workspaceId={WORKSPACE} />);
    await user.click((await screen.findAllByRole("button", { name: "Map variables" }))[0]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save variables" }));
    // Each variable is required: the save names the ones still to choose.
    expect(await within(dialog).findByText("Check 2 fields")).toBeInTheDocument();
    // The first one to choose takes focus and offers its fields.
    await user.click(await screen.findByRole("option", { name: "Client first name" }));
    await user.click(within(dialog).getByRole("combobox", { name: "{{2}}" }));
    await user.click(await screen.findByRole("option", { name: "Quote number" }));
    expect(within(dialog).getByText("Hi [Client first name], quote [Quote number] is ready.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save variables" }));
    await waitFor(() => expect(sent(`inbox/templates/${TEMPLATE}/variables`, "PUT")).toEqual([{ version: 0, variables: [{ position: 1, source: "contact.first_name" }, { position: 2, source: "quote.number" }] }]));
  });

  it("shows Meta's status and reason, and sends the missing starter templates in the chosen languages", async () => {
    const user = userEvent.setup(), { sent } = setup(); render(<InboxSettingsPage workspaceId={WORKSPACE} />);
    expect(await screen.findByText("Template name already exists")).toBeInTheDocument();
    expect(screen.getAllByText("Rejected").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Add starter templates" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("button", { name: "Send 1 to Meta" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("checkbox", { name: "العربية" }));
    await user.click(within(dialog).getByRole("button", { name: "Send 2 to Meta" }));
    await waitFor(() => expect(sent("inbox/starter-pack", "POST")).toEqual([{ languages: ["en", "ar"] }]));
  });

  it("lists the client messages with how each goes out, and turns one off with its version", async () => {
    const user = userEvent.setup(), { sent } = setup(); render(<InboxSettingsPage workspaceId={WORKSPACE} />);
    const grid = await screen.findByRole("grid", { name: "Client messages" }).catch(() => screen.findByRole("table", { name: "Client messages" }));
    expect(within(grid).getByText("Welcome on a new enquiry")).toBeInTheDocument();
    expect(within(grid).getByText("Template rejected by Meta")).toBeInTheDocument();
    expect(within(grid).getAllByText("WhatsApp")).toHaveLength(3);
    await user.click(within(grid).getByRole("switch", { name: "Invoice issued" }));
    await waitFor(() => expect(sent("inbox/client-messages/portal.invoice_issued", "PUT")).toEqual([{ version: 2, enabled: false }]));
  });

  it("sets when the follow-ups go and the review link the handover thank-you carries", async () => {
    const user = userEvent.setup(), { sent } = setup(); render(<InboxSettingsPage workspaceId={WORKSPACE} />);
    const section = await screen.findByRole("region", { name: "Client messages" });
    expect(await within(section).findByText("Follow-up on a quiet enquiry")).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Review link" }));
    const dialog = await screen.findByRole("dialog", { name: "Follow-up timing" });
    const link = within(dialog).getByRole("textbox", { name: "Review link" });
    await user.type(link, "http://not-secure");
    await user.click(within(dialog).getByRole("button", { name: "Save timing" }));
    expect(await within(dialog).findByText("Use a full https:// link")).toBeInTheDocument();
    await user.clear(link);
    await user.type(link, "https://reviews.example.com/studio");
    await user.click(within(dialog).getByRole("button", { name: "Save timing" }));
    await waitFor(() => expect(sent("inbox/follow-ups", "PUT")).toEqual([{ version: 1, quietDays: 3, quietSecondDays: null, quoteDays: 3, reviewUrl: "https://reviews.example.com/studio" }]));
  });

  it("lets everyone read the settings but only managers change them", async () => {
    setup(false); render(<InboxSettingsPage workspaceId={WORKSPACE} />);
    expect(await screen.findByText("Palm Studio · +1 555 0100")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add label" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Map variables" })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Sign replies" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add quick reply" })).toBeInTheDocument();
  });
});

describe("Settings → Inbox → Email (PLM-025)", () => {
  it("shows the inbound address with copy, the forwarding steps, and makes a new one only after saying the old one stops", async () => {
    const user = userEvent.setup(), { sent } = setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<InboxSettingsPage workspaceId={WORKSPACE} />);
    const section = await screen.findByRole("region", { name: "Email" });
    expect(await within(section).findByText("palm-abcdefghij@in.example")).toBeInTheDocument();
    expect(within(section).getByText("Google Workspace")).toBeInTheDocument();
    expect(within(section).getByText("Microsoft 365")).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("palm-abcdefghij@in.example");
    await user.click(within(section).getByRole("button", { name: "New address" }));
    expect(await screen.findByText("The current address stops working at once.")).toBeInTheDocument();
    expect(sent("inbox/email-address", "POST")).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Make new address" }));
    await waitFor(() => expect(sent("inbox/email-address", "POST")).toEqual([{ version: 1, commandId: expect.any(String) }]));
  });

  it("lets someone who can't manage the inbox see that no address is set up, without a way to make one", async () => {
    setup(false); render(<InboxSettingsPage workspaceId={WORKSPACE} />);
    const section = await screen.findByRole("region", { name: "Email" });
    expect(await within(section).findByText("Not set up")).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "Create address" })).not.toBeInTheDocument();
  });
});

