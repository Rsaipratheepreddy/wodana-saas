import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider, ToastProvider } from "@/design-system";
import type { FlowDefinition, FlowDetail, FlowStep } from "@/lib/flows/flow-model";
import { StepsTableEditor } from "./steps-table";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));

const workspaceId = "e56299c6-3da3-402a-a9ac-3995bb37b9d4";
const flowId = "11111111-1111-4111-8111-111111111111";
const typeId = "33333333-3333-4333-8333-333333333333";
const COLUMNS = ["qualified", "qualification", "proposal", "negotiation", "won"];
const step = (key: string, name: string, check: FlowStep["check"], column: string, extra: Partial<FlowStep> = {}): FlowStep => ({ key, name, role: "sales", check, column, ...extra });
/** Furniture: sub-paths A–E, feasibility only for bespoke (the starter), material selection before the quotation. */
const furniture = (withMaterials = true): FlowDefinition => ({
  schema: 1, columns: COLUMNS,
  steps: [
    step("sub_path", "Choose the sub-path", "sub_path_chosen", "qualification"),
    step("client_type", "Set the client type", "client_type_set", "qualification"),
    ...(withMaterials ? [step("material_selection", "Choose the materials", "design_stage_done", "proposal", { designStage: "material_selection" })] : []),
    step("quotation", "Prepare the quotation", "quote_exists", "proposal"),
    step("negotiation", "Agree the deal with the client", "client_approved_on_spot", "negotiation", { optional: true }),
    step("payment_proof", "Attach the payment proof", "payment_proof_attached", "won"),
  ],
  branches: [{ key: "sub_path_branch", question: "subPath", after: "client_type", rejoin: withMaterials ? "material_selection" : "quotation", answers: [
    { value: "take_home_now", steps: [] }, { value: "in_stock_delivery", steps: [] }, { value: "supplier_order", steps: [] }, { value: "core_collection_factory", steps: [] },
    { value: "bespoke", steps: [step("feasibility", "Confirm feasibility with the factory", "feasibility_confirmed", "qualification", { role: "factory_lead" })] },
  ] }],
});
const detail = (definition: FlowDefinition): FlowDetail => ({
  id: flowId, code: "furniture", name: "Furniture", status: "active", version: 2, selected: { version: 2, definition },
  enquiryType: { id: typeId, code: "furniture", label: "Furniture only", color: 3, status: "active", version: 1 },
});
const roles = [{ code: "sales", name: "Account Manager" }, { code: "factory_lead", name: "Factory" }];
const wrap = (node: React.ReactNode) => <DesignSystemProvider locale="en-US" timeZone="UTC"><ToastProvider>{node}</ToastProvider></DesignSystemProvider>;

