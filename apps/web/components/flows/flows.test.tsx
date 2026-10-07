import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider, ToastProvider } from "@/design-system";
import { productNavigation, workspaceModules } from "@/components/workspace/workspace-navigation";
import { canOpen } from "@/lib/workspace/access";
import { updateBranch, updateStep, type EnquiryTypeSummary, type FlowDefinition } from "@/lib/flows/flow-model";
import { FlowProperties } from "./flow-properties";
import { EnquiryTypesPage } from "./enquiry-types-page";
import { FlowBuilder, FlowStepsList } from "./flow-builder";
import { FlowPalette } from "./flow-palette";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));

const workspaceId = "e56299c6-3da3-402a-a9ac-3995bb37b9d4";
const interior = "33333333-3333-4333-8333-333333333333";
const kitchen = "55555555-5555-4555-8555-555555555555";
const types: EnquiryTypeSummary[] = [
  { id: interior, code: "interior_design", label: "Interior design", color: 2, status: "active", version: 4, flowId: "11111111-1111-4111-8111-111111111111", runningJobs: 12,
    latest: { id: "v3", version: 3, source: "published", publishedAt: "2026-10-02T09:00:00Z", publishedBy: "Maya Admin", steps: ["Complete the client details", "Hold the intro meeting", "Attach the payment proof"] } },
  { id: kitchen, code: "kitchen_only", label: "Kitchen only", color: null, status: "active", version: 2, flowId: "22222222-2222-4222-8222-222222222222", runningJobs: 0,
    latest: { id: "v1", version: 1, source: "starter", publishedAt: "2026-09-30T09:00:00Z", publishedBy: null, steps: ["Choose the enquiry type", "Attach the payment proof"] } },
];
const wrap = (node: React.ReactNode) => <DesignSystemProvider locale="en-US" timeZone="UTC"><ToastProvider>{node}</ToastProvider></DesignSystemProvider>;

afterEach(() => { vi.unstubAllGlobals(); push.mockReset(); });

