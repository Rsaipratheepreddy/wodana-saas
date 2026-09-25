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
vi.mock("./quotation-builder-preview",()=>({QuotationBuilderPreview:()=> <div>Read-only client document</div>}));
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
  it("shows project quotation cards and retains the existing editor links and table view", async () => {
    render(<CommercialPage initial={state} record={record} section="quotations" search="" quotationPresentation="cards" embedded/>);
    expect(screen.getByRole("article")).toHaveTextContent("Proposal 2");
    expect(screen.getByRole("link", { name: "Open quotation" })).toHaveAttribute("href", "/workspace/pre-projects/cases/case1/quotations?quote=q2");
    expect(screen.queryByText("Proposal 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quotation table" }));
    expect(screen.getByRole("table")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Quotation cards" }));
    expect(screen.getByRole("article")).toBeVisible();
  });
  it("keeps empty quotation cards honest and does not offer creation to viewers", () => {
    render(<CommercialPage initial={{...state,canEdit:false,data:{...state.data,quotes:[]}}} record={record} section="quotations" search="" quotationPresentation="cards" embedded/>);
    expect(screen.getByText("No quotations yet")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Create quotation" })).not.toBeInTheDocument();
  });
  it("requires a Palm service path before creating the first quotation", () => {
    render(<CommercialPage initial={{ ...state, palmFlowEnabled: true, data: { ...state.data, quotes: [] } }} record={record} section="quotations" search="" quotationPresentation="cards" embedded/>);
    expect(screen.getByRole("region", { name: "Enquiry service path" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Create quotation" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Design / moodboards only" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Ready-made furniture" })).toBeEnabled();
  });
  it("keeps the second round inside the same project", () => {
    const design = quote("design", 1);
    design.status = "accepted";
    design.round = "design";
    const palm = {
      ...state,
      palmFlowEnabled: true,
      data: {
        ...state.data,
        quotes: [design],
        palmFlow: { selectedAt: "now", selectedBy: "sales", scope: { design: true, mainQuotation: true, materialSelection: true, procurement: true, manufacturing: true, siteWorks: true, installation: true } },
        dealFile: { id: "deal", quoteId: "design", reference: "DF-1" },
      },
    } as CommercialState;
    render(<CommercialPage initial={palm} record={record} section="quotations" search="" quotationPresentation="cards" embedded projectId="project1"/>);
    expect(screen.getByRole("button", { name: "Prepare main quotation" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "View version" })).toHaveAttribute(
      "href", "/workspace/projects/project1?tab=planning&planningTab=quotations&quote=design",
    );
  });
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
    expect(screen.getByRole("link", { name: "Proposal 2" })).toHaveAttribute(
      "href",
      "/workspace/pre-projects/cases/case1/quotations?quote=q2",
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
    expect(await screen.findByRole("link", { name: "Request a change" })).toHaveAttribute(
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
  it("keeps change requests focused without a duplicate readiness navigation", () => {
    render(<CommercialPage initial={state} record={record} section="variations" search=""/>);
    expect(screen.queryByRole("navigation",{name:"Pre-execution readiness timeline"})).not.toBeInTheDocument();
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

it("reviews an approved quotation without editing and requires a client approver before issue",()=>{
 const approved=structuredClone(state);approved.data.quotes[1].status="internal_approved";
 render(<CommercialPage reviewOnly initial={approved} record={record} section="quotations" quotationId="q2" search=""/>);
 expect(screen.getByText("Read-only client document")).toBeVisible();
 expect(screen.queryByRole("button",{name:"Save changes"})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Send to client"}));
 expect(screen.getByRole("button",{name:"Issue V2"})).toBeDisabled();
 expect(screen.getByText(/Publishing to the portal does not send/)).toBeVisible();
});

it('opens the payment schedule directly from its route and preserves accepted milestone amounts', async () => {
  const payments = structuredClone(state);
  payments.data.quotes[1].status = 'accepted';
  payments.data.payments = [{id:'advance',sourceQuoteId:'q2',title:'Advance',amount:40,dueDate:'2026-10-01',requiredForRelease:true,status:'pending',reference:'',proof:''}];
  render(<CommercialPage initial={payments} record={record} section="payment-plan" search=""/>);
  expect(screen.getByRole('table',{name:'Payment milestones'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Set due date'}));
  expect(await screen.findByRole('dialog',{name:'Payment milestone'})).toBeVisible();
  expect(screen.getByRole('textbox',{name:'Milestone'})).toBeDisabled();
  expect(screen.getByRole('checkbox',{name:'Execution release'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Open calendar Due date'})).toBeEnabled();
  expect(screen.getByRole('button',{name:'Save milestone'})).toBeEnabled();
});
