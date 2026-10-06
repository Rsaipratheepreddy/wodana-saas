import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leadsPageFixture } from "@/lib/crm/leads";
import { LeadAssignmentDialog } from "./lead-assignment-dialog";
import { LeadRouting } from "./lead-operations";

afterEach(() => vi.unstubAllGlobals());

describe("Auto-assignment settings", () => {
  it("sets the unanswered-owner handoff on the selected queue", async () => {
    const user = userEvent.setup(), data = structuredClone(leadsPageFixture);
    data.queues[0].takeoverAfterMinutes = 60;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => ({ ok: true, json: async () => init.method === "PATCH" ? {} : url.includes("assignment-policies") ? data.assignmentPolicies : data.queues }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LeadRouting initialData={data} />);
    expect(await screen.findByText(/working minutes/i)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Lead handoff" }));
    const dialog = await screen.findByRole("dialog", { name: "Unanswered lead handoff" });
    const minutes = within(dialog).getByRole("textbox", { name: /Elapsed minutes before another sales owner/ });
    await user.clear(minutes);
    await user.type(minutes, "60");
    await user.click(within(dialog).getByRole("button", { name: "Save handoff" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init.method === "PATCH")).toBe(true));
    const call = fetchMock.mock.calls.find(([, init]) => init.method === "PATCH")!;
    expect(String(call[0])).toContain(`/queues/${data.queues[0].id}`);
    expect(JSON.parse(String(call[1].body))).toEqual({ version: data.queues[0].version, takeoverAfterMinutes: 60 });
  });
  it("updates capacity without clearing existing skills, languages, or territories", async () => {
    const user = userEvent.setup(), data = structuredClone(leadsPageFixture);
    const member = data.queues[0].members[0];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => ({ ok: true, json: async () => init.method === "PUT" ? {} : url.includes("assignment-policies") ? data.assignmentPolicies : data.queues }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LeadRouting initialData={data} />);
    await user.click(await screen.findByRole("button", { name: `Edit ${member.name}` }));
    const dialog = await screen.findByRole("dialog", { name: "Edit sales owner" });
    const capacity = within(dialog).getByRole("textbox", { name: /Maximum active enquiries/ });
    await user.clear(capacity); await user.type(capacity, "40");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init.method === "PUT")).toBe(true));
    const call = fetchMock.mock.calls.find(([, init]) => init.method === "PUT")!;
    expect(JSON.parse(String(call[1].body))).toMatchObject({ membershipId: member.membershipId, capacity: 40, skills: member.skills, languages: member.languages, territories: member.territories, weight: member.weight });
  });

  it("edits routing order with the current version and preserves matching rules", async () => {
    const user = userEvent.setup(), data = structuredClone(leadsPageFixture), policy = data.assignmentPolicies[0];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => ({ ok: true, json: async () => init.method === "PATCH" ? {} : url.includes("assignment-policies") ? data.assignmentPolicies : data.queues }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LeadRouting initialData={data} />);
    await user.click(await screen.findByRole("radio", { name: "Routing order" }));
    await user.click(await screen.findByRole("button", { name: `Edit ${policy.name}` }));
    const dialog = await screen.findByRole("dialog", { name: "Edit auto-assignment" });
    const order = within(dialog).getByRole("textbox", { name: /Order/ });
    await user.clear(order); await user.type(order, "5");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init.method === "PATCH")).toBe(true));
    const call = fetchMock.mock.calls.find(([, init]) => init.method === "PATCH")!;
    expect(JSON.parse(String(call[1].body))).toMatchObject({ version: policy.version, priority: 5, fallbackQueueId: policy.fallbackQueueId, preserveRelationshipOwner: true });
    expect(JSON.parse(String(call[1].body))).not.toHaveProperty("rules");
  });
  it("adds an existing active user to a queue through the shared dropdown", async () => {
    const user = userEvent.setup(), data = structuredClone(leadsPageFixture);
    data.queues[0].members = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => ({ ok: true, json: async () => init.method === "PUT" ? {} : url.includes("assignment-policies") ? data.assignmentPolicies : data.queues }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LeadRouting initialData={data} />);
    await user.click(await screen.findByRole("button", { name: "Add sales owner" }));
    const dialog = await screen.findByRole("dialog", { name: "Add sales owner" });
    await user.click(within(dialog).getByRole("button", { name: /Sales owner/ }));
    await user.click(await screen.findByRole("option", { name: data.members[0].displayName }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init.method === "PUT")).toBe(true));
    const call = fetchMock.mock.calls.find(([, init]) => init.method === "PUT")!;
    expect(JSON.parse(String(call[1].body))).toMatchObject({ membershipId: data.members[0].id, capacity: 25, weight: 1, isAvailable: true });
  });

});

it("keeps a successful assignment saved when refreshing fails and prevents another submission", async () => {
  const data = structuredClone(leadsPageFixture), lead = data.items[0];
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...lead, version: lead.version + 1 }) });
  vi.stubGlobal("fetch", fetchMock);
  const onClose = vi.fn(), onSaved = vi.fn().mockRejectedValue(new Error("Refresh unavailable"));
  render(<LeadAssignmentDialog lead={lead} members={data.members} workspaceId={data.workspaceId} onClose={onClose} onSaved={onSaved} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("radio", { name: "Auto-assign" }));
  await user.click(screen.getByRole("button", { name: "Reassign" }));
  expect(await screen.findByText("Assignment saved. Refresh the page to see the updated sales owner.")).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Reassign" })).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