type Route = (path: string, init: RequestInit) => { status?: number; body: unknown } | undefined;
function stubFetch(route: Route) {
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = decodeURIComponent(url.replace(/^\/api\/workspace\/crm\/data\//, "").split("?")[0]);
    const reply = route(path, init) ?? { status: 404, body: { message: "Not found" } };
    return { ok: (reply.status ?? 200) < 400, status: reply.status ?? 200, json: async () => reply.body };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const sent = (fetcher: ReturnType<typeof stubFetch>, path: string) => (fetcher.mock.calls as unknown as Array<[string, RequestInit]>)
  .filter(([url, init]) => url.includes(`/crm/data/${path}?`) && init?.method === "POST").map(([, init]) => JSON.parse(String(init.body)));
const closing = { flowId, events: [], furniturePaths: [], rules: [{ furniturePath: null, closingEvent: "delivered", version: 1 }, { furniturePath: "take_home_now", closingEvent: "collected", version: 1 }] };
const base: Route = (path) => path === `flows/${flowId}/closing` ? { body: closing } : path === `flows/${flowId}/migration` ? { body: { toVersion: 2, jobs: [], truncated: false } } : undefined;
const show = (definition = furniture(), route: Route = base) => {
  const fetcher = stubFetch(route);
  render(wrap(<StepsTableEditor answerOptions={{}} canManage columnNames={{ qualification: "Qualified" }} flow={detail(definition)} roles={roles} workspaceId={workspaceId} />));
  return fetcher;
};
const cell = (step: string, path: RegExp) => screen.getByRole("button", { name: new RegExp(`^${step} on ${path.source}`) });

afterEach(() => { vi.unstubAllGlobals(); push.mockReset(); });

describe("Steps in CeCe's words (plan §6.9a)", () => {
  it("shows stages as rows, the paths A–E as columns, each cell's rule, owner and lead time, and the closing event", async () => {
    show();
    expect(screen.getByRole("heading", { level: 1, name: "Furniture only" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Steps" });
    const headers = [...table.querySelectorAll("thead th")].map((header) => header.textContent);
    expect(headers).toEqual(["Step", "A · Take home now", "B · In-stock delivery", "C · Supplier order", "D · Core collection", "E · Bespoke"]);
    // Stages are the group rows, in order, with the workspace's own names.
    expect(within(table).getByText("Qualified")).toBeInTheDocument();
    expect(cell("Confirm feasibility with the factory", /A · Take home now/)).toHaveTextContent("Skipped");
    expect(cell("Confirm feasibility with the factory", /E · Bespoke/)).toHaveTextContent("Required");
    expect(cell("Confirm feasibility with the factory", /E · Bespoke/)).toHaveTextContent("Factory");
    expect(cell("Agree the deal with the client", /B · In-stock delivery/)).toHaveTextContent("Used if needed");
    expect(screen.getByRole("button", { name: "Publish changes" })).toBeDisabled();
    // The type's closing event, per path.
    expect(await within(table).findAllByText("Collected by the client")).toHaveLength(1);
    expect(within(table).getAllByText("Delivered")).toHaveLength(4);
    expect(screen.getByRole("group", { name: "View" })).toBeInTheDocument();
  });

  it("shows the areas each path uses after Won (PLM-098), every area until the firm sets them", async () => {
    const areas = { flowId, areas: ["planning", "production", "supply", "delivery"], furniturePaths: ["take_home_now"],
      rules: [{ furniturePath: null, areas: ["supply", "delivery"], version: 1 }, { furniturePath: "take_home_now", areas: [], version: 1 }] };
    show(furniture(), (path, init) => path === `flows/${flowId}/won-areas` ? { body: areas } : base(path, init));
    const table = screen.getByRole("table", { name: "Steps" });
    expect(within(table).getByRole("button", { name: "Areas after Won" })).toBeInTheDocument();
    expect(await within(table).findAllByText("None")).toHaveLength(1);
    expect(within(table).getAllByText("Supply, Delivery")).toHaveLength(4);
  });

  it("edits a cell (Auto-passed on A) and publishes the same flow definition as a new version", async () => {
    const fetcher = show(furniture(), (path, init) => base(path, init)
      ?? (path === "flows/validate" ? { body: { valid: true, errors: [] } } : path === `flows/${flowId}/versions` ? { body: { version: 3, created: true } } : undefined));
    await userEvent.click(cell("Confirm feasibility with the factory", /A · Take home now/));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /Rule/ }));
    await userEvent.click(screen.getByRole("option", { name: "Auto-passed" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(cell("Confirm feasibility with the factory", /A · Take home now/)).toHaveTextContent("Auto-passed");
    await userEvent.click(screen.getByRole("button", { name: "Publish changes" }));
    await waitFor(() => expect(sent(fetcher, `flows/${flowId}/versions`)).toHaveLength(1));
    const [{ expectedVersion, definition }] = sent(fetcher, `flows/${flowId}/versions`);
    expect(expectedVersion).toBe(2);
    expect(definition.branches[0].answers[0].steps).toEqual([expect.objectContaining({ key: "feasibility_a", auto: true, role: "factory_lead" })]);
    expect(definition.branches[0].answers[4].steps).toEqual([expect.objectContaining({ key: "feasibility_e", check: "feasibility_confirmed" })]);
    expect(await screen.findByText("Version 3")).toBeInTheDocument();
  });

  it("lists every problem at once before publishing, and adds material selection in one step (PLM-081)", async () => {
    const fetcher = show(furniture(false), (path, init) => base(path, init) ?? (path === "flows/validate" ? { body: { valid: true, errors: [] } } : path === `flows/${flowId}/versions` ? { body: { version: 3 } } : undefined));
    // Negotiation on no path at all: two problems at once.
    for (const letter of ["A · Take home now", "B · In-stock delivery", "C · Supplier order", "D · Core collection", "E · Bespoke"]) {
      await userEvent.click(cell("Agree the deal with the client", new RegExp(letter)));
      const dialog = screen.getByRole("dialog");
      await userEvent.click(within(dialog).getByRole("button", { name: /Rule/ }));
      await userEvent.click(screen.getByRole("option", { name: "Skipped" }));
      await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    }
    await userEvent.click(screen.getByRole("button", { name: "Publish changes" }));
    const summary = screen.getByRole("alert");
    expect(within(summary).getByText("Fix these to publish")).toBeInTheDocument();
    expect(summary).toHaveTextContent("Material selection is always a step on furniture and joinery paths");
    expect(summary).toHaveTextContent("Agree the deal with the client: Used on no path");
    expect(sent(fetcher, "flows/validate")).toHaveLength(0);
    await userEvent.click(within(summary).getByRole("button", { name: "Add material selection" }));
    expect(cell("Choose the materials", /E · Bespoke/)).toHaveTextContent("Required");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Material selection is always a step");
  });

  it("shows the server's validation problems on their cells", async () => {
    show(furniture(), (path, init) => base(path, init) ?? (path === "flows/validate"
      ? { body: { valid: false, errors: [{ path: "branches[0].answers[4].steps[0].role", message: "Every step has a role" }, { path: "columns", message: "The last column is Won" }] } } : undefined));
    // Change one lead time so there is something to publish.
    await userEvent.click(cell("Prepare the quotation", /E · Bespoke/));
    const second = screen.getByRole("dialog");
    await userEvent.type(within(second).getByRole("textbox", { name: "Lead time" }), "5");
    await userEvent.click(within(second).getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByRole("button", { name: "Publish changes" }));
    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("Confirm feasibility with the factory · E · Bespoke: Every step has a role");
    expect(summary).toHaveTextContent("The last column is Won");
    expect(cell("Confirm feasibility with the factory", /E · Bespoke/)).toHaveAttribute("data-invalid");
  });

  it("keeps running jobs on their version; moving them is explicit, with a preview per job (E2-3)", async () => {
    const jobs = [{ opportunityId: "44444444-4444-4444-8444-444444444444", reference: "O-0012", title: "Sofa", owner: "Sara", fromVersion: 1,
      nowBefore: { key: "quotation", name: "Prepare the quotation" }, nowAfter: { key: "material_selection", name: "Choose the materials" },
      newlyMissing: [{ key: "designStage:material_selection", label: "Material selection done", stepKey: "material_selection" }], dropped: [], added: [], changed: true }];
    const fetcher = show(furniture(), (path, init) => path === `flows/${flowId}/migration`
      ? init.method === "POST" ? { body: { toVersion: 2, moved: [jobs[0].opportunityId], unchanged: [], skipped: [] } } : { body: { toVersion: 2, jobs, truncated: false } }
      : base(path, init));
    await userEvent.click(await screen.findByRole("button", { name: "1 jobs on older versions" }));
    const dialog = await screen.findByRole("dialog", { name: "Move jobs to version 2" });
    expect(dialog).toHaveTextContent("O-0012 Sofa");
    expect(dialog).toHaveTextContent("Now: Prepare the quotation → Choose the materials");
    expect(dialog).toHaveTextContent("Also needs: Material selection done");
    await userEvent.click(within(dialog).getByRole("button", { name: "Move 1 jobs" }));
    await waitFor(() => expect(sent(fetcher, `flows/${flowId}/migration`)).toEqual([{ toVersion: 2, opportunityIds: [jobs[0].opportunityId] }]));
  });

  it("asks before leaving unpublished changes for the canvas", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Canvas" }));
    expect(push).toHaveBeenCalledWith(`/workspace/enquiry-types/${typeId}?view=canvas`);
    push.mockReset();
    await userEvent.click(cell("Prepare the quotation", /A · Take home now/));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /Rule/ }));
    await userEvent.click(screen.getByRole("option", { name: "Used if needed" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByRole("button", { name: "Canvas" }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Leave without publishing?" })).toBeInTheDocument();
  });
});
