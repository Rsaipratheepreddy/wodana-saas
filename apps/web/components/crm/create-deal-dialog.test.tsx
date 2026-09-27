import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { leadsPageFixture } from "@/lib/crm/leads";
import { WorkspaceRegionProvider } from "@/design-system";
import { CreateDealDialog } from "./create-deal-dialog";

afterEach(() => vi.unstubAllGlobals());
it("prepares the standard sales flow only when converting an enquiry, without setup controls", async () => {
  const data = structuredClone(leadsPageFixture);
  data.defaultCurrency = "AED";
  data.canManagePipelines = true;
  const pipeline = data.pipelines[0]; data.pipelines = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => ({ ok: true, json: async () => init.method === "POST" ? pipeline : [] }));
  vi.stubGlobal("fetch", fetchMock);
  const onCreated = vi.fn().mockResolvedValue(undefined);
  render(<CreateDealDialog lead={data.items[0]} initialData={data} onClose={vi.fn()} onCreated={onCreated} />);
  expect(screen.queryByRole("button", { name: "Set up sales stages" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Sales pipeline/ })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(0);
  expect(screen.queryByRole("textbox", { name: "Currency" })).not.toBeInTheDocument();
  await userEvent.setup().type(screen.getByRole("textbox", { name: "Estimated value (AED)" }), "45000");
  await userEvent.setup().click(screen.getByRole("button", { name: "Convert to opportunity" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
  const writes = fetchMock.mock.calls.filter(([, init]) => init.method === "POST");
  expect(writes).toHaveLength(2);
  expect(writes[0][0]).toContain("/pipelines?");
  expect(JSON.parse(String(writes[0][1].body)).stages.map((stage: {name:string}) => stage.name)).toEqual(["New Opportunity", "Proposal", "Negotiation", "Won", "Lost"]);
  expect(JSON.parse(String(writes[1][1].body))).toMatchObject({ amount: 45000, currencyCode: "AED" });
  expect(writes[1][0]).toContain(`/leads/${data.items[0].id}/qualify`);
});

it("tells a salesperson who to ask when no pipeline exists, instead of creating one and failing with 403", async () => {
  const data = structuredClone(leadsPageFixture);
  data.pipelines = [];
  data.canManagePipelines = false;
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
  vi.stubGlobal("fetch", fetchMock);
  const onCreated = vi.fn();
  render(<CreateDealDialog lead={data.items[0]} initialData={data} onClose={vi.fn()} onCreated={onCreated} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Convert to opportunity" }));
  expect(await screen.findByText(/No sales pipeline is set up yet/)).toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  expect(onCreated).not.toHaveBeenCalled();
});

it("does not create a pipeline or opportunity while the enquiry type is unresolved", () => {
  const data = structuredClone(leadsPageFixture);
  data.items[0].serviceType = "not_sure";
  data.pipelines = [];
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
  vi.stubGlobal("fetch", fetchMock);
  render(<CreateDealDialog lead={data.items[0]} initialData={data} onClose={vi.fn()} onCreated={vi.fn()} />);
  expect(screen.getByText(/choose its actual type before conversion/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Convert to opportunity" })).toBeDisabled();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
});

it("lets the enquiry's own owner convert it when the team list is hidden from their role", async () => {
  const data = structuredClone(leadsPageFixture);
  data.members = [];
  const lead = { ...data.items[0], ownerName: "Sara Sales", nextActionAt: "2026-10-01T09:00:00.000Z" };
  // The live pipeline list is the seeded one; a salesperson never creates a pipeline here.
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, json: async () => url.includes("/pipelines") && init?.method !== "POST" ? data.pipelines : { id: "opportunity" } }));
  vi.stubGlobal("fetch", fetchMock);
  const onCreated = vi.fn().mockResolvedValue(undefined);
  data.defaultCurrency = undefined;
  render(<WorkspaceRegionProvider currency="AED"><CreateDealDialog lead={lead} initialData={data} onClose={vi.fn()} onCreated={onCreated} /></WorkspaceRegionProvider>);
  expect(screen.queryByText("A sales owner is needed")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Estimated value (AED)" })).toBeInTheDocument();
  expect(screen.getAllByText("Sara Sales").length).toBeGreaterThan(0);
  await userEvent.setup().click(screen.getByRole("button", { name: "Convert to opportunity" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
  const write = fetchMock.mock.calls.find(([url]) => url.includes("/qualify"));
  if (!write) throw new Error("The enquiry was not converted");
  expect(JSON.parse(String(write[1]?.body))).toMatchObject({ ownerMembershipId: lead.ownerMembershipId });
});
