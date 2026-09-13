import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CommercialState, Quote } from "@/lib/commercial/types";
import type { PreProjectCase } from "@/lib/pre-project/types";
import { CommercialPage } from "./commercial-page";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/crm/woddy-chat", () => ({ useWoddyRecord: vi.fn() }));
vi.mock("@/components/workspace/workspace-focus", () => ({
  useWorkspaceFocus: vi.fn(),
}));
vi.mock("@/components/pre-project/pre-project-context", () => ({
  usePreProject: () => ({ setSelected: vi.fn() }),
}));
vi.mock("./quotation-studio", () => ({
  QuotationStudio: ({ quote }: { quote: Quote }) => (
    <div>Builder for {quote.title}</div>
  ),
}));
const quote = (id: string, number: number): Quote => ({
  id,
  number,
  kind: "quotation",
  status: number === 1 ? "superseded" : "draft",
  title: `Proposal ${number}`,
  currency: "AED",
  validUntil: "2099-01-01",
  discount: 0,
  taxRate: 0,
  terms: "Terms",
  exclusions: "",
  createdAt: "2026-09-07",
  requestIds: [],
  total: 100,
  lines: [],
  paymentTerms: [],
});
const state: CommercialState = {
  workspaceId: "w1",
  caseId: "case1",
  title: "Villa",
  customerName: "Client",
  currency: "AED",
  contacts: [],
  canEdit: true,
  canApprove: true,
  canRelease: true,
  canManagePortal: true,
  portalSlug: null,
  data: {
    revision: 1,
    quotes: [quote("q1", 1), quote("q2", 2)],
    requests: [],
    agreement: null,
    payments: [],
    audit: [],
    release: null,
  },
};
const record = {
  id: "case1",
  title: "Villa",
  customerName: "Client",
} as PreProjectCase;
describe("Quotation entry flow", () => {
  it("opens with a table and links each quotation to its own builder", () => {
    render(
      <CommercialPage
        initial={state}
        record={record}
        section="quotations"
        search=""
      />,
    );
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByRole("link", { name: "Proposal 1" })).toHaveAttribute(
      "href",
      "/workspace/pre-projects/cases/case1/quotations?quote=q1",
    );
    expect(screen.queryByText(/Builder for/)).not.toBeInTheDocument();
  });
  it("opens the selected quotation rather than silently switching to the newest version", async () => {
    render(
      <CommercialPage
        initial={state}
        record={record}
        section="quotations"
        quotationId="q1"
        search=""
      />,
    );
    expect(await screen.findByText("Builder for Proposal 1")).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("shows a recovery link when a quotation no longer exists", () => {
    render(
      <CommercialPage
        initial={state}
        record={record}
        section="quotations"
        quotationId="missing"
        search=""
      />,
    );
    expect(screen.getByText("Quotation not found")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Back to quotations" }),
    ).toBeVisible();
    expect(screen.queryByText(/Builder for/)).not.toBeInTheDocument();
  });
  it("shows the three live pre-execution stages without duplicating page navigation", () => {
    render(
      <CommercialPage
        initial={state}
        record={record}
        section="variations"
        search=""
      />,
    );
    const flow = screen.getByRole("navigation", {
      name: "Pre-execution readiness timeline",
    });
    expect(flow).toBeVisible();
    expect(flow).toHaveTextContent("Agreement & payments");
    expect(flow).toHaveTextContent("Change control");
    expect(flow).toHaveTextContent("Approvals & release");
    expect(
      screen.getByRole("link", { name: /Change control/ }),
    ).toHaveAttribute("aria-current", "step");
  });
});
