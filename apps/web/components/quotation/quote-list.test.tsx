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
