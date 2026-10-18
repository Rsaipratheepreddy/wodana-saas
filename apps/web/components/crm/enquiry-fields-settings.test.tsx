import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { LeadOptions } from "@/lib/crm/lead-options";
import { EnquiryFieldsSettings } from "./enquiry-fields-settings";

const options: LeadOptions = {
  sources: [{ id: "company", label: "Company" }], channels: { company: [{ id: "call", label: "Call" }] },
  enquiryTypes: [{ id: "full_id", label: "Full interior design" }, { id: "furniture", label: "Furniture only" }, { id: "not_sure", label: "Not sure yet" }],
  budgetRanges: [{ id: "not_sure", label: "Not sure yet" }], customerTypes: [], emirates: [{ id: "dubai", label: "Dubai" }], areas: {},
  teamRoles: { full_id: ["designer"], furniture: [] },
  requirements: { full_id: { email: "book_intro" }, furniture: { email: "book_intro" } },
};

function mockApi() {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  let sales = { takeoverCap: 2, unownedEscalationMinutes: 15, clientReviewMinutes: 30, duplicateWindowDays: 90, salesAdminMembershipId: null, internalNotesVisibility: "team", version: 3 };
  let state = { rules: { full_id: { email: "book_intro" }, furniture: { email: "book_intro" }, not_sure: {} }, versions: {} as Record<string, Record<string, number>> };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(url), method, body });
    if (String(url).includes("enquiry-fields")) return { ok: true, json: async () => ({ system: { email: { visible: true, version: 0 }, customerType: { visible: true, version: 0 }, area: { visible: true, version: 0 }, budgetRange: { visible: true, version: 0 }, summary: { visible: true, version: 0 } }, custom: [] }) };
    if (String(url).includes("enquiry-requirements") && method === "PUT") {
      for (const entry of body.types) state = { rules: { ...state.rules, [entry.enquiryType]: { ...state.rules[entry.enquiryType as "full_id"], address: entry.requiredAt } }, versions: { ...state.versions, [entry.enquiryType]: { email: 1, address: 1 } } };
      return { ok: true, json: async () => state };
    }
    if (String(url).includes("enquiry-requirements")) return { ok: true, json: async () => state };
    if (String(url).includes("sales-settings") && method === "PATCH") { sales = { ...sales, ...body, version: sales.version + 1 }; return { ok: true, json: async () => sales }; }
    if (String(url).includes("sales-settings")) return { ok: true, json: async () => sales };
    return { ok: true, json: async () => ({}) };
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("Sales settings › Fields", () => {
  it("shows which fields each enquiry type requires and saves a change per type, version-checked (PLM-096)", async () => {
    const calls = mockApi();
    const onOptionsSaved = vi.fn();
    const user = userEvent.setup();
    render(<DesignSystemProvider><EnquiryFieldsSettings workspaceId="ws" leadOptions={options} regionLabel="Emirate" onOptionsSaved={onOptionsSaved} /></DesignSystemProvider>);
    const table = await screen.findByRole("table", { name: "Enquiry fields" });
    expect(within(table).getByRole("columnheader", { name: /Required/ })).toBeInTheDocument();
    // The client's name is always required; the email is required by both types (before the intro, today's rule).
    await waitFor(() => expect(within(table).getByRole("button", { name: "Required: Email" })).toHaveTextContent("2 enquiry types"));
    expect(within(within(table).getByText("Customer name").closest("tr") as HTMLElement).getByText("Always")).toBeInTheDocument();
    // The designer role is a row of its own, for the types that ask for one.
    expect(within(table).getByRole("button", { name: "Required: Designer" })).toHaveTextContent("Not required");

    await user.click(within(table).getByRole("button", { name: "Required: Address" }));
    const sheet = await screen.findByRole("dialog", { name: "Address" });
    expect(within(sheet).queryByRole("button", { name: /Not sure yet/ })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: /Full interior design/ }));
    await user.click(screen.getByRole("option", { name: "Before converting" }));
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    expect(calls.find((call) => call.method === "PUT")).toMatchObject({ url: expect.stringContaining("enquiry-requirements/address"), body: { types: [{ enquiryType: "full_id", requiredAt: "convert", version: 0 }] } });
    await waitFor(() => expect(within(table).getByRole("button", { name: "Required: Address" })).toHaveTextContent("1 enquiry type"));
    expect(onOptionsSaved).toHaveBeenCalledWith(expect.objectContaining({ requirements: expect.objectContaining({ full_id: { email: "book_intro", address: "convert" } }) }));
  });

  it("sets who sees internal notes: the enquiry team by default, or everyone in Sales (PLM-024)", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    render(<DesignSystemProvider><EnquiryFieldsSettings workspaceId="ws" leadOptions={options} regionLabel="Emirate" /></DesignSystemProvider>);
    const notes = await screen.findByRole("button", { name: "Who sees internal notes" });
    await waitFor(() => expect(notes).toHaveTextContent("Enquiry team"));
    await user.click(notes);
    const sheet = await screen.findByRole("dialog", { name: "Internal notes" });
    expect(sheet).toHaveTextContent("Never shown to the client or on the portal.");
    await user.click(within(sheet).getByRole("radio", { name: /Everyone in Sales/ }));
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((call) => call.method === "PATCH")).toMatchObject({ body: { version: 3, internalNotesVisibility: "sales" } }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Who sees internal notes" })).toHaveTextContent("Everyone in Sales"));
  });
});
