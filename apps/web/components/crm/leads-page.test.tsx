import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leadsPageFixture, type CrmLeadListItem } from "@/lib/crm/leads";
import { integrationsPageFixture } from "@/lib/workspace/integrations";
import { LeadsPage } from "./leads-page";

vi.mock("next/font/google", () => ({ Caveat: () => ({ variable: "note-font" }) }));
const OWNER_ID_FOR_TEST = leadsPageFixture.members[0].id;
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LeadsPage", () => {
  it("opens lead-source connection setup within Sales", async () => {
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} integrationsData={{ ...structuredClone(integrationsPageFixture), connections: [] }} initialSection="sources" />);
    expect(screen.getByRole("group", { name: "Capture settings" })).toHaveTextContent("Lead sources");
    expect(screen.getByRole("button", { name: "Lead sources" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Sales lead source connections" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Meta Lead Ads integration" })).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("article", { name: "WhatsApp Business integration" })).getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("dialog", { name: "Connect WhatsApp Business" })).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });
  it("keeps enquiry column headers visible when no records exist", () => {
    render(<LeadsPage initialData={{ ...leadsPageFixture, items: [], nextCursor: null }} />);
    const table = screen.getByRole("table", { name: "CRM enquiries" });
    expect(within(table).getByRole("columnheader", { name: /Customer/ })).toBeInTheDocument();
    expect(within(table).getAllByRole("columnheader")[0].textContent?.trim()).toBe("Customer");
    expect(within(table).getByText("Your enquiries will appear here")).toBeInTheDocument();
    // The header action and the empty state's next action are the same action with the same label.
    expect(screen.getAllByRole("button", { name: "New enquiry" })[0]).toBeEnabled();
  });
  it("shows the workspace's own shown fields as columns and hides hidden fixed fields", () => {
    const data = structuredClone(leadsPageFixture);
    const rooms = "7d1b6c1e-2f0a-4c55-9d7e-0a1b2c3d4e5f";
    data.enquiryFields = {
      system: { email: { visible: true, version: 0 }, customerType: { visible: false, version: 1 }, area: { visible: true, version: 0 }, budgetRange: { visible: false, version: 1 }, summary: { visible: true, version: 0 } },
      custom: [
        { id: rooms, key: "rooms", label: "Rooms needed", dataType: "number", configuration: {}, visible: true, position: 1, version: 1 },
        { id: "8e2c7d2f-3a1b-4d66-8e8f-1b2c3d4e5f60", key: "secret", label: "Hidden field", dataType: "text", configuration: {}, visible: false, position: 2, version: 1 },
      ],
    };
    data.items[0].customFields = { [rooms]: 3 };
    render(<LeadsPage initialData={data} />);
    const table = screen.getByRole("table", { name: "CRM enquiries" });
    expect(within(table).getByRole("columnheader", { name: /Rooms needed/ })).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: /Hidden field/ })).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: /Budget range/ })).not.toBeInTheDocument();
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]).getByText("3")).toBeInTheDocument();
    expect(rows[2].querySelector(`[data-column="cf:${rooms}"]`)).toHaveTextContent("—");
  });
  it("uses the shared record grid with avatars, source chips and search", () => {
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} />);

    expect(screen.getByRole("region", { name: "Enquiries workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Lead records" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    const table = screen.getByRole("table", { name: "CRM enquiries" });
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(within(table).getByRole("columnheader", { name: /Status/i })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /Source/i })).toBeInTheDocument();
    // The default columns fit the content area at 1440 px, so the row actions stay in view (m1).
    expect(within(table).getByRole("columnheader", { name: /Source/i })).toHaveStyle({ inlineSize: "130px" });
    expect(within(table).getByRole("columnheader", { name: /Assigned to/i })).toHaveStyle({ inlineSize: "140px" });
    expect(within(table).getByRole("columnheader", { name: /Action/i })).toHaveStyle({ inlineSize: "120px" });
    expect(within(table).queryByRole("columnheader", { name: /Channel/i })).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: /Captured via/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kanban" })).not.toBeInTheDocument();
    expect(table.closest(".wd-table-scroll")).not.toBeNull();
    expect(within(table).getByRole("button",{name:/Open Dr Maya Nair/})).toBeInTheDocument();
    const search = screen.getByRole("searchbox", { name: "Search enquiries" });
    fireEvent.change(search, { target: { value: "Amira Al Mansoori" } });
    expect(screen.getByRole("button", { name: "Open Amira Al Mansoori" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Dr Maya Nair" })).not.toBeInTheDocument();

    expect(within(screen.getByRole("table", { name: "CRM enquiries" })).getAllByRole("row")).toHaveLength(2);

    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Open Dr Maya Nair" })).toBeInTheDocument();
  });

  it("shows a clean customer name and a separate enquiry ID for legacy records", () => {
    const data = structuredClone(leadsPageFixture);
    data.items = [{ ...data.items[0], partyName: "DEMO CLIENT · Sara Al Nuaimi", reference: "E-0042" }];
    render(<LeadsPage initialData={data} />);
    const table = screen.getByRole("table", { name: "CRM enquiries" });
    expect(within(table).getByRole("button", { name: "Open Sara Al Nuaimi" })).toHaveTextContent("Sara Al Nuaimi");
    expect(within(table).queryByText(/DEMO CLIENT/)).not.toBeInTheDocument();
    expect(within(table).getByText("E-0042")).toBeInTheDocument();
  });

  it("lists enquiry fields in settings and opens a field's choices", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => String(url).includes("enquiry-fields") ? { system: { email: { visible: true, version: 0 }, customerType: { visible: false, version: 1 }, area: { visible: true, version: 0 }, budgetRange: { visible: true, version: 0 }, summary: { visible: true, version: 0 } }, custom: [] } : { taxonomies: [] } })));
    const user = userEvent.setup();
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} initialSection="options" />);
    const table = await screen.findByRole("table", { name: "Enquiry fields" });
    expect(within(table).getByRole("switch", { name: "Show Customer type" })).not.toBeChecked();
    expect(within(table).getByRole("switch", { name: "Show Customer name" })).toBeDisabled();
    await user.click(within(table).getByText("Enquiry type"));
    expect(await screen.findByRole("region", { name: "Enquiry options" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /List$/ })).not.toBeInTheDocument();
  });

  it("shows Sales settings as one title with one row of tabs, and Assignment's views in that row", async () => {
    const data = structuredClone(leadsPageFixture);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => String(url).includes("assignment-policies") ? data.assignmentPolicies : data.queues })));
    const user = userEvent.setup();
    render(<LeadsPage initialData={data} initialSection="assignment" />);
    expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["Sales settings"]);
    const sections = screen.getByRole("group", { name: "Sales settings" });
    expect(within(sections).getAllByRole("button").map((tab) => tab.textContent)).toEqual(["Assignment", "Response targets", "Fields", "Automations"]);
    expect(within(sections).getByRole("button", { name: "Assignment" })).toHaveAttribute("aria-pressed", "true");
    // No third row of tabs: the views switch in the tabs row, one at a time.
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    const views = await screen.findByRole("radiogroup", { name: "Assignment settings" });
    expect(views.closest(".wd-page-shell-tabs")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Sales owners" })).toBeInTheDocument();
    await user.click(within(views).getByRole("radio", { name: "Routing rules" }));
    expect(screen.getByRole("button", { name: "Add rule" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sales owners" })).not.toBeInTheDocument();
    await user.click(within(sections).getByRole("button", { name: "Response targets" }));
    expect(router.push).toHaveBeenCalledWith("/workspace/crm/leads?section=sla");
    router.push.mockClear();
  });

  it("titles a settings section by itself when it's the only one a person may open", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ rules: [] }) })));
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} initialSection="automations" settingsSections={["automations"]} />);
    expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["Automations"]);
    expect(screen.queryByRole("group", { name: "Sales settings" })).not.toBeInTheDocument();
  });

  it("puts each enquiry in the list for its status with counts", async () => {
    const user = userEvent.setup();
    const data = structuredClone(leadsPageFixture);
    data.items = (["new", "attempting_contact", "connected", "nurturing", "paused", "disqualified"] as const).map((status, i) => ({ ...data.items[0], id: `lead-${i}`, partyName: `Client ${i}`, status, isConverted: false }));
    render(<LeadsPage initialData={data} />);
    const rows = () => within(screen.getByRole("table", { name: "CRM enquiries" })).getAllByRole("row").length - 1;
    expect(rows()).toBe(6);
    await user.click(screen.getByRole("button", { name: "Contacted" }));
    expect(rows()).toBe(3);
    await user.click(screen.getByRole("button", { name: "Come back to" }));
    expect(screen.getByRole("button", { name: "Open Client 4" })).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "CRM enquiries" })).getByText("Come back later")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^New\s*1$/ }));
    expect(screen.getByRole("button", { name: "Open Client 0" })).toBeInTheDocument();
  }, 20_000);

  it("starts a salesperson on their own new enquiries", () => {
    const data = structuredClone(leadsPageFixture);
    data.currentMembershipId = data.items[0].ownerMembershipId ?? "member-1";
    // A salesperson who can't assign enquiries, whatever their role is called.
    data.currentRoles = ["sales_account_manager"];
    data.canAssign = false;
    data.items = [{ ...data.items[0], id: "mine", partyName: "My Client", status: "new", ownerMembershipId: data.currentMembershipId, isConverted: false }, { ...data.items[0], id: "theirs", partyName: "Their Client", status: "new", ownerMembershipId: "someone-else", isConverted: false }];
    render(<LeadsPage initialData={data} />);
    expect(screen.getByRole("button", { name: "Open My Client" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Their Client" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Unassigned/ })).not.toBeInTheDocument();
  });

  it.each(["table action"])("converts a lead in one click through the %s and offers View opportunity (S-39)", async (entry) => {
    const user = userEvent.setup(), data = structuredClone(leadsPageFixture), lead = data.items[0];
    const converted = { ...lead, status: "qualified" as const, isConverted: true, version: lead.version + 1, nextActionAt: null };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(`/data/leads/${lead.id}/qualify`)) return { ok: true, json: async () => ({ id: "71000000-0000-4000-8000-000000000001", leadId: lead.id, title: lead.title }) };
      if (url.startsWith("/api/workspace/crm/leads?")) return { ok: true, json: async () => ({ data: data.items.map((item) => item.id === lead.id ? converted : item), nextCursor: null }) };
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LeadsPage initialData={data} />);

    expect(entry).toBe("table action");
    await user.click(screen.getByRole("button", { name: `Convert ${lead.partyName} to opportunity` }));
    // Converting can't be undone: nothing is sent until the user confirms.
    const confirm = await screen.findByRole("dialog", { name: `Convert ${lead.partyName} to an opportunity?` });
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Convert" }));
    // No form: what the enquiry already says is used, and the list stays with a link to the new opportunity.
    expect(await screen.findByRole("link", { name: "View opportunity" })).toHaveAttribute("href", "/workspace/crm/opportunities?record=71000000-0000-4000-8000-000000000001");
    expect(router.push).not.toHaveBeenCalled();
    const conversionRequest = fetchMock.mock.calls.find(call => call[0].includes(`/leads/${lead.id}/qualify`)) as unknown as [string, { body: string }];
    expect(JSON.parse(conversionRequest[1].body)).toMatchObject({
      partyId: lead.partyId,
      leadVersion: lead.version,
      pipelineId: data.pipelines[0].id,
      ownerMembershipId: lead.ownerMembershipId,
      title: lead.title,
      nextActionAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    const row = screen.getByRole("button", { name: /Open Dr Maya Nair/ }).closest("tr")!;
    expect(screen.queryByRole("dialog", { name: "Convert to opportunity" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("link", { name: /Planning/ })).not.toBeInTheDocument();
  }, 10_000);

  it("opens the existing lead inspector from the table", async () => {
    const interaction = userEvent.setup();
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} />);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => leadsPageFixture.items[0] }));
    await interaction.click(screen.getByRole("button", { name: "Open Amira Al Mansoori" }));
    const dialog = await screen.findByRole("dialog", { name: "Enquiry details" });
    // The record anatomy (§5c D.7): the page keeps its one h1; the record's title is its h2.
    expect(screen.getAllByRole("heading", { level: 1, hidden: true })).toHaveLength(1);
    // (The sheet keeps its own title for screen readers only.)
    expect(within(dialog).getAllByRole("heading", { level: 2 }).filter((heading) => !heading.closest(".wd-visually-hidden")).map((heading) => heading.textContent)).toEqual(["Amira Al Mansoori"]);
    // The status strip, then the next step with its one primary action, then the activity.
    const strip = within(dialog).getByLabelText("Enquiry properties");
    for (const name of ["Stage", "Owner", "Next follow-up", "Source"]) expect(within(strip).getByText(name)).toBeInTheDocument();
    const next = await within(dialog).findByRole("region", { name: "Ready to move forward?" });
    expect(within(next).getByRole("button", { name: "Convert to opportunity" })).toHaveAttribute("data-variant", "primary");
    expect(within(next).getByRole("button", { name: /Log contact/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("region", { name: "Activity" })).toBeInTheDocument();
    // The sidebar: Overview · Details · Files, Overview first.
    const side = within(dialog).getByRole("complementary", { name: "Enquiry details" });
    const tabs = within(side).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Overview", "Details", "Files"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(within(next).queryByRole("tab")).not.toBeInTheDocument();
    // Requirements, the source and the change history are sections of Details.
    await interaction.click(within(side).getByRole("tab", { name: "Details" }));
    for (const name of ["Requirements", "Source", "History"]) expect(within(side).getByRole("region", { name })).toBeInTheDocument();
  });

  it("closes the enquiry sheet before opening its linked opportunity, and names the state Converted", async () => {
    const interaction = userEvent.setup();
    const fixture = structuredClone(leadsPageFixture);
    fixture.items[4].isConverted = true;
    router.push.mockClear();
    render(<LeadsPage initialData={fixture} />);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...fixture.items[4], status: "qualified", opportunities: [{ id: "opp-1", title: "Villa kitchen" }] }) }));
    await interaction.click(screen.getByRole("button", { name: "Open Amira Al Mansoori" }));
    const dialog = await screen.findByRole("dialog", { name: "Enquiry details" });
    expect((await within(dialog).findAllByText("Converted")).length).toBeGreaterThan(0);
    await interaction.click(within(dialog).getByRole("link", { name: /Villa kitchen/ }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/workspace/crm/opportunities?record=opp-1"));
    expect(screen.queryByRole("dialog", { name: "Enquiry details" })).not.toBeInTheDocument();
  });

  it("edits an enquiry's details in place, sending the whole details with the enquiry's version", async () => {
    const data = structuredClone(leadsPageFixture);
    const lead = { ...data.items[0], version: 5 };
    data.items = [lead];
    const enquiry = { serviceType: lead.serviceType, partyName: lead.partyName, title: lead.title, summary: "Kitchen and majlis", primaryMobile: "0501234567",
      details: { emirate: "dubai", campaign: "", contact: { displayName: lead.partyName, mobile: "0501234567", mobileCountryCode: "AE", company: "" } } };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, status: 200, json: async () => init?.method === "PATCH" ? { id: lead.id, version: 6 } : url.includes(`/leads/${lead.id}`) ? { ...lead, enquiry } : { data: [lead], nextCursor: null } }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<LeadsPage initialData={data} />);
    await user.click(screen.getByRole("button", { name: `Open ${lead.partyName}` }));
    const dialog = await screen.findByRole("dialog", { name: "Enquiry details" });
    await user.click(await within(dialog).findByRole("tab", { name: "Details" }));
    await user.click(await within(dialog).findByRole("button", { name: "Edit Company" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Company" }), "Palm Holdings{Enter}");
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
    const [url, init] = fetchMock.mock.calls.find(([, call]) => call?.method === "PATCH")!;
    expect(url).toContain(`/leads/${lead.id}/details`);
    const body = JSON.parse(String(init!.body));
    expect(body).toMatchObject({ version: 5, serviceType: lead.serviceType, summary: "Kitchen and majlis", details: { emirate: "dubai" } });
    expect(body.party).toMatchObject({ displayName: lead.partyName, mobile: "0501234567", company: "Palm Holdings" });
  }, 10_000);

  it("shows an enquiry's details as plain text to people who can't change enquiries", async () => {
    const data = { ...structuredClone(leadsPageFixture), canEdit: false };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data.items[0] }));
    render(<LeadsPage initialData={data} />);
    await userEvent.click(screen.getByRole("button", { name: `Open ${data.items[0].partyName}` }));
    const dialog = await screen.findByRole("dialog", { name: "Enquiry details" });
    await userEvent.click(await within(dialog).findByRole("tab", { name: "Details" }));
    expect(await within(dialog).findByText("Company")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Edit Company" })).not.toBeInTheDocument();
  });

  it.each(["table action"])("routes a Not Sure Yet enquiry from %s to editing instead of deal creation", async entry => {
    const data = structuredClone(leadsPageFixture);
    const lead = { ...data.items[0], serviceType: "not_sure" };
    data.items = [lead];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...lead, enquiry: { serviceType: "not_sure", partyName: lead.partyName, title: lead.title } }) }));
    render(<LeadsPage initialData={data} />);
    const user = userEvent.setup();
    expect(entry).toBe("table action");
    await user.click(screen.getByRole("button", { name: `Choose enquiry type for ${lead.partyName}` }));
    const inspector = await screen.findByRole("dialog", { name: "Enquiry details" });
    expect(within(inspector).getByRole("button", { name: "Edit enquiry type" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Convert to opportunity" })).not.toBeInTheDocument();
  }, 10_000);

  it("shows a legacy customer name and repeated enquiry ID only once in the inspector", async () => {
    const user = userEvent.setup();
    const data = structuredClone(leadsPageFixture);
    const lead = data.items.find((item) => item.partyName === "Amira Al Mansoori")!;
    lead.partyName = "DEMO CLIENT · Sara Al Nuaimi";
    lead.reference = "E-0042";
    lead.title = "E-0042";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...lead, enquiry: { reference: lead.reference, title: lead.title, partyName: lead.partyName } }) }));
    render(<LeadsPage initialData={data} />);

    await user.click(screen.getByRole("button", { name: "Open Sara Al Nuaimi" }));
    const dialog = await screen.findByRole("dialog", { name: "Enquiry details" });
    expect(within(dialog).getByRole("heading", { name: "Sara Al Nuaimi" })).toBeInTheDocument();
    expect(within(dialog).getAllByText("E-0042")).toHaveLength(1);
    expect(within(dialog).getByRole("tab", { name: "Overview" })).toBeInTheDocument();
  });

  it("assigns from the table, preserves other rows, and uses the returned version for auto-assignment", async () => {
    const user = userEvent.setup();
    const data = structuredClone(leadsPageFixture);
    const lead = data.items[0];
    const manager = { ...data.members[0], id: "10000000-0000-4000-8000-000000000099", displayName: "New sales owner" };
    data.members.push(manager);
    data.salesOwners?.push(manager); // the dialog offers the server's assignable sales owners
    const saved ={ id: lead.id, ownerMembershipId: manager.id, queueId: lead.queueId, nextActionAt: lead.nextActionAt, status: lead.status, updatedAt: lead.updatedAt, version: lead.version + 1 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => saved });
    vi.stubGlobal("fetch", fetchMock);
    render(<LeadsPage initialData={data} />);
    await user.click(screen.getByRole("button", { name: `Assign ${lead.partyName}` }));
    let dialog = await screen.findByRole("dialog", { name: "Reassign enquiry" });
    await user.click(within(dialog).getByRole("radio", { name: /New sales owner/ }));
    await user.click(within(dialog).getByRole("button", { name: "Reassign" }));
    await waitFor(() => expect(within(screen.getByRole("button", { name: `Assign ${lead.partyName}` })).getByText(manager.displayName)).toBeInTheDocument());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ version: lead.version, ownerMembershipId: manager.id, queueId: lead.queueId });
    expect(within(screen.getByRole("table", { name: "CRM enquiries" })).getAllByRole("row")).toHaveLength(data.items.length + 1);
    await user.click(screen.getByRole("button", { name: `Assign ${lead.partyName}` }));
    dialog = await screen.findByRole("dialog", { name: "Reassign enquiry" });
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
    const dialog = await screen.findByRole("dialog", { name: "Reassign enquiry" });
    await user.click(within(dialog).getByRole("radio", { name: "Auto-assign" }));
    await user.click(within(dialog).getByRole("button", { name: "Reassign" }));
    expect(await within(dialog).findByText("Lead changed; reload and try again")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(within(screen.getByRole("button", { name: `Assign ${lead.partyName}` })).getByText(lead.ownerName!)).toBeInTheDocument();
  });

  it.each(["automatic", "unassigned"])("creates the enquiry and initial %s routing in one request", async (mode) => {
    const user = userEvent.setup();
    const createdLead: CrmLeadListItem = { ...structuredClone(leadsPageFixture.items[0]), id: "62000000-0000-4000-8000-000000000098", reference: "E-0006", partyName: "Layla Karim", title: "E-0006", version: 2 };
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes("contact-match") ? { valid: true, message: null, matches: [] } : url === "/api/workspace/crm/leads" ? { status: "ready", leadId: createdLead.id, reference: createdLead.reference } : url.includes("/data/leads/") ? createdLead : { data: [createdLead, ...structuredClone(leadsPageFixture.items)], nextCursor: null } }));
    vi.stubGlobal("fetch", fetchMock);
    const fixture = structuredClone(leadsPageFixture);
    fixture.defaultLocale = "en-AE";
    fixture.leadOptions = { sources: [{id:"company",label:"Company"}], channels: {company:[{id:"call",label:"Call"}]}, enquiryTypes: [{id:"not_sure",label:"Not Sure Yet"}], customerTypes: [], budgetRanges: [], emirates: [{id:"dubai",label:"Dubai"}], areas: {dubai:[]} };
    render(<LeadsPage initialData={fixture} />);
    await user.click(screen.getByRole("button", { name: "New enquiry" }));
    const dialog = await screen.findByRole("dialog", { name: "New enquiry" });
    await user.type(within(dialog).getByRole("textbox", { name: "Mobile" }), "050 123 4567");
    await user.type(within(dialog).getByLabelText(/Customer name/), "Layla Karim");
    await user.click(within(dialog).getByRole("button", { name: /Source/ }));
    await user.click(screen.getByRole("option", { name: "Company" }));
    await user.click(within(dialog).getByRole("button", { name: /Emirate/ }));
    await user.click(screen.getByRole("option", { name: "Dubai" }));
    await user.click(within(dialog).getByRole("button", { name: /Owner/ }));
    await user.click(screen.getByRole("option", { name: mode === "automatic" ? "Use routing rules" : "Leave unassigned" }));
    await user.click(within(dialog).getByRole("button", { name: "Create enquiry" }));
    // The reference is said once saved; the form has no placeholder for it (LF-1).
    expect(await screen.findByText("Enquiry E-0006 created.")).toBeInTheDocument();
    const create = fetchMock.mock.calls.find(([url]) => url === "/api/workspace/crm/leads") as unknown as [string, { body: string }];
    const body = JSON.parse(create[1].body);
    expect(body).toMatchObject({ displayName: "Layla Karim", assignment: { mode }, source: "company", channel: "call" });
    expect(body).not.toHaveProperty("title");
    expect(fetchMock.mock.calls.some(([url]) => url.includes("/auto-assign"))).toBe(false);
    expect(screen.getAllByText("E-0006").length).toBeGreaterThan(0);
  }, 90000);

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

    await interaction.click(screen.getByRole("button", { name: "Load more enquiries" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(String(fetchMock.mock.calls[0][0])).toContain(`workspaceId=${leadsPageFixture.workspaceId}`);
    expect(String(fetchMock.mock.calls[0][0])).toContain("cursor=fixture-next-page");
    expect(await screen.findByRole("button", { name: "Open Omar Al Ketbi" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Open Dr Maya Nair" })).toHaveLength(1);
    expect(screen.getByText("6 records")).toBeInTheDocument();
  });

  it("opens on My day: my new enquiries and those due today or overdue, most urgent first (S-30)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-06T08:00:00.000Z"));
    try {
      const data = structuredClone(leadsPageFixture);
      const [first, ...rest] = data.items;
      const mine = (id: string, title: string, extra: Partial<CrmLeadListItem>) => ({ ...first, id, title, ownerMembershipId: OWNER_ID_FOR_TEST, slaStatus: null, slaDueAt: null, ...extra }) as CrmLeadListItem;
      data.currentMembershipId = OWNER_ID_FOR_TEST;
      data.items = [
        mine("62000000-0000-4000-8000-000000000101", "Later this week", { status: "connected", nextActionAt: "2026-09-09T09:00:00.000Z" }),
        mine("62000000-0000-4000-8000-000000000102", "Overdue callback", { status: "connected", nextActionAt: "2026-09-05T09:00:00.000Z" }),
        mine("62000000-0000-4000-8000-000000000103", "Fresh enquiry", { status: "new", nextActionAt: null }),
        ...rest.map((lead) => ({ ...lead, ownerMembershipId: "someone-else" })),
      ];
      render(<LeadsPage initialData={data} />);
      expect(screen.getByRole("button", { name: /^My day/ })).toHaveAttribute("aria-pressed", "true");
      const rows = within(screen.getByRole("table", { name: "CRM enquiries" })).getAllByRole("button", { name: /^Log contact/ });
      // The overdue callback and the new enquiry; next week's follow-up waits for its day.
      expect(rows).toHaveLength(2);
      expect(rows[0].closest("[role='row'], tr")).toHaveTextContent(/overdue/);
      expect(rows[1].closest("[role='row'], tr")).toHaveTextContent(/New/);
    } finally { vi.useRealTimers(); }
  });

  it("has one title with New enquiry as its one primary action, top-end (S-20)", () => {
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} />);
    expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["Enquiries"]);
    expect(screen.getAllByRole("button", { name: "New enquiry" })).toHaveLength(1);
  });

  it("keeps at most six lists under the title and puts enquiries to check in a filter chip", async () => {
    const user = userEvent.setup();
    const data = structuredClone(leadsPageFixture);
    data.items = [{ ...data.items[0], id: "dup", partyName: "Dup Client", status: "duplicate", isConverted: false }, { ...data.items[0], id: "fresh", partyName: "Fresh Client", status: "new", isConverted: false }];
    render(<LeadsPage initialData={data} />);
    expect(within(screen.getByRole("group", { name: "Enquiry lists" })).getAllByRole("button").length).toBeLessThanOrEqual(6);
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.click(screen.getByRole("button", { name: /Filter by to check/ }));
    await user.click(screen.getByRole("option", { name: "Duplicates" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(within(screen.getByRole("group", { name: "Filters in use" })).getByText("Duplicates")).toBeVisible();
    expect(screen.getByRole("button", { name: "Open Dup Client" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Fresh Client" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Enquiry lists" })).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  }, 20_000);

  it("filters by source and resets to all leads", async () => {
    const interaction = userEvent.setup();
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} />);
    await filterLeads(interaction, "Source", "Instagram");
    expect(screen.getByRole("button", { name: "Open Amira Al Mansoori" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Leena Mathew" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Dr Maya Nair" })).not.toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Filter" }));
    await interaction.click(screen.getByRole("button", { name: "Clear filters" }));
    await interaction.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Open Leena Mathew" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Dr Maya Nair" })).toBeInTheDocument();
  }, 40000);

  it("logs a contact, keeps the version and moves the enquiry to Come back to", async () => {
    const user = userEvent.setup();
    const lead = structuredClone(leadsPageFixture.items[0]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...lead, status: "paused", version: lead.version + 1, nextActionAt: "2030-01-02T06:00:00.000Z" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} />);
    await user.click(screen.getByRole("button", { name: `Log contact · ${lead.partyName}` }));
    const dialog = await screen.findByRole("dialog", { name: "Log contact" });
    await user.click(within(dialog).getByRole("radio", { name: "WhatsApp" }));
    await user.click(within(dialog).getByRole("radio", { name: "Come back later" }));
    await user.click(within(dialog).getByRole("button", { name: "Log contact" }));
    expect(await within(dialog).findByText("Add a note about this contact.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.type(within(dialog).getByRole("textbox", { name: /Note/ }), "Travelling, call after the 15th");
    await user.click(within(dialog).getByRole("button", { name: "Log contact" }));
    expect(await screen.findByText(`${lead.partyName} · Contact logged.`)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe(`/api/workspace/crm/leads/${lead.id}/contacts`);
    expect(JSON.parse(init.body)).toMatchObject({ workspaceId: leadsPageFixture.workspaceId, version: lead.version, channel: "whatsapp", outcome: "come_back_later", note: "Travelling, call after the 15th" });
    expect(JSON.parse(init.body).nextActionAt).toEqual(expect.any(String));
    const row = screen.getByRole("button", { name: `Open ${lead.partyName}` }).closest("tr")!;
    expect(within(row).getByText("Come back later")).toBeInTheDocument();
  }, 20_000);

  it("asks for a reason before logging Not interested", async () => {
    const user = userEvent.setup();
    const lead = structuredClone(leadsPageFixture.items[0]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...lead, status: "disqualified", version: lead.version + 1, nextActionAt: null }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} />);
    await user.click(screen.getByRole("button", { name: `Log contact · ${lead.partyName}` }));
    const dialog = await screen.findByRole("dialog", { name: "Log contact" });
    await user.click(within(dialog).getByRole("radio", { name: "Not interested" }));
    expect(within(dialog).queryByText("Next follow-up")).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: /Note/ }), "Chose another firm");
    await user.click(within(dialog).getByRole("button", { name: "Log contact" }));
    expect(await within(dialog).findByText("Add the reason the client is not interested.")).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Budget");
    await user.click(within(dialog).getByRole("button", { name: "Log contact" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body)).toMatchObject({ outcome: "not_interested", reason: "Budget" });
  }, 20_000);

  it("opens the opportunity itself from a converted enquiry's row", async () => {
    const fixture = structuredClone(leadsPageFixture);
    fixture.items[4].isConverted = true;
    fixture.items[4].opportunityId = "71000000-0000-4000-8000-000000000009";
    render(<LeadsPage initialData={fixture} />);
    const row = screen.getByRole("button", { name: /Open Amira Al Mansoori/ }).closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "View opportunity" }));
    expect(router.push).toHaveBeenCalledWith("/workspace/crm/opportunities?record=71000000-0000-4000-8000-000000000009");
  });

  it("keeps converted enquiries visible without contact logging", () => {
    const fixture = structuredClone(leadsPageFixture);
    fixture.items[4].isConverted = true;
    render(<LeadsPage initialData={fixture} />);
    expect(screen.queryByRole("button", { name: /Log contact · Amira Al Mansoori/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Amira Al Mansoori/ })).toBeInTheDocument();
  });

  it("shows a permission state instead of an empty data grid", () => {
    render(<LeadsPage initialData={{ ...structuredClone(leadsPageFixture), canView: false, items: [] }} />);

    expect(screen.getByText("You don't have access to Enquiries")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "CRM enquiries" })).not.toBeInTheDocument();
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
