import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { CommercialState } from "@/lib/commercial/types";
import type { CasePlan } from "@/lib/pre-project/types";
import { QuoteList } from "./quote-list";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const state = (patch: Partial<CommercialState> = {}): CommercialState => ({
  workspaceId: "w", caseId: "c1", title: "Sofa", customerName: "Dana", customerEmail: "", customerPhone: "", currency: "AED",
  data: { revision: 1, quotes: [], requests: [], agreement: null, payments: [], audit: [], release: null }, contacts: [], canEdit: true, canApprove: true, canVerifyFinance: true,
  canRelease: true, canManagePortal: true, portalSlug: "palm", servicePathEnabled: true, ...patch,
} as CommercialState);
const mount = (plan?: CasePlan) => render(<DesignSystemProvider><QuoteList initial={state()} baseHref="/workspace/pre-projects/cases/c1/quotations" plan={plan} /></DesignSystemProvider>);

it("has one title and one New quote action, also when there are no quotes yet (L14)", () => {
  mount();
  expect(screen.getByRole("heading", { level: 1, name: "Quotes" })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "New quote" })).toHaveLength(1);
  expect(screen.getByText("No quotes yet")).toBeInTheDocument();
});

it("starts the service from the deal's path: ready-made for stock goods, made-to-order for production (L15)", async () => {
  mount({ source: "path", phases: ["price", "agree", "release"], siteVisit: false, design: false, release: "fulfilment" });
  await userEvent.click(screen.getByRole("button", { name: "New quote" }));
  const dialog = await screen.findByRole("dialog", { name: "What is the client buying?" });
  expect(within(dialog).getByRole("radio", { name: "Ready-made furniture" })).toBeChecked();
});

it("starts made-to-order goods as made-to-order furniture, and keeps the first service without a path plan", async () => {
  const view = mount({ source: "path", phases: ["price", "agree", "release"], siteVisit: false, design: false, release: "production" });
  await userEvent.click(screen.getByRole("button", { name: "New quote" }));
  expect(within(await screen.findByRole("dialog")).getByRole("radio", { name: "Made-to-order furniture" })).toBeChecked();
  view.unmount();
  mount();
  await userEvent.click(screen.getByRole("button", { name: "New quote" }));
  expect(within(await screen.findByRole("dialog")).getByRole("radio", { name: "Design + fitout / furniture" })).toBeChecked();
});

it("shows a sent quote by the number it was issued under, and its type from what the client buys", () => {
  const furniture = { selectedAt: "2026-10-08T00:00:00Z", selectedBy: "u1",
    scope: { design: false, mainQuotation: true, materialSelection: true, procurement: true, manufacturing: true, siteWorks: false, installation: true } };
  const quote = { id: "q1", number: 1, kind: "quotation", round: "main", status: "issued", title: "Dining set", currency: "AED", validUntil: "2026-10-20", discount: 0, taxRate: 5,
    terms: "", exclusions: "", lines: [], requestIds: [], paymentTerms: [], createdAt: "2026-10-08T00:00:00Z", total: 4500 };
  const initial = state({ quoteReferences: { q1: "PLM-QUO-2026-00001" } });
  const view = render(<DesignSystemProvider><QuoteList initial={{ ...initial, data: { ...initial.data, servicePath: furniture, quotes: [quote] } } as CommercialState}
    baseHref="/workspace/pre-projects/cases/c1/quotations" /></DesignSystemProvider>);
  const row = screen.getByRole("link", { name: "Dining set" }).closest("tr")!;
  expect(within(row).getByText("PLM-QUO-2026-00001")).toBeInTheDocument();
  expect(within(row).queryByText("Q-1")).not.toBeInTheDocument();
  expect(within(row).getByText("Furniture")).toBeInTheDocument();
  view.unmount();
  // Work on site is a fit-out; a quote not sent yet keeps its own number.
  render(<DesignSystemProvider><QuoteList initial={{ ...initial, quoteReferences: {}, data: { ...initial.data, servicePath: { ...furniture, scope: { ...furniture.scope, design: true, siteWorks: true } },
    quotes: [{ ...quote, status: "draft" }] } } as CommercialState} baseHref="/workspace/pre-projects/cases/c1/quotations" /></DesignSystemProvider>);
  const draft = screen.getByRole("link", { name: "Dining set" }).closest("tr")!;
  expect(within(draft).getByText("Q-1")).toBeInTheDocument();
  expect(within(draft).getByText("Fit-out")).toBeInTheDocument();
});
