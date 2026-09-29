import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { canOpen } from "@/lib/workspace/access";
import { formatCredits, type CreditOverview } from "@/lib/workspace/ai-credits";
import { workspaceModules } from "./workspace-navigation";
import { AiCreditsPage } from "./ai-credits-page";

const workspaceId = "e56299c6-3da3-402a-a9ac-3995bb37b9d4";
const overview = (overrides: Partial<CreditOverview> = {}): CreditOverview => ({
  workspaceId, balance: "812.3456", state: "ok", threshold: "200.0000", customThreshold: null, version: 4,
  lastTopUp: { credits: "1000.0000", at: "2026-09-01T08:00:00Z" },
  usedThisMonth: "187.6544", usedToday: "12.5000", dailyLimit: "1000.0000",
  byFeature: [{ feature: "crm.chat", credits: "150.1000", calls: 521 }, { feature: "quotation.plan", credits: "37.5544", calls: 3 }],
  ledger: [
    { id: "e2", entryType: "usage", credits: "-0.2880", balanceAfter: "812.3456", model: "apac.amazon.nova-lite-v1:0", feature: "crm.chat", inputTokens: 2000, outputTokens: 300,
      reference: null, note: null, createdBy: "u1", createdByName: "Maya Admin", createdAt: "2026-09-28T10:00:00Z" },
    { id: "e1", entryType: "grant", credits: "1000.0000", balanceAfter: "1000.0000", model: null, feature: null, inputTokens: null, outputTokens: null,
      reference: null, note: "Welcome credits", createdBy: null, createdByName: null, createdAt: "2026-09-01T08:00:00Z" },
  ],
  ...overrides,
});
const renderPage = () => render(<DesignSystemProvider locale="en-US" timeZone="UTC"><AiCreditsPage workspaceId={workspaceId} /></DesignSystemProvider>);

afterEach(() => vi.unstubAllGlobals());

describe("Settings → AI credits", () => {
  it("shows the balance, this month's use by feature and every ledger entry", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => overview() }));
    vi.stubGlobal("fetch", fetcher);
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "AI credits" })).toBeInTheDocument();
    expect(String((fetcher.mock.calls[0] as unknown as [string])[0])).toBe(`/api/workspace/ai-credits?workspaceId=${workspaceId}`);
    const balance = screen.getByRole("region", { name: "Balance" });
    expect(within(balance).getByText("812.35")).toBeInTheDocument();
    expect(within(balance).getByText("12.5 of 1,000")).toBeInTheDocument();
    const month = screen.getByRole("table", { name: "AI use this month" });
    expect(within(month).getByText("Woddy chat")).toBeInTheDocument();
    expect(within(month).getByText("521")).toBeInTheDocument();
    const ledger = screen.getByRole("table", { name: "AI credit ledger" });
    expect(within(ledger).getByText("AI use")).toBeInTheDocument();
    expect(within(ledger).getByText("-0.288")).toBeInTheDocument();
    expect(within(ledger).getAllByText("Welcome credits").length).toBeGreaterThan(0);
    expect(within(ledger).getByText("Maya Admin")).toBeInTheDocument();
    expect(screen.queryByText("AI credits are used up")).not.toBeInTheDocument();
  });

  it("says calmly when credits are used up or running low, with the next step", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => overview({ balance: "-0.4000", state: "exhausted" }) })));
    const { unmount } = renderPage();
    expect(await screen.findByText("AI credits are used up")).toBeInTheDocument();
    expect(screen.getByText("Woddy and AI suggestions are paused. Contact support to top up.")).toBeInTheDocument();
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => overview({ balance: "150.0000", state: "low" }) })));
    renderPage();
    expect(await screen.findByText("AI credits are running low")).toBeInTheDocument();
  });

  it("offers a retry when the credits don't load, and a locked state without access", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ message: "The workspace service is unavailable." }) })
      .mockResolvedValueOnce({ ok: true, json: async () => overview() });
    vi.stubGlobal("fetch", fetcher);
    const { unmount } = renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "AI credits" })).toBeInTheDocument();
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ message: "Forbidden" }) })));
    renderPage();
    expect(await screen.findByText("You don't have access to AI credits")).toBeInTheDocument();
  });

  it("is a Company setting that owners and administrators open", () => {
    const company = workspaceModules.find((module) => module.id === "workspace")!.navigation.find((group) => group.id === "workspace-company")!;
    expect(company.items.find((item) => item.id === "ai-credits")).toMatchObject({ href: "/workspace/settings/ai-credits" });
    expect(canOpen("ai-credits", { roles: ["owner"] })).toBe(true);
    expect(canOpen("ai-credits", { permissions: ["workspace.settings.manage"] })).toBe(true);
    expect(canOpen("ai-credits", { permissions: ["crm.leads.view"] })).toBe(false);
  });

  it("formats credits exactly from their decimal strings", () => {
    expect(formatCredits("1234567.8912", "en-US")).toBe("1,234,567.89");
    expect(formatCredits("0.0001", "en-US", 4)).toBe("0.0001");
    expect(formatCredits("12345678901234.5678", "en-US", 4)).toBe("12,345,678,901,234.5678");
    expect(formatCredits(null, "en-US")).toBe("—");
  });
});
