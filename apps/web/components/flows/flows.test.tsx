import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider, ToastProvider } from "@/design-system";
import { productNavigation, workspaceModules } from "@/components/workspace/workspace-navigation";
import { canOpen } from "@/lib/workspace/access";
import { updateBranch, updateStep, type FlowDefinition, type FlowSummary } from "@/lib/flows/flow-model";
import { FlowProperties } from "./flow-properties";
import { FlowsListPage } from "./flows-list-page";
import { FlowBuilder, FlowStepsList } from "./flow-builder";
import { FlowPalette } from "./flow-palette";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));

const workspaceId = "e56299c6-3da3-402a-a9ac-3995bb37b9d4";
const design = "11111111-1111-4111-8111-111111111111";
const basic = "22222222-2222-4222-8222-222222222222";
const interior = "33333333-3333-4333-8333-333333333333";
const kitchen = "55555555-5555-4555-8555-555555555555";
const flows: FlowSummary[] = [
  { id: basic, code: "basic", name: "Basic", status: "active", version: 1, runningJobs: 0,
    latest: { id: "v1", version: 1, source: "starter", publishedAt: "2026-09-30T09:00:00Z", publishedBy: null, steps: ["New opportunity", "Won"] },
    usedBy: [{ id: kitchen, code: "kitchen_only", label: "Kitchen only", version: 2, assigned: false }] },
  { id: design, code: "design", name: "Design", status: "active", version: 3, runningJobs: 12,
    latest: { id: "v3", version: 3, source: "published", publishedAt: "2026-10-02T09:00:00Z", publishedBy: "Maya Admin", steps: ["New opportunity", "Intro meeting", "Won"] },
    usedBy: [{ id: interior, code: "interior_design", label: "Interior design", version: 4, assigned: true }] },
];
const wrap = (node: React.ReactNode) => <DesignSystemProvider locale="en-US" timeZone="UTC"><ToastProvider>{node}</ToastProvider></DesignSystemProvider>;

afterEach(() => { vi.unstubAllGlobals(); push.mockReset(); });

describe("Flows navigation", () => {
  it("puts Flows above Sales, only for people who manage flows", () => {
    const scoped = (permissions: string[]) => workspaceModules.map((module) => ({ ...module, navigation: module.navigation.map((section) => ({ ...section, items: section.items.filter((item) => canOpen(item.id, { permissions, roles: ["member"] })) })) }));
    const items = (permissions: string[]) => productNavigation(scoped(permissions)).flatMap((section) => section.items.map((item) => item.id));
    const manager = items(["crm.settings.manage", "crm.leads.view"]);
    expect(manager.indexOf("flows")).toBeGreaterThanOrEqual(0);
    expect(manager.indexOf("flows")).toBe(manager.indexOf("sales") - 1);
    expect(items(["crm.leads.view"])).not.toContain("flows");
  });
});

