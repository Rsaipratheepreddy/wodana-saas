import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { QuotationSettingsPage } from "./quotation-settings";

vi.mock("./proposal-kit-settings", () => ({ ProposalKitSettings: () => null }));

const settings = { defaultView: "area", pricesIncludeTax: false, rounding: "line", defaultMarkupPercent: "0", marginFloorPercent: null, discountApprovalPercent: null, validityDays: 30,
  internalReview: true, priceBookId: null, decisionReminderDays: [], expiryWarningDays: 3, defaultPaymentTemplateId: null, version: 4 };

describe("Settings → Quotations: the default payment plan (m24)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates the firm's first payment plan there and makes it the default", async () => {
    let templates: Array<{ id: string; name: string }> = [];
    let current = { ...settings };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      if (url.includes("payment-templates") && init?.method === "POST") { templates = [{ id: "plan-1", name: body.name }]; return { ok: true, status: 201, json: async () => ({ id: "plan-1" }) }; }
      if (url.includes("/settings") && init?.method === "PUT") { current = { ...body, version: current.version + 1 }; return { ok: true, status: 200, json: async () => current }; }
      return { ok: true, status: 200, json: async () => ({ settings: current, workPackages: [], priceBooks: [], paymentTemplates: templates, canManage: true }) };
    });
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><QuotationSettingsPage workspaceId="w" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Create payment plan" }));
    const dialog = await screen.findByRole("dialog", { name: "Create payment plan" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Create and use" }));
    await waitFor(() => expect(current.defaultPaymentTemplateId).toBe("plan-1"));
    const created = JSON.parse(String(fetcher.mock.calls.find(([url, init]) => String(url).includes("payment-templates") && init?.method === "POST")![1]!.body));
    expect(created.milestones.map((row: { percent: number }) => row.percent)).toEqual([50, 40, 10]);
    expect(created.milestones[0]).toMatchObject({ title: "Advance", requiredForRelease: true });
    expect(await screen.findByRole("button", { name: /Default payment plan/ })).toHaveTextContent("Standard payment plan");
  });

  it("sets QS review to the rules: which quotations, the catalogue kinds, and the work packages marked for QS", async () => {
    let current: Record<string, unknown> = { ...settings, qsReview: true, qsReviewScope: "all", qsReviewItemTypes: [] };
    let trades = [{ id: "wp-1", name: "Joinery", archived: false, qsReview: false }, { id: "wp-2", name: "Loose furniture", archived: false, qsReview: false }];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      if (url.includes("work-packages/wp-1") && init?.method === "PATCH") { trades = trades.map((item) => (item.id === "wp-1" ? { ...item, ...body } : item)); return { ok: true, status: 200, json: async () => trades }; }
      if (url.includes("/settings") && init?.method === "PUT") { current = { ...body, version: Number(current.version) + 1 }; return { ok: true, status: 200, json: async () => current }; }
      return { ok: true, status: 200, json: async () => ({ settings: current, workPackages: trades, priceBooks: [], paymentTemplates: [], canManage: true }) };
    });
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><QuotationSettingsPage workspaceId="w" /></DesignSystemProvider>);
    // Every quotation (as before): no rules to set.
    expect(await screen.findByRole("button", { name: /Quotations the QS prices/ })).toHaveTextContent("Every quotation");
    expect(screen.queryByRole("checkbox", { name: "QS review" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Quotations the QS prices/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Only where the rules apply" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Assembly" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(current).toMatchObject({ qsReviewScope: "rules", qsReviewItemTypes: ["assembly"] }));
    // Joinery is marked on the work package itself.
    await userEvent.click(screen.getAllByRole("checkbox", { name: "QS review" })[0]);
    await waitFor(() => expect(trades[0].qsReview).toBe(true));
    const patch = fetcher.mock.calls.find(([url, init]) => String(url).includes("work-packages/wp-1") && init?.method === "PATCH")!;
    expect(JSON.parse(String(patch[1]!.body))).toEqual({ qsReview: true });
  });
});