describe("Enquiry types navigation", () => {
  it("puts Enquiry types above Sales, only for people who manage them", () => {
    const scoped = (permissions: string[]) => workspaceModules.map((module) => ({ ...module, navigation: module.navigation.map((section) => ({ ...section, items: section.items.filter((item) => canOpen(item.id, { permissions, roles: ["member"] })) })) }));
    const items = (permissions: string[]) => productNavigation(scoped(permissions)).flatMap((section) => section.items.map((item) => item.id));
    const manager = items(["crm.settings.manage", "crm.leads.view"]);
    expect(manager.indexOf("enquiry-types")).toBeGreaterThanOrEqual(0);
    expect(manager.indexOf("enquiry-types")).toBe(manager.indexOf("sales") - 1);
    expect(items(["crm.leads.view"])).not.toContain("enquiry-types");
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
const calls = (fetcher: ReturnType<typeof stubFetch>, method: string) => (fetcher.mock.calls as unknown as Array<[string, RequestInit]>).filter(([, init]) => init?.method === method);
const card = (name: string) => screen.getByRole("link", { name: new RegExp(`^${name}`) }).closest("li")!;

describe("Enquiry types list", () => {
  it("shows one card per type: colour and name, steps, running jobs, version and Edit steps; never a flow", () => {
    render(wrap(<EnquiryTypesPage canManage types={types} workspaceId={workspaceId} />));
    expect(screen.getByRole("heading", { level: 1, name: "Enquiry types" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    const interiorCard = card("Interior design");
    expect(within(interiorCard).getByRole("heading", { level: 2, name: "Interior design" })).toBeInTheDocument();
    expect(interiorCard.querySelector("[data-hue='2']")).not.toBeNull();
    expect(interiorCard).toHaveTextContent("3 steps");
    expect(interiorCard).toHaveTextContent("Complete the client details");
    expect(interiorCard).toHaveTextContent("Attach the payment proof");
    expect(interiorCard).toHaveTextContent("12 running jobs");
    expect(interiorCard).toHaveTextContent("Version 3");
    expect(within(interiorCard).getByRole("img", { name: "Maya Admin" })).toBeInTheDocument();
    expect(within(interiorCard).getByRole("link", { name: "Edit steps" })).toHaveAttribute("href", `/workspace/enquiry-types/${interior}`);
    expect(within(interiorCard).getByRole("link", { name: /^Interior design/ })).toHaveAttribute("href", `/workspace/enquiry-types/${interior}`);
    expect(card("Kitchen only")).toHaveTextContent("Starter");
    expect(screen.getAllByRole("button", { name: "New enquiry type" })).toHaveLength(1);
    expect(screen.getByText("Not sure yet: stays in New Opportunity until a type is chosen.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/flow/i);
  });

  it("renames a type from its menu (version-checked)", async () => {
    const fetcher = stubFetch((_, init) => init.method === "PATCH" ? { body: { ...types[0], label: "Interiors", version: 5 } } : undefined);
    render(wrap(<EnquiryTypesPage canManage types={types} workspaceId={workspaceId} />));
    await userEvent.click(screen.getByRole("button", { name: "More actions for Interior design" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Rename", "Change colour", "Deal closed when", "Archive"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename Interior design" });
    const name = within(dialog).getByRole("textbox", { name: /Name/ });
    await userEvent.clear(name);
    await userEvent.type(name, "Interiors");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    const [url, init] = calls(fetcher, "PATCH")[0];
    expect(url).toBe(`/api/workspace/crm/data/enquiry-types/${interior}?workspaceId=${workspaceId}`);
    expect(JSON.parse(String(init.body))).toEqual({ version: 4, label: "Interiors" });
    expect(await screen.findByRole("heading", { level: 2, name: "Interiors" })).toBeInTheDocument();
  });

  it("changes a type's colour", async () => {
    const fetcher = stubFetch((_, init) => init.method === "PATCH" ? { body: { ...types[1], color: 5, version: 3 } } : undefined);
    render(wrap(<EnquiryTypesPage canManage types={types} workspaceId={workspaceId} />));
    await userEvent.click(screen.getByRole("button", { name: "More actions for Kitchen only" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Change colour" }));
    const dialog = await screen.findByRole("dialog", { name: "Change colour of Kitchen only" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "Colour 5" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(JSON.parse(String(calls(fetcher, "PATCH")[0][1].body))).toEqual({ version: 2, color: 5 });
  });

  it("archives a type after asking; it leaves the list", async () => {
    const fetcher = stubFetch((_, init) => init.method === "PATCH" ? { body: { ...types[1], status: "archived", version: 3 } } : undefined);
    render(wrap(<EnquiryTypesPage canManage types={types} workspaceId={workspaceId} />));
    await userEvent.click(screen.getByRole("button", { name: "More actions for Kitchen only" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog", { name: "Archive Kitchen only?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    expect(JSON.parse(String(calls(fetcher, "PATCH")[0][1].body))).toEqual({ version: 2, status: "archived" });
    expect(await screen.findByText("Archived")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Kitchen only/ })).toBeNull();
  });

  it("creates a type with its name, colour and steps from a template, then opens its steps", async () => {
    const fetcher = stubFetch((url, init) => {
      if (url.includes("flows/templates")) return { body: [
        { key: "showroom", name: "Showroom sale", description: "Walk-in furniture sale", group: "Furniture", suggestedEnquiryTypes: ["Loose furniture"], stepCount: 6, definition: {} },
        { key: "villa", name: "Villa design", description: "Full design", group: "Interior design", suggestedEnquiryTypes: [], stepCount: 11, definition: {} },
      ] };
      if (init.method === "POST") return { body: { id: "44444444-4444-4444-8444-444444444444", created: true } };
      return undefined;
    });
    render(wrap(<EnquiryTypesPage canManage types={types} workspaceId={workspaceId} />));
    await userEvent.click(screen.getByRole("button", { name: "New enquiry type" }));
    const dialog = await screen.findByRole("dialog", { name: "New enquiry type" });
    const furniture = await within(dialog).findByRole("region", { name: "Furniture" });
    expect(furniture).toHaveTextContent("6 steps");
    expect(within(dialog).getByRole("region", { name: "Copy steps from another type" })).toHaveTextContent("Interior design");
    // A name comes first.
    await userEvent.click(within(furniture).getByRole("button", { name: /Showroom sale/ }));
    expect(calls(fetcher, "POST")).toHaveLength(0);
    expect(within(dialog).getByText("Give the enquiry type a name")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Name/ }), "Loose furniture");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Colour 4" }));
    await userEvent.click(within(furniture).getByRole("button", { name: /Showroom sale/ }));
    const [url, init] = calls(fetcher, "POST")[0];
    expect(url).toBe(`/api/workspace/crm/data/enquiry-types?workspaceId=${workspaceId}`);
    expect(JSON.parse(String(init.body))).toEqual({ label: "Loose furniture", color: 4, templateKey: "showroom" });
    expect(push).toHaveBeenCalledWith("/workspace/enquiry-types/44444444-4444-4444-8444-444444444444");
  });

  it("copies another type's steps, or starts blank", async () => {
    const fetcher = stubFetch((url, init) => init.method === "POST" ? { body: { id: "44444444-4444-4444-8444-444444444444", created: true } } : undefined);
    render(wrap(<EnquiryTypesPage canManage types={types} workspaceId={workspaceId} />));
    await userEvent.click(screen.getByRole("button", { name: "New enquiry type" }));
    const dialog = await screen.findByRole("dialog", { name: "New enquiry type" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Name/ }), "Wardrobes");
    await userEvent.click(within(within(dialog).getByRole("region", { name: "Copy steps from another type" })).getByRole("button", { name: /Interior design/ }));
    expect(JSON.parse(String(calls(fetcher, "POST")[0][1].body))).toMatchObject({ label: "Wardrobes", copyFromTypeId: interior });
  });

  it("shows the error state with a retry when the types could not be loaded", () => {
    render(wrap(<EnquiryTypesPage canManage loadError types={[]} workspaceId={workspaceId} />));
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New enquiry type" })).toBeNull();
  });

  it("tells people without the permission that they cannot open it", () => {
    render(wrap(<EnquiryTypesPage canManage={false} types={[]} workspaceId={workspaceId} />));
    expect(screen.queryByRole("button", { name: "New enquiry type" })).toBeNull();
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

describe("Steps builder", () => {
  it("names the enquiry type with its colour, publishes changes, and returns to Enquiry types on Esc", async () => {
    const definition: FlowDefinition = { schema: 1, columns: ["qualified", "won"], branches: [],
      steps: [{ key: "payment_proof", name: "Attach the payment proof", role: "sales", check: "payment_proof_attached", column: "won" }] };
    render(wrap(<FlowBuilder answerOptions={{}} canManage columnNames={{}} roles={[]} workspaceId={workspaceId}
      flow={{ id: "11111111-1111-4111-8111-111111111111", code: "interior_design", name: "Interior design", status: "active", version: 3, selected: { version: 3, definition },
        enquiryType: { id: interior, code: "interior_design", label: "Interior design", color: 2, status: "active", version: 4 } }} />));
    const title = screen.getByRole("heading", { level: 1, name: "Interior design" });
    expect(title.querySelector("[data-hue='2']")).not.toBeNull();
    expect(screen.getByText("Version 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish changes" })).toBeDisabled();
    // The top bar names the type only: no flow, no "used by".
    expect(title.closest("header")!.textContent).not.toMatch(/flow|used by/i);
    expect(screen.getByRole("link", { name: "Back to Enquiry types" })).toHaveAttribute("href", "/workspace/enquiry-types");
    await userEvent.keyboard("{Escape}");
    expect(push).toHaveBeenCalledWith("/workspace/enquiry-types");
  });
});
