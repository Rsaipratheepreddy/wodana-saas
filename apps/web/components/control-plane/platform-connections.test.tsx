import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider, ToastProvider } from "@/design-system";
import type { PlatformConnection } from "@/lib/internal/platform-connections";
import { PlatformConnectionsPage } from "./platform-connections-page";

const BASE = "https://api.example.test";
const connection = (overrides: Partial<PlatformConnection> & Pick<PlatformConnection, "provider">): PlatformConnection => ({
  status: "not_set", values: {}, secrets: {}, required: [], test: null, urls: [], version: 1, updatedAt: "2026-09-29T08:00:00Z", ...overrides,
});
const providers = (overrides: Partial<Record<PlatformConnection["provider"], Partial<PlatformConnection>>> = {}): PlatformConnection[] => [
  connection({ provider: "platform", status: "set", values: { publicApiBase: BASE }, required: ["publicApiBase"], ...overrides.platform }),
  connection({
    provider: "meta", status: "set", version: 4,
    values: { clientId: "1234567890", configId: null, graphVersion: "v23.0" },
    secrets: { clientSecret: { set: true, last4: "wxyz" }, webhookSecret: { set: false, last4: null } },
    required: ["clientId", "clientSecret", "configId", "webhookSecret"],
    urls: [{ id: "webhook", url: `${BASE}/api/v1/integrations/providers/webhooks/whatsapp` }],
    ...overrides.meta,
  }),
  connection({
    provider: "intuit", values: { clientId: null, environment: "sandbox" }, secrets: { clientSecret: { set: false, last4: null }, webhookSecret: { set: false, last4: null } },
    urls: [{ id: "callback", url: `${BASE}/api/v1/integrations/providers/quickbooks/oauth/callback` }, { id: "webhook", url: `${BASE}/api/v1/integrations/providers/webhooks/quickbooks` }],
    ...overrides.intuit,
  }),
  connection({ provider: "zoho", values: { clientId: null, dataCenter: null }, secrets: { clientSecret: { set: false, last4: null } },
    urls: [{ id: "callback", url: `${BASE}/api/v1/integrations/providers/zoho_books/oauth/callback` }], ...overrides.zoho }),
  connection({ provider: "google", values: { clientId: null }, secrets: { clientSecret: { set: false, last4: null } },
    urls: [{ id: "callback", url: `${BASE}/api/v1/integrations/google/oauth/callback` }], ...overrides.google }),
];

type Call = { url: string; init?: RequestInit; body?: Record<string, unknown> };
function mount(respond: (url: string, init?: RequestInit) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    return Response.json(respond(url, init) ?? {});
  }));
  return calls;
}
const renderPage = () => render(<DesignSystemProvider locale="en-US" timeZone="UTC"><ToastProvider><PlatformConnectionsPage /></ToastProvider></DesignSystemProvider>);

afterEach(() => { vi.unstubAllGlobals(); });

describe("Wodana Control → Platform connections", () => {
  it("shows each provider's status, secrets only as set · last 4, and the URLs to register with copy buttons", async () => {
    mount(() => ({ providers: providers() }));
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPage();
    const meta = await screen.findByRole("article", { name: "Meta" });
    expect(within(meta).getByText("Set")).toBeInTheDocument();
    expect(within(meta).getByText("Set · ••••wxyz")).toBeInTheDocument();
    expect(within(meta).getByText("1234567890")).toBeInTheDocument();
    expect(screen.getByText(BASE)).toBeInTheDocument();
    for (const name of ["Meta", "Intuit", "Zoho", "Google"]) expect(screen.getByRole("article", { name })).toBeInTheDocument();
    const intuit = screen.getByRole("article", { name: "Intuit" });
    expect(within(intuit).getByText(`${BASE}/api/v1/integrations/providers/quickbooks/oauth/callback`)).toBeInTheDocument();
    await userEvent.click(within(intuit).getByRole("button", { name: "Copy Callback URL" }));
    expect(writeText).toHaveBeenCalledWith(`${BASE}/api/v1/integrations/providers/quickbooks/oauth/callback`);
  });

  it("saves with the version it saw and one request key, sending a secret only when one is typed", async () => {
    const saved = providers({ meta: { values: { clientId: "1234567890", configId: "998877665544", graphVersion: "v23.0" }, version: 5 } });
    const calls = mount((_url, init) => ({ providers: init?.method === "PUT" ? saved : providers() }));
    renderPage();
    await userEvent.click(within(await screen.findByRole("article", { name: "Meta" })).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Meta" });
    const secret = within(dialog).getByLabelText(/App secret/);
    expect(secret).toHaveValue("");
    expect(secret).toHaveAttribute("type", "password");
    expect(within(dialog).getByText("Saved · ends in wxyz. Leave blank to keep it.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Embedded Signup configuration ID/ }), "998877665544");
    await userEvent.type(within(dialog).getByLabelText(/Webhook verify token/), "fake-verify-token-for-tests");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const put = calls.find((call) => call.init?.method === "PUT")!;
    expect(put.url).toBe("/api/internal/platform-integrations/meta");
    expect(put.body).toEqual({ expectedVersion: 4, clientId: "1234567890", configId: "998877665544", graphVersion: "v23.0",
      webhookSecret: "fake-verify-token-for-tests" });
    expect(new Headers(put.init?.headers).get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await within(screen.getByRole("article", { name: "Meta" })).findByText("998877665544")).toBeInTheDocument();
  });

  it("runs a Test and shows why it failed", async () => {
    const failed = providers({ zoho: { status: "test_failed", test: { reason: "rejected", testedAt: "2026-09-29T09:00:00Z" } } });
    const calls = mount((url, init) => init?.method === "POST"
      ? { providers: failed, result: { provider: "zoho", ok: false, reason: "rejected" } }
      : { providers: providers() });
    renderPage();
    const zoho = await screen.findByRole("article", { name: "Zoho" });
    await userEvent.click(within(zoho).getByRole("button", { name: "Test" }));
    expect(await within(zoho).findByText("Test failed")).toBeInTheDocument();
    expect(within(zoho).getAllByText("The provider rejected the client ID or secret.").length).toBeGreaterThan(0);
    expect(calls.find((call) => call.init?.method === "POST")!.url).toBe("/api/internal/platform-integrations/zoho/test");
  });

  it("asks for the public address before showing URLs", async () => {
    mount(() => ({ providers: providers({ platform: { status: "not_set", values: { publicApiBase: null } }, google: { urls: [] } }) }));
    renderPage();
    const google = await screen.findByRole("article", { name: "Google" });
    expect(within(google).getByText("Set the public API address to see the URLs to register.")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Public API address" })).getByText("Not set")).toBeInTheDocument();
  });

  it("offers Retry when the list doesn't load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "Operator permission required" }, { status: 403 })));
    renderPage();
    expect(await screen.findByText("Operator permission required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry|Try again/ })).toBeInTheDocument();
  });
});