type Route = (url: string, init: RequestInit) => { status?: number; body: unknown } | undefined;
function stubFetch(route: Route) {
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    const reply = route(url, init) ?? { status: 404, body: { message: "Not found" } };
    return { ok: (reply.status ?? 200) < 400, status: reply.status ?? 200, json: async () => reply.body };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const put = (fetcher: ReturnType<typeof stubFetch>) => (fetcher.mock.calls as unknown as Array<[string, RequestInit]>).filter(([, init]) => init?.method === "PUT");
const card = (name: string) => screen.getByRole("link", { name: new RegExp(`^${name}`) }).closest("li")!;

describe("Flows list", () => {
  it("shows one card per flow: name, steps, running jobs, version and the enquiry types it is used for", () => {
    render(wrap(<FlowsListPage canManage flows={flows} workspaceId={workspaceId} />));
    expect(screen.getByRole("heading", { level: 1, name: "Flows" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    const designCard = card("Design");
    expect(within(designCard).getByRole("heading", { level: 2, name: "Design" })).toBeInTheDocument();
    expect(designCard).toHaveTextContent("3 steps");
    expect(designCard).toHaveTextContent("New opportunity");
    expect(designCard).toHaveTextContent("12 running jobs");
    expect(designCard).toHaveTextContent("v3");
    expect(within(designCard).getByRole("img", { name: "Maya Admin" })).toBeInTheDocument();
    expect(within(within(designCard).getByRole("region", { name: "Used for" })).getByText("Interior design")).toBeInTheDocument();
    expect(card("Basic")).toHaveTextContent("Starter");
    expect(screen.getAllByRole("button", { name: "New flow" })).toHaveLength(1);
  });

  it("opens the builder from the card and from Edit flow", () => {
    render(wrap(<FlowsListPage canManage flows={flows} workspaceId={workspaceId} />));
    const designCard = card("Design");
    expect(within(designCard).getByRole("link", { name: /^Design/ })).toHaveAttribute("href", `/workspace/flows/${design}`);
    expect(within(designCard).getByRole("link", { name: "Edit flow" })).toHaveAttribute("href", `/workspace/flows/${design}`);
  });

  it("lists enquiry types that name no flow under Not in a flow yet", () => {
    render(wrap(<FlowsListPage canManage flows={flows} workspaceId={workspaceId} />));
    expect(within(screen.getByRole("region", { name: "Not in a flow yet" })).getByText("Kitchen only")).toBeInTheDocument();
    expect(within(within(card("Basic")).getByRole("region", { name: "Used for" })).queryByText("Kitchen only")).toBeNull();
  });

  it("moves an enquiry type to another flow from its pill, which is one menu button", async () => {
    const fetcher = stubFetch((_, init) => init.method === "PUT" ? { body: { id: "x", version: 5 } } : undefined);
    render(wrap(<FlowsListPage canManage flows={flows} workspaceId={workspaceId} />));
    const usedFor = within(card("Design")).getByRole("region", { name: "Used for" });
    expect(within(usedFor).getAllByRole("button")).toHaveLength(2); // the pill and "Add enquiry type"
    await userEvent.click(within(usedFor).getByRole("button", { name: "Interior design" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Move to Basic", "Remove from this flow"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Move to Basic" }));
    const [url, init] = put(fetcher)[0];
    expect(url).toBe(`/api/workspace/crm/data/flows/${basic}/enquiry-types/${interior}?workspaceId=${workspaceId}`);
    expect(JSON.parse(String(init.body))).toEqual({ version: 4 });
    expect(await screen.findByText("Interior design now follows Basic")).toBeInTheDocument();
    expect(within(within(card("Basic")).getByRole("region", { name: "Used for" })).getByText("Interior design")).toBeInTheDocument();
  });

  it("takes an enquiry type out of its flow", async () => {
    const fetcher = stubFetch((_, init) => init.method === "DELETE" ? { body: { id: "x", version: 5, flow: null } } : undefined);
    render(wrap(<FlowsListPage canManage flows={flows} workspaceId={workspaceId} />));
    await userEvent.click(within(card("Design")).getByRole("button", { name: "Interior design" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove from this flow" }));
    const [url] = (fetcher.mock.calls as unknown as Array<[string, RequestInit]>).find(([, init]) => init?.method === "DELETE")!;
    expect(url).toBe(`/api/workspace/crm/data/flows/${design}/enquiry-types/${interior}?version=4&workspaceId=${workspaceId}`);
    expect(await screen.findByText("Interior design is no longer in Design")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Not in a flow yet" })).getByRole("button", { name: "Interior design" })).toBeInTheDocument();
    expect(within(card("Design")).queryByText("Interior design")).toBeNull();
  });

  it("adds an enquiry type from a searchable list, asking first when it is in another flow", async () => {
    const fetcher = stubFetch((_, init) => init.method === "PUT" ? { body: { id: "x", version: 9 } } : undefined);
    render(wrap(<FlowsListPage canManage flows={flows} workspaceId={workspaceId} />));
    await userEvent.click(within(card("Basic")).getByRole("button", { name: "Add enquiry type" }));
    const picker = await screen.findByRole("dialog", { name: "Add enquiry type" });
    await userEvent.type(within(picker).getByRole("searchbox"), "inter");
    expect(within(picker).getAllByRole("menuitem")).toHaveLength(1);
    await userEvent.click(within(picker).getByRole("menuitem", { name: /Interior design.*in Design/ }));
    expect(put(fetcher)).toHaveLength(0);
    const dialog = await screen.findByRole("dialog", { name: "Move Interior design to Basic?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Move" }));
    expect(put(fetcher)[0][0]).toContain(`flows/${basic}/enquiry-types/${interior}`);

    await userEvent.click(within(card("Design")).getByRole("button", { name: "Add enquiry type" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Kitchen only" }));
    expect(put(fetcher)[1][0]).toContain(`flows/${design}/enquiry-types/${kitchen}`);
    expect(screen.queryByRole("region", { name: "Not in a flow yet" })).toBeNull();
  });

  it("never offers Not sure yet for a flow, even when old data names one", async () => {
    const notSure = { id: "66666666-6666-4666-8666-666666666666", code: "not_sure", label: "Not sure yet", version: 1 };
    const withPlaceholder = flows.map((flow) => ({ ...flow, usedBy: [...flow.usedBy, { ...notSure, assigned: flow.code === "design" }] }));
    render(wrap(<FlowsListPage canManage flows={withPlaceholder} workspaceId={workspaceId} />));
    expect(screen.queryByText("Not sure yet")).toBeNull();
    await userEvent.click(within(card("Basic")).getByRole("button", { name: "Add enquiry type" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).not.toContainEqual(expect.stringContaining("Not sure yet"));
  });

  it("creates a new flow from a template, grouped in the picker, and opens it", async () => {
    const fetcher = stubFetch((url, init) => {
      if (url.includes("flows/templates")) return { body: [
        { key: "showroom", name: "Showroom sale", description: "Walk-in furniture sale", group: "Furniture", suggestedEnquiryTypes: ["Loose furniture"], stepCount: 6, definition: {} },
        { key: "villa", name: "Villa design", description: "Full design", group: "Interior design", suggestedEnquiryTypes: [], stepCount: 11, definition: {} },
      ] };
      if (init.method === "POST") return { body: { id: "44444444-4444-4444-8444-444444444444", created: true } };
      return undefined;
    });
    render(wrap(<FlowsListPage canManage flows={flows} workspaceId={workspaceId} />));
    await userEvent.click(screen.getByRole("button", { name: "New flow" }));
    const dialog = await screen.findByRole("dialog", { name: "New flow" });
    const furniture = await within(dialog).findByRole("region", { name: "Furniture" });
    expect(furniture).toHaveTextContent("6 steps");
    expect(furniture).toHaveTextContent("Loose furniture");
    expect(within(dialog).getByRole("region", { name: "Start from a copy of an existing flow" })).toHaveTextContent("Design");
    expect(within(dialog).queryByRole("region", { name: "Starters" })).toBeNull();
    await userEvent.click(within(furniture).getByRole("button", { name: /Showroom sale/ }));
    const [url, init] = (fetcher.mock.calls as unknown as Array<[string, RequestInit]>).find(([, request]) => request?.method === "POST")!;
    expect(url).toBe(`/api/workspace/crm/data/flows?workspaceId=${workspaceId}`);
    expect(JSON.parse(String(init.body))).toEqual({ templateKey: "showroom", name: "Showroom sale" });
    expect(push).toHaveBeenCalledWith("/workspace/flows/44444444-4444-4444-8444-444444444444");
  });

  it("falls back to the starters when there is no template library, with a name of its own", async () => {
    const fetcher = stubFetch((_, init) => init.method === "POST" ? { body: { id: "44444444-4444-4444-8444-444444444444", created: true } } : undefined);
    render(wrap(<FlowsListPage canManage flows={flows} workspaceId={workspaceId} />));
    await userEvent.click(screen.getByRole("button", { name: "New flow" }));
    const starters = await screen.findByRole("region", { name: "Starters" });
    await userEvent.click(within(starters).getByRole("button", { name: /Design/ }));
    const [, init] = (fetcher.mock.calls as unknown as Array<[string, RequestInit]>).find(([, request]) => request?.method === "POST")!;
    expect(JSON.parse(String(init.body))).toEqual({ starter: "design", name: "Design 2" });
  });

  it("shows the error state with a retry when the flows could not be loaded", () => {
    render(wrap(<FlowsListPage canManage flows={[]} loadError workspaceId={workspaceId} />));
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New flow" })).toBeNull();
  });

  it("tells people without the permission that they cannot open it", () => {
    render(wrap(<FlowsListPage canManage={false} flows={[]} workspaceId={workspaceId} />));
    expect(screen.queryByRole("button", { name: "New flow" })).toBeNull();
  });
});

const definition = (): FlowDefinition => ({
  schema: 1, columns: ["qualified", "qualification", "proposal", "negotiation", "won"],
  steps: [
    { key: "intro", name: "Hold the intro meeting", role: "sales", check: "intro_meeting_completed", column: "qualification", clientVisible: true },
    { key: "client_type", name: "Set the client type", role: "sales", check: "client_type_set", column: "qualification" },
    { key: "payment_proof", name: "Attach the payment proof", role: "sales", check: "payment_proof_attached", column: "won" },
  ],
  branches: [{ key: "by_client", question: "clientType", after: "client_type", rejoin: "payment_proof", answers: [{ value: "end_user", steps: [] }] }],
});
const roles = [{ code: "sales", name: "Sales" }, { code: "designer", name: "Designer" }, { code: "manager", name: "Manager" }];
const answerOptions = { clientType: [{ value: "end_user", label: "End user" }, { value: "developer", label: "Developer" }] };

function Editor({ selectedId, onChange }: { selectedId: string; onChange: (next: FlowDefinition) => void }) {
  const [current, setCurrent] = useState(definition);
  const commit = (next: FlowDefinition) => { setCurrent(next); onChange(next); };
  return <FlowProperties answerOptions={answerOptions} columnNames={{}} definition={current} problems={[{ nodeId: "intro", field: "role", message: "Every step has a role", path: "steps[0].role" }]}
    roles={roles} selectedId={selectedId} onBranchChange={(key, patch) => commit(updateBranch(current, key, patch, answerOptions))} onMove={() => undefined} onRemove={() => undefined}
    onStepChange={(key, patch) => commit(updateStep(current, key, patch))} />;
}

describe("Properties", () => {
  it("edits a step with pickers only and shows the validator's problem on its field", async () => {
    const changes: FlowDefinition[] = [];
    render(wrap(<Editor onChange={(next) => changes.push(next)} selectedId="intro" />));
    const panel = screen.getByRole("region", { name: "Step properties" });
    expect(within(panel).getByText("Every step has a role")).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: /Who/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Designer" }));
    expect(changes.at(-1)!.steps[0].role).toBe("designer");
    await userEvent.click(within(panel).getByRole("switch", { name: "Optional" }));
    expect(changes.at(-1)!.steps[0].optional).toBe(true);
    await userEvent.click(within(panel).getByRole("switch", { name: "Client sees it" }));
    expect(changes.at(-1)!.steps[0].clientVisible).toBeUndefined();
    const amount = within(panel).getByRole("textbox", { name: "Deadline" });
    await userEvent.type(amount, "2");
    fireEvent.blur(amount);
    expect(changes.at(-1)!.steps[0].deadline).toEqual({ amount: 2, unit: "days" });
    expect(within(panel).getByRole("button", { name: "Remove step" })).toBeEnabled();
  });

  it("keeps the payment proof step that ends the flow", () => {
    render(wrap(<Editor onChange={() => undefined} selectedId="payment_proof" />));
    expect(screen.getByRole("button", { name: "Remove step" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move down" })).toBeDisabled();
  });

  it("adds an answer to a branch", async () => {
    const changes: FlowDefinition[] = [];
    render(wrap(<Editor onChange={(next) => changes.push(next)} selectedId="by_client" />));
    const panel = screen.getByRole("region", { name: "Branch properties" });
    await userEvent.click(within(panel).getByRole("combobox", { name: /Add Answers/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Developer" }));
    expect(changes.at(-1)!.branches[0].answers.map((answer) => answer.value)).toEqual(["end_user", "developer"]);
  });
});

describe("Components and the phone view", () => {
  it("groups components and adds the pressed one", async () => {
    const onAdd = vi.fn();
    render(wrap(<FlowPalette canBranch={false} onAdd={onAdd} />));
    const nav = screen.getByRole("navigation", { name: "Components" });
    expect(within(nav).getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Contact", "Meetings", "Sell", "Design", "Logic"]);
    await userEvent.click(within(nav).getByRole("button", { name: /Intro meeting completed/ }));
    expect(onAdd).toHaveBeenCalledWith("intro_meeting_completed");
    await userEvent.click(within(nav).getByRole("button", { name: /Branch/ }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("lists the steps read-only, with a branch's answers", () => {
    render(wrap(<FlowStepsList answerOptions={answerOptions} definition={definition()} roles={roles} />));
    const list = screen.getByLabelText("Steps"); // shown on phones only
    expect(list).toHaveTextContent("Hold the intro meeting");
    expect(list).toHaveTextContent("Done when: Intro meeting completed");
    expect(list).toHaveTextContent("Which client type?");
    expect(list).toHaveTextContent("End user");
  });
});

describe("Flow builder", () => {
  it("returns to the Flows list on Esc when nothing is selected", async () => {
    const definition: FlowDefinition = { schema: 1, columns: ["qualified", "won"], branches: [],
      steps: [{ key: "payment_proof", name: "Attach the payment proof", role: "sales", check: "payment_proof_attached", column: "won" }] };
    render(wrap(<FlowBuilder answerOptions={{}} canManage columnNames={{}} flows={flows} roles={[]} workspaceId={workspaceId}
      flow={{ id: basic, code: "basic", name: "Basic", status: "active", version: 1, selected: { version: 1, definition } }} />));
    expect(screen.getByRole("link", { name: "Back to Flows" })).toHaveAttribute("href", "/workspace/flows");
    await userEvent.keyboard("{Escape}");
    expect(push).toHaveBeenCalledWith("/workspace/flows");
  });
});
