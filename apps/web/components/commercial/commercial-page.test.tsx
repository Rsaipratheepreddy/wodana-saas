import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  canVerifyFinance: true,
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
  afterEach(() => vi.unstubAllGlobals());
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
  it("routes an accepted quotation into controlled change cases", async () => {
    const accepted = structuredClone(state);
    accepted.data.quotes[1].status = "accepted";
    render(<CommercialPage initial={accepted} record={record} section="quotations" quotationId="q2" search="" />);
    expect(await screen.findByRole("link", { name: "Start change case" })).toHaveAttribute(
      "href", "/workspace/pre-projects/cases/case1/variations",
    );
    expect(screen.queryByRole("button", { name: "Create variation" })).toBeNull();
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
  it("keeps a successful quotation creation when its follow-up read fails", async () => {
    const empty = structuredClone(state);
    empty.data.quotes = [];
    const created = quote("q3", 1);
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { ...empty.data, revision: 2, quotes: [created] } }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ message: "Refresh unavailable" }) });
    vi.stubGlobal("fetch", fetcher);
    render(<CommercialPage initial={empty} record={record} section="quotations" search="" />);
    fireEvent.click(screen.getByRole("button", { name: "Create quotation" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved. Latest changes are shown"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
