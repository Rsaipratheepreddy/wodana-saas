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
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent("inbox/settings", "PUT")).toEqual([{ version: 2, autoAssign: true, queueId: null, signatureEnabled: true }]));
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
    expect(await within(dialog).findByText("Choose a field for {{1}}.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /\{\{1\}\}/ }));
    await user.click(await screen.findByRole("option", { name: "Client first name" }));
    await user.click(within(dialog).getByRole("button", { name: /\{\{2\}\}/ }));
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

  it("lets everyone read the settings but only managers change them", async () => {
    setup(false); render(<InboxSettingsPage workspaceId={WORKSPACE} />);
    expect(await screen.findByText("Palm Studio · +1 555 0100")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add label" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Map variables" })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Sign replies" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add quick reply" })).toBeInTheDocument();
  });
});
