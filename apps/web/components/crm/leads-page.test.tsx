import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leadsPageFixture, type CrmLeadListItem } from "@/lib/crm/leads";
import { LeadsPage } from "./leads-page";

vi.mock("next/font/google", () => ({ Caveat: () => ({ variable: "note-font" }) }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LeadsPage", () => {
  it("uses the shared record grid with avatars, source chips and search", async () => {
    const interaction = userEvent.setup();
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} />);

    expect(screen.getByRole("heading", { name: "Leads" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Lead records" })).not.toBeInTheDocument();
    const table = screen.getByRole("table", { name: "CRM leads" });
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(within(table).getByRole("columnheader", { name: /Stage/i })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /Source/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kanban" })).not.toBeInTheDocument();
    expect(table.closest(".wd-data-grid")).toHaveAttribute("data-appearance", "card");
    expect(within(table).getByRole("img",{name:"Dr Maya Nair"})).toBeInTheDocument();
    await interaction.type(screen.getByRole("searchbox", { name: "Search leads" }), "Emirates Hills");
    expect(screen.getByText("Emirates Hills villa interior renovation")).toBeInTheDocument();
    expect(screen.queryByText("Dubai wellness clinic design")).not.toBeInTheDocument();

    expect(within(screen.getByRole("table", { name: "CRM leads" })).getAllByRole("row")).toHaveLength(2);

    await interaction.clear(screen.getByRole("searchbox", { name: "Search leads" }));
    expect(screen.getByText("Dubai wellness clinic design")).toBeInTheDocument();
  });

  it("opens workspace enquiry-type configuration from the lead toolbar", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ taxonomies: [] }) }));
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} />);

    await user.click(screen.getByRole("button", { name: "Enquiry types" }));

    expect(await screen.findByRole("heading", { name: "Workspace enquiry options" })).toBeInTheDocument();
    expect(screen.getByText(/choices belong only to this workspace/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enquiry types Manage" })).toHaveTextContent("Enquiry types");
  });

  it("shows exactly four stages and groups older active statuses under Initiated", async () => {
    const user = userEvent.setup();
    const data = structuredClone(leadsPageFixture);
    data.items = ["attempting_contact", "connected", "nurturing", "paused"].map((status, i) => ({ ...data.items[0], id: `legacy-${i}`, partyName: `Legacy ${i}`, status: status as CrmLeadListItem["status"] }));
    render(<LeadsPage initialData={data} />);
    await user.click(screen.getByRole("button", { name: /Stage for Legacy 0/ }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["New", "Initiated", "Qualified", "Disqualified"]);
    await user.keyboard("{Escape}");
    await filterLeads(user, "Stage", "Initiated");
    expect(within(screen.getByRole("table", { name: "CRM leads" })).getAllByRole("row")).toHaveLength(5);
  });

  it("provides a Pre-execution link immediately after qualification succeeds", async () => {
    const user = userEvent.setup(), data = structuredClone(leadsPageFixture), lead = data.items[0];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...lead, status: "qualified", version: lead.version + 1, nextActionAt: null }) }));
    render(<LeadsPage initialData={data} />);
    await chooseOption(user, /Stage for Dr Maya Nair/, "Qualified");
    expect(await screen.findByText("Dr Maya Nair moved to Qualified.")).toBeInTheDocument();
    const row = screen.getByRole("button", { name: /Stage for Dr Maya Nair/ }).closest("tr")!;
    expect(within(row).getByRole("link", { name: /Open Pre-execution/ })).toHaveAttribute("href", `/workspace/pre-projects?search=${encodeURIComponent(lead.title)}`);
  });

  it("opens the existing lead inspector from the table", async () => {
    const interaction = userEvent.setup();
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} />);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => leadsPageFixture.items[0] }));
    await interaction.click(screen.getByRole("button", { name: /Amira Al Mansoori.*Emirates Hills/ }));
    const dialog = await screen.findByRole("dialog", { name: "Amira Al Mansoori" });
    expect(within(dialog).getByRole("tab", { name: "Details" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Requirement notes" })).toBeInTheDocument();
    expect(within(dialog).getByText("Next follow-up")).toBeInTheDocument();
  });

  it("assigns from the table, preserves other rows, and uses the returned version for auto-assignment", async () => {
    const user = userEvent.setup();
    const data = structuredClone(leadsPageFixture);
    const lead = data.items[0];
    const manager = { ...data.members[0], id: "10000000-0000-4000-8000-000000000099", displayName: "New lead manager" };
    data.members.push(manager);
    const saved = { id: lead.id, ownerMembershipId: manager.id, queueId: lead.queueId, nextActionAt: lead.nextActionAt, status: lead.status, updatedAt: lead.updatedAt, version: lead.version + 1 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => saved });
    vi.stubGlobal("fetch", fetchMock);
    render(<LeadsPage initialData={data} />);
    await user.click(screen.getByRole("button", { name: `Assign ${lead.partyName}` }));
    let dialog = await screen.findByRole("dialog", { name: "Reassign lead" });
    await user.click(within(dialog).getByRole("radio", { name: /New lead manager/ }));
    await user.click(within(dialog).getByRole("button", { name: "Reassign" }));
    await waitFor(() => expect(within(screen.getByRole("button", { name: `Assign ${lead.partyName}` })).getByRole("img", { name: manager.displayName })).toBeInTheDocument());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ version: lead.version, ownerMembershipId: manager.id, queueId: lead.queueId });
    expect(within(screen.getByRole("table", { name: "CRM leads" })).getAllByRole("row")).toHaveLength(data.items.length + 1);
    await user.click(screen.getByRole("button", { name: `Assign ${lead.partyName}` }));
    dialog = await screen.findByRole("dialog", { name: "Reassign lead" });
    await user.click(within(dialog).getByRole("radio", { name: "Auto-assign" }));
    await user.click(within(dialog).getByRole("button", { name: "Reassign" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toContain(`/auto-assign?version=${saved.version}`);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({});
  });

  it("keeps the original assignment when the server rejects a change", async () => {
    const user = userEvent.setup();
    const data = structuredClone(leadsPageFixture), lead = data.items[0];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ message: "Lead changed; reload and try again" }) }));
    render(<LeadsPage initialData={data} />);
    await user.click(screen.getByRole("button", { name: `Assign ${lead.partyName}` }));
    const dialog = await screen.findByRole("dialog", { name: "Reassign lead" });
    await user.click(within(dialog).getByRole("radio", { name: "Auto-assign" }));
    await user.click(within(dialog).getByRole("button", { name: "Reassign" }));
    expect(await within(dialog).findByText("Lead changed; reload and try again")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(within(screen.getByRole("button", { name: `Assign ${lead.partyName}` })).getByRole("img", { name: lead.ownerName! })).toBeInTheDocument();
  });

  it.each(["automatic", "unassigned"])("creates the enquiry and initial %s routing in one request", async (mode) => {
    const user = userEvent.setup();
    const createdLead: CrmLeadListItem = { ...structuredClone(leadsPageFixture.items[0]), id: "62000000-0000-4000-8000-000000000098", reference: "E-0006", partyName: "Layla Karim", title: "E-0006", version: 2 };
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url === "/api/workspace/crm/leads" ? { status: "ready", leadId: createdLead.id, reference: createdLead.reference } : url.includes("/data/leads/") ? createdLead : { data: [createdLead, ...structuredClone(leadsPageFixture.items)], nextCursor: null } }));
    vi.stubGlobal("fetch", fetchMock);
    const fixture = structuredClone(leadsPageFixture);
    fixture.leadOptions = { sources: [{id:"company",label:"Company"}], channels: {company:[{id:"call",label:"Call"}]}, enquiryTypes: [{id:"not_sure",label:"Not Sure Yet"}], customerTypes: [], budgetRanges: [] };
    render(<LeadsPage initialData={fixture} />);
    await user.click(screen.getByRole("button", { name: "Add lead" }));
    const dialog = await screen.findByRole("dialog", { name: "Add lead" });
    await user.type(within(dialog).getByLabelText(/Customer name/), "Layla Karim");
    await user.click(within(dialog).getByRole("button", { name: /Assignment/ }));
    await user.click(screen.getByRole("option", { name: mode === "automatic" ? "Use routing rules" : "Leave unassigned" }));
    await user.click(within(dialog).getByRole("button", { name: "Create lead" }));
    expect(await screen.findByText("Lead created.")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspace/crm/leads");
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, {body:string}])[1].body);
    expect(body).toMatchObject({ displayName: "Layla Karim", title: "", assignment: { mode }, source: "company", channel: "call" });
    expect(fetchMock.mock.calls.some(([url]) => url.includes("/auto-assign"))).toBe(false);
    expect(screen.getAllByText("E-0006").length).toBeGreaterThan(0);
  }, 15000);

  it("loads the next backend cursor without duplicating leads", async () => {
    const interaction = userEvent.setup();
    const nextLead: CrmLeadListItem = {
      ...structuredClone(leadsPageFixture.items[0]),
      id: "62000000-0000-4000-8000-000000000099",
      partyName: "Omar Al Ketbi",
      title: "Downtown hospitality lounge",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [structuredClone(leadsPageFixture.items[0]), nextLead], nextCursor: null }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LeadsPage initialData={{ ...structuredClone(leadsPageFixture), nextCursor: "fixture-next-page" }} />);

    await interaction.click(screen.getByRole("button", { name: "Load more leads" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(String(fetchMock.mock.calls[0][0])).toContain(`workspaceId=${leadsPageFixture.workspaceId}`);
    expect(String(fetchMock.mock.calls[0][0])).toContain("cursor=fixture-next-page");
    expect(await screen.findByText("Downtown hospitality lounge")).toBeInTheDocument();
    expect(screen.getAllByText("Dubai wellness clinic design")).toHaveLength(1);
    expect(screen.getByText("6/6 rows")).toBeInTheDocument();
  });

  it("filters independently by source and status and resets to all leads", async () => {
    const interaction = userEvent.setup();
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} />);
    await filterLeads(interaction, "Source", "Instagram");
    await filterLeads(interaction, "Stage", "Qualified");
    expect(screen.getByText("Emirates Hills villa interior renovation")).toBeInTheDocument();
    expect(screen.queryByText("Jumeirah neighbourhood café concept")).not.toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Filter" }));
    await interaction.click(screen.getByRole("button", { name: "Clear filters" }));
    await interaction.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("Jumeirah neighbourhood café concept")).toBeInTheDocument();
    expect(screen.getByText("Dubai wellness clinic design")).toBeInTheDocument();
  }, 15000);

  it("saves status with the current version and uses the returned version for the next change", async () => {
    const interaction = userEvent.setup();
    const lead = structuredClone(leadsPageFixture.items[0]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...lead, status: "new", version: lead.version + 1 }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} />);
    await chooseOption(interaction, /Stage for Dr Maya Nair/, "New");
    expect(await screen.findByText("Dr Maya Nair moved to New.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`/api/workspace/crm/leads/${lead.id}/status`, expect.objectContaining({ method: "POST", body: JSON.stringify({ workspaceId: leadsPageFixture.workspaceId, version: lead.version, status: "new" }) }));
    expect(screen.getByRole("button", { name: /Stage for Dr Maya Nair/ })).toHaveTextContent("New");
    // A second move uses the returned server version, not the stale initial version.
    await chooseOption(interaction, /Stage for Dr Maya Nair/, "Qualified");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).version).toBe(lead.version + 1);
  });

  it("keeps a lead in its original status when the API rejects a move", async () => {
    const interaction = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ message: "Lead changed; reload and try again" }) }));
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} />);
    await chooseOption(interaction, /Stage for Dr Maya Nair/, "New");
    expect(await screen.findByText("Lead changed; reload and try again")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stage for Dr Maya Nair/ })).toHaveTextContent("Initiated");
  });

  it("keeps converted deals visible but disables lead status changes", () => {
    const fixture = structuredClone(leadsPageFixture);
    fixture.items[4].isConverted = true;
    render(<LeadsPage initialData={fixture} />);
    expect(screen.getByRole("button", { name: /Stage for Amira Al Mansoori/ })).toBeDisabled();
    expect(screen.getByRole("link", {name: /Open Pre-execution/})).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Amira Al Mansoori/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move Amira Al Mansoori" })).not.toBeInTheDocument();
  });

  it("requires a follow-up when reopening an unassigned lead", async () => {
    const interaction = userEvent.setup();
    const fixture = structuredClone(leadsPageFixture);
    fixture.items[3].status = "qualified";
    fixture.items[3].ownerMembershipId = null;
    fixture.items[3].ownerName = null;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...fixture.items[3], status: "connected", version: 4, nextActionAt: "2026-09-20T09:30:00.000Z" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<LeadsPage initialData={fixture} />);
    await chooseOption(interaction, /Stage for Noura Haddad/, "Initiated");
    const dialog = await screen.findByRole("dialog", { name: "Move to Initiated" });
    const date = within(dialog).getByLabelText(/Next follow-up/);
    expect(date).toHaveAttribute("type", "datetime-local");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(date, { target: { value: "2026-09-20T09:30" } });
    await interaction.click(within(dialog).getByRole("button", { name: "Save stage" }));
    expect(await screen.findByText("Noura Haddad moved to Initiated.")).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).nextActionAt).toBe(new Date("2026-09-20T09:30").toISOString());
  });

  it("requires a reason to disqualify a lead and leaves cancellation unchanged", async () => {
    const interaction = userEvent.setup();
    const lead = leadsPageFixture.items[0];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...lead, status: "disqualified", version: lead.version + 1, nextActionAt: null }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} />);
    await chooseOption(interaction, /Stage for Dr Maya Nair/, "Disqualified");
    let dialog = await screen.findByRole("dialog", { name: "Move to Disqualified" });
    await interaction.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Stage for Dr Maya Nair/ })).toHaveTextContent("Initiated");
    await chooseOption(interaction, /Stage for Dr Maya Nair/, "Disqualified");
    dialog = await screen.findByRole("dialog", { name: "Move to Disqualified" });
    await interaction.type(within(dialog).getByLabelText(/Reason/), "Client asked to wait until next month");
    await interaction.click(within(dialog).getByRole("button", { name: "Save stage" }));
    expect(await screen.findByText("Dr Maya Nair moved to Disqualified.")).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reason).toBe("Client asked to wait until next month");
    expect(screen.getByRole("button", { name: /Stage for Dr Maya Nair/ })).toHaveTextContent("Disqualified");
  });

  it("shows a permission state instead of an empty data grid", () => {
    render(<LeadsPage initialData={{ ...structuredClone(leadsPageFixture), canView: false, items: [] }} />);

    expect(screen.getByText("Lead access is restricted")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "CRM leads" })).not.toBeInTheDocument();
  });
});

async function chooseOption(interaction: ReturnType<typeof userEvent.setup>, label: RegExp, option: string) {
  await interaction.click(screen.getByRole("button", { name: label }));
  await interaction.click(await screen.findByRole("option", { name: option }));
}


async function filterLeads(user: ReturnType<typeof userEvent.setup>, column: string, value: string) {
  await user.click(screen.getByRole('button',{name:'Filter'}));
  await chooseOption(user, /Column$/, column);
  await chooseOption(user, new RegExp(`Filter by ${column.toLowerCase()}`), value);
  await user.click(screen.getByRole('button',{name:'Done'}));
}
