import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { AiCreditsList, AiModelRates, CreditOverview } from "@/lib/internal/console";
import { AiCreditsPage } from "./ai-credits-page";
import { AiCreditsTab } from "./ai-credits-tab";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const search = vi.hoisted(() => ({ value: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => search.value, usePathname: () => "/internal/ai-credits" }));

type Call = { url: string; init?: RequestInit; body?: Record<string, unknown> };
function mount(respond: (url: string, init?: RequestInit) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    return Response.json(respond(url, init) ?? {});
  }));
  return calls;
}
const overview = (overrides: Partial<CreditOverview> = {}): CreditOverview => ({
  workspaceId: "11111111-1111-4111-8111-111111111111", balance: "150.0000", state: "low", threshold: "200.0000", customThreshold: null, version: 7,
  lastTopUp: { credits: "1000.0000", at: "2026-09-01T08:00:00Z" }, usedThisMonth: "850.0000", usedToday: "40.0000", dailyLimit: "1000.0000",
  byFeature: [], ledger: [{ id: "e1", entryType: "top_up", credits: "1000.0000", balanceAfter: "1000.0000", model: null, feature: null, inputTokens: null, outputTokens: null,
    reference: "INV-2026-014", note: null, createdBy: "op", createdByName: "Omar Operator", createdAt: "2026-09-01T08:00:00Z" }],
  ...overrides,
});
const renderIn = (node: React.ReactNode) => render(<DesignSystemProvider locale="en-US" timeZone="UTC">{node}</DesignSystemProvider>);

afterEach(() => { vi.unstubAllGlobals(); router.push.mockReset(); router.replace.mockReset(); search.value = new URLSearchParams(); });

describe("an organization's AI credits in Wodana Control", () => {
  it("records a top-up with its reference and one request key, and shows the new ledger", async () => {
    const calls = mount((url, init) => init?.method === "POST"
      ? overview({ balance: "5150.0000", state: "ok", ledger: [{ ...overview().ledger[0], id: "e2", credits: "5000.0000", balanceAfter: "5150.0000", reference: "INV-2026-031" }, ...overview().ledger] })
      : overview());
    renderIn(<AiCreditsTab orgKey="tenant_acme" canManage />);
    expect(await screen.findByText("Running low")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Top up" }));
    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Credits/ }), "5000");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Invoice or payment reference/ }), "INV-2026-031");
    await userEvent.click(save);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const post = calls.find((call) => call.init?.method === "POST")!;
    expect(post.url).toBe("/api/internal/organizations/tenant_acme/ai-credits/top-ups");
    expect(post.body).toEqual({ credits: "5000", reference: "INV-2026-031" });
    expect(new Headers(post.init?.headers).get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText(/INV-2026-031/)).toBeInTheDocument();
  });

  it("sets the alert line with the version it saw", async () => {
    const calls = mount((_url, init) => init?.method === "PATCH" ? overview({ customThreshold: "300.0000", threshold: "300.0000", version: 8 }) : overview());
    renderIn(<AiCreditsTab orgKey="tenant_acme" canManage />);
    await userEvent.click(await screen.findByRole("button", { name: "Set alert" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Fixed credits" }));
    const input = within(dialog).getByRole("textbox", { name: /Credits/ });
    await userEvent.clear(input);
    await userEvent.type(input, "300");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((call) => call.init?.method === "PATCH")).toBe(true));
    expect(calls.find((call) => call.init?.method === "PATCH")!.body).toEqual({ expectedVersion: 7, threshold: "300" });
  });

  it("offers no changes without the billing permission", async () => {
    mount(() => overview());
    renderIn(<AiCreditsTab orgKey="tenant_acme" canManage={false} />);
    expect(await screen.findByText("Omar Operator")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Top up" })).not.toBeInTheDocument();
  });
});

describe("AI credits across organizations", () => {
  const list: AiCreditsList = {
    organizations: [
      { workspaceId: "w1", accountId: "a1", key: "tenant_palm", name: "Palm Living", slug: "palm", aiEnabled: true, hasAccount: true, balance: "-0.2000", state: "exhausted",
        usedThisMonth: "1000.2000", usedToday: "10.0000", lastTopUp: { credits: "1000.0000", at: "2026-09-01T08:00:00Z" } },
      { workspaceId: "w2", accountId: "a2", key: "w2", name: "Birch Studio", slug: "birch", aiEnabled: false, hasAccount: false, balance: "1000.0000", state: "ok",
        usedThisMonth: "0.0000", usedToday: "0.0000", lastTopUp: null },
    ],
    platform: { usedToday: "5000.1000", dailyLimit: "5000.0000", reached: true, workspaceDailyLimit: "1000.0000", welcomeCredits: "1000.0000", provider: "bedrock", model: "apac.amazon.nova-lite-v1:0" },
  };
  const rates: AiModelRates = { inUse: { provider: "bedrock", model: "apac.amazon.nova-lite-v1:0" }, rates: [
    { model: "apac.amazon.nova-lite-v1:0", provider: "bedrock", label: "Amazon Nova Lite", listInput: "0.0600", listOutput: "0.2400", margin: "1.500",
      inputPerMillion: "90.0000", outputPerMillion: "360.0000", priceConfirmed: true, active: true, version: 1, updatedAt: "2026-09-29T00:00:00Z" },
    { model: "openai.gpt-oss-120b-1:0", provider: "bedrock", label: "gpt-oss-120b", listInput: "0.1800", listOutput: "0.7000", margin: "1.500",
      inputPerMillion: "270.0000", outputPerMillion: "1050.0000", priceConfirmed: false, active: true, version: 1, updatedAt: "2026-09-29T00:00:00Z" },
  ] };

  it("lists each organization's balance and use, and says when today's platform cap paused AI", async () => {
    mount(() => list);
    renderIn(<AiCreditsPage canManage />);
    expect(await screen.findByText("AI is paused for today")).toBeInTheDocument();
    expect(screen.getByText("5,000.1 of 5,000 credits used across organizations today.")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "AI credits by organization" });
    expect(within(table).getByRole("link", { name: "Palm Living" })).toHaveAttribute("href", "/internal/accounts/a1?tab=ai-credits&org=tenant_palm");
    expect(within(table).getByText("Used up")).toBeInTheDocument();
    expect(within(table).getByText("1,000 on first use")).toBeInTheDocument();
  });

  it("edits a model's list price and margin, version-checked", async () => {
    search.value = new URLSearchParams("tab=rates");
    const calls = mount((url, init) => url.includes("/rates/") ? { ...rates.rates[1], listInput: "0.1500", priceConfirmed: true, version: 2 } : url.endsWith("/rates") ? rates : list);
    renderIn(<AiCreditsPage canManage />);
    const table = await screen.findByRole("table", { name: "Model rates" });
    expect(await within(table).findByText("Price to confirm")).toBeInTheDocument();
    expect(within(table).getByText("In use")).toBeInTheDocument();
    await userEvent.click(within(table).getByText("gpt-oss-120b"));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByRole("textbox", { name: /Input price/ });
    await userEvent.clear(input);
    await userEvent.type(input, "0.15");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Price confirmed" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((call) => call.init?.method === "PATCH")).toBe(true));
    const patch = calls.find((call) => call.init?.method === "PATCH")!;
    expect(patch.url).toBe(`/api/internal/ai-credits/rates/${encodeURIComponent("openai.gpt-oss-120b-1:0")}`);
    expect(patch.body).toEqual({ expectedVersion: 1, listInput: "0.15", listOutput: "0.7000", margin: "1.500", priceConfirmed: true, active: true });
  });
});
