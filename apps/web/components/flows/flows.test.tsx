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
import { FlowStepsList } from "./flow-builder";
import { FlowPalette } from "./flow-palette";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));

const workspaceId = "e56299c6-3da3-402a-a9ac-3995bb37b9d4";
const design = "11111111-1111-4111-8111-111111111111";
const basic = "22222222-2222-4222-8222-222222222222";
const flows: FlowSummary[] = [
  { id: design, code: "design", name: "Design", status: "active", version: 3, runningJobs: 12,
    latest: { id: "v3", version: 3, source: "published", publishedAt: "2026-10-02T09:00:00Z", publishedBy: "Maya Admin" },
    usedBy: [{ id: "33333333-3333-4333-8333-333333333333", code: "interior_design", label: "Interior design", version: 4 }] },
  { id: basic, code: "basic", name: "Basic", status: "active", version: 1, runningJobs: 0,
    latest: { id: "v1", version: 1, source: "starter", publishedAt: "2026-09-30T09:00:00Z", publishedBy: null }, usedBy: [] },
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

describe("Flows list", () => {
  it("lists each flow with the enquiry types using it, running jobs and its latest version", () => {
    render(wrap(<FlowsListPage canManage flows={flows} workspaceId={workspaceId} />));
    expect(screen.getByRole("heading", { level: 1, name: "Flows" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Flows" });
    const row = within(table).getByRole("link", { name: "Design" }).closest("tr")!;
    expect(row).toHaveTextContent("Interior design");
    expect(row).toHaveTextContent("12");
    expect(row).toHaveTextContent("v3");
    expect(within(row).getByRole("img", { name: "Maya Admin" })).toBeInTheDocument();
    expect(within(table).getByRole("link", { name: "Basic" }).closest("tr")).toHaveTextContent("Starter");
    expect(screen.getAllByRole("button", { name: "New flow" })).toHaveLength(1);
  });

  it("points an enquiry type at another flow with its version", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ id: "x", version: 5 }) }));
    vi.stubGlobal("fetch", fetcher);
    render(wrap(<FlowsListPage canManage flows={flows} workspaceId={workspaceId} />));
    const types = screen.getByRole("table", { name: "Enquiry types" });
    await userEvent.click(within(types).getByRole("button", { name: /Flow for Interior design/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Basic" }));
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/workspace/crm/data/flows/${basic}/enquiry-types/33333333-3333-4333-8333-333333333333?workspaceId=${workspaceId}`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ version: 4 });
    expect(await screen.findByText("Interior design now follows Basic")).toBeInTheDocument();
  });

  it("creates a new flow from a starter and opens it", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ id: "44444444-4444-4444-8444-444444444444", created: true }) }));
    vi.stubGlobal("fetch", fetcher);
    render(wrap(<FlowsListPage canManage flows={flows} workspaceId={workspaceId} />));
    await userEvent.click(screen.getByRole("button", { name: "New flow" }));
    const dialog = await screen.findByRole("dialog", { name: "New flow" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Name/ }), "Villa design");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create flow" }));
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/workspace/crm/data/flows?workspaceId=${workspaceId}`);
    expect(JSON.parse(String(init.body))).toEqual({ name: "Villa design", starter: "design" });
    expect(push).toHaveBeenCalledWith("/workspace/flows/44444444-4444-4444-8444-444444444444");
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
