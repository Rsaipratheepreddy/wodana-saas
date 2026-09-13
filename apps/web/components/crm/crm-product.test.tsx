import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { crmScreenFixture } from "@/lib/crm/screens";
import { CrmScreenPage } from "./crm-screen-page";
import { crmRecordLink } from "./crm-product-shell";

afterEach(() => vi.unstubAllGlobals());
const response = (payload: unknown, status = 200) => ({ ok: status < 400, status, json: async () => payload });

describe("CRM product workflows", () => {
  it("opens a lead-source tooltip when a chart month is clicked", async () => {
    const user = userEvent.setup();
    const fixture = structuredClone(crmScreenFixture("crm-overview"));
    render(<CrmScreenPage initialData={fixture} />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    const april = screen.getByRole("button", { name: "Show Apr lead source details" });
    await user.click(april);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Apr · 5 leads");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Website 3");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Instagram 2");
    expect(april).toHaveAttribute("aria-expanded", "true");
  });

  it("opens actionable priority links and uses totals instead of capped list counts", () => {
    const fixture = structuredClone(crmScreenFixture("crm-overview"));
    fixture.supporting.summary = { pendingFollowUps: 1250, wonThisMonth: null };
    render(<CrmScreenPage initialData={fixture} />);
    expect(screen.getByText("1,250")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Active follow-ups/ })).toHaveAttribute("href", "/workspace/crm/follow-ups");
    expect(crmRecordLink({ deepLink: "/crm/leads/78000000-0000-4000-8000-000000000001" })).toBe("/workspace/crm/leads?lead=78000000-0000-4000-8000-000000000001");
    expect(crmRecordLink({ deepLink: "javascript:alert(1)" })).toBe("/workspace/crm/follow-ups");
  });

  it("edits and saves a complete workflow graph without publishing it", async () => {
    const user = userEvent.setup(); const fixture = structuredClone(crmScreenFixture("automations")); const record = fixture.items[0];
    const definition = { nodes: [{ key: "start", type: "trigger", configuration: { eventTypes: ["crm.enquiry.ready.v1"] } }, { key: "task", type: "create_task", configuration: { title: "Call customer", priority: "high", delayMinutes: 30, isNextAction: true, retainedCustomFlag: true } }, { key: "end", type: "end", configuration: {} }], edges: [{ from: "start", to: "task" }, { from: "task", to: "end" }] };
    const detail = { ...record, definition, version: 2, draftVersionNumber: 1, validation: { valid: true, errors: [], warnings: [] } };
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => response(init?.method === "PATCH" ? { ...detail, version: 3 } : input.includes(`/automations/${record.id}?`) ? detail : fixture.items));
    vi.stubGlobal("fetch", fetcher); render(<CrmScreenPage initialData={fixture} initialRecordId={record.id} />);
    await user.click(await screen.findByRole("button", { name: "Step list" }));
    await user.click(await screen.findByRole("button", { name: /Create Task.*Call customer/ }));
    const input = screen.getByLabelText("Task title"); await user.clear(input); await user.type(input, "Call within one hour");
    await user.click(screen.getByRole("button", { name: /Save draft/ }));
    const dialog = await screen.findByRole("dialog", { name: "Save workflow draft" }); await user.click(within(dialog).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
    const body = JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "PATCH")?.[1]?.body));
    expect(body.definition.nodes[1].configuration).toMatchObject({ title: "Call within one hour", retainedCustomFlag: true });
    expect(body.definition.edges).toEqual(definition.edges);
    expect(fetcher.mock.calls.some(([input]) => input.includes("/publish"))).toBe(false);
  });
});
