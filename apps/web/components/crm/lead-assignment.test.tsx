import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leadsPageFixture } from "@/lib/crm/leads";
import { LeadRouting } from "./lead-operations";

afterEach(() => vi.unstubAllGlobals());

describe("Auto-assignment settings", () => {
  it("updates capacity without clearing existing skills, languages, or territories", async () => {
    const user = userEvent.setup(), data = structuredClone(leadsPageFixture);
    const member = data.queues[0].members[0];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => ({ ok: true, json: async () => init.method === "PUT" ? {} : url.includes("assignment-policies") ? data.assignmentPolicies : data.queues }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LeadRouting initialData={data} />);
    await user.click(await screen.findByRole("button", { name: `Edit ${member.name}` }));
    const dialog = await screen.findByRole("dialog", { name: "Edit lead manager" });
    const capacity = within(dialog).getByRole("spinbutton", { name: /Maximum active leads/ });
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
    await user.click(await screen.findByRole("tab", { name: "Routing order" }));
    await user.click(await screen.findByRole("button", { name: `Edit ${policy.name}` }));
    const dialog = await screen.findByRole("dialog", { name: "Edit auto-assignment" });
    const order = within(dialog).getByRole("spinbutton", { name: /Order/ });
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
    await user.click(await screen.findByRole("button", { name: "Add lead manager" }));
    const dialog = await screen.findByRole("dialog", { name: "Add lead manager" });
    await user.click(within(dialog).getByRole("button", { name: /Lead manager/ }));
    await user.click(await screen.findByRole("option", { name: data.members[0].displayName }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init.method === "PUT")).toBe(true));
    const call = fetchMock.mock.calls.find(([, init]) => init.method === "PUT")!;
    expect(JSON.parse(String(call[1].body))).toMatchObject({ membershipId: data.members[0].id, capacity: 25, weight: 1, isAvailable: true });
  });

});
