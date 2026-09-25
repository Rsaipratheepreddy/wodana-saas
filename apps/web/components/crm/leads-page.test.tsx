import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leadsPageFixture, type CrmLeadListItem } from "@/lib/crm/leads";
import { integrationsPageFixture } from "@/lib/workspace/integrations";
import { LeadsPage } from "./leads-page";

vi.mock("next/font/google", () => ({ Caveat: () => ({ variable: "note-font" }) }));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LeadsPage", () => {
  it("opens lead-source connection setup within Sales", async () => {
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} integrationsData={{ ...structuredClone(integrationsPageFixture), connections: [] }} initialSection="sources" />);
    expect(screen.getByRole("navigation", { name: "Capture settings" })).toHaveTextContent("Lead sources");
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
    expect(within(table).getByRole("columnheader", { name: /Enquiry ID/ })).toBeInTheDocument();
    expect(within(table).getAllByRole("columnheader").slice(0, 2).map(header => header.textContent?.trim())).toEqual(["Enquiry ID", "Customer"]);
    expect(within(table).getByRole("img", { name: "Your enquiries will appear here" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New enquiry" })).toBeEnabled();
  });
  it("shows custom form answers as enquiry columns and leaves other rows blank with a dash", () => {
    const data = structuredClone(leadsPageFixture);
    data.items[0].formId = "form-a";
    data.items[0].formAnswers = [
      { questionId: "name", title: "Your name", type: "text", field: "displayName", value: "Maya" },
      { questionId: "rooms", title: "Rooms needed", type: "number", field: "custom", value: "3" },
    ];
    render(<LeadsPage initialData={data} />);
    const table = screen.getByRole("table", { name: "CRM enquiries" });
    expect(within(table).getByRole("columnheader", { name: /Rooms needed/ })).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: /Your name/ })).not.toBeInTheDocument();
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]).getByText("3")).toBeInTheDocument();
    expect(rows[2].querySelector('[data-column="form:form-a:rooms"]')).toHaveTextContent("—");
  });
  it("uses the shared record grid with avatars, source chips and search", () => {
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} />);

    expect(screen.getByRole("region", { name: "Enquiries workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Lead records" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    const table = screen.getByRole("table", { name: "CRM enquiries" });
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(within(table).getByRole("columnheader", { name: /Stage/i })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /Source/i })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /Source/i })).toHaveStyle({ inlineSize: "220px" });
    expect(within(table).getByRole("columnheader", { name: /Assigned to/i })).toHaveStyle({ inlineSize: "230px" });
    expect(within(table).queryByRole("columnheader", { name: /Channel/i })).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: /Captured via/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kanban" })).not.toBeInTheDocument();
    expect(table.closest(".wd-data-grid")).toHaveAttribute("data-appearance", "flush");
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
    expect(within(table).getByRole("button", { name: "E-0042" })).toBeInTheDocument();
  });

  it("opens workspace enquiry-type configuration from the enquiry submenu", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ taxonomies: [] }) }));
    const data = structuredClone(leadsPageFixture);
    render(<LeadsPage initialData={data} initialSection="options" />);

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
    expect(within(screen.getByRole("table", { name: "CRM enquiries" })).getAllByRole("row")).toHaveLength(5);
  }, 20_000);

  it.each(["stage", "table action"])("qualifies a lead through %s and keeps the pre-execution handoff", async (entry) => {
    const user = userEvent.setup(), data = structuredClone(leadsPageFixture), lead = data.items[0];
    const converted = { ...lead, status: "qualified" as const, isConverted: true, version: lead.version + 1, nextActionAt: null };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(`/data/leads/${lead.id}/qualify`)) return { ok: true, json: async () => ({ id: "71000000-0000-4000-8000-000000000001", leadId: lead.id, title: lead.title }) };
      if (url.startsWith("/api/workspace/crm/leads?")) return { ok: true, json: async () => ({ data: data.items.map((item) => item.id === lead.id ? converted : item), nextCursor: null }) };
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LeadsPage initialData={data} />);

    if (entry === "stage") await chooseOption(user, /Stage for Dr Maya Nair/, "Qualified");
    else await user.click(screen.getByRole("button", { name: `Convert ${lead.partyName} to opportunity` }));
    const dialog = await screen.findByRole("dialog", { name: "Convert to opportunity" });
    expect(within(dialog).getByDisplayValue(lead.title)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Convert to opportunity" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/workspace/crm/opportunities?record=71000000-0000-4000-8000-000000000001"));
    const conversionRequest = fetchMock.mock.calls.find(call => call[0].includes(`/leads/${lead.id}/qualify`)) as unknown as [string, { body: string }];
    expect(JSON.parse(conversionRequest[1].body)).toMatchObject({
      partyId: lead.partyId,
      leadVersion: lead.version,
      pipelineId: data.pipelines[0].id,
      ownerMembershipId: lead.ownerMembershipId,
      title: lead.title,
    });
    const row = screen.getByRole("button", { name: /Stage for Dr Maya Nair/ }).closest("tr")!;
    expect(screen.queryByRole("dialog", { name: "Convert to opportunity" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("link", { name: /Design & Planning/ })).not.toBeInTheDocument();
  }, 10_000);

  it("opens the existing lead inspector from the table", async () => {
    const interaction = userEvent.setup();
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} />);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => leadsPageFixture.items[0] }));
    await interaction.click(screen.getByRole("button", { name: "Open Amira Al Mansoori" }));
    const dialog = await screen.findByRole("dialog", { name: "Enquiry details" });
    const tabs = within(dialog).getAllByRole("tab");
    expect(tabs.slice(0, 2).map((tab) => tab.textContent)).toEqual(["Details", "Activity"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByRole("tab", { name: "Activity" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Details" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Source & history" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Requirements" })).toBeInTheDocument();
    expect(within(dialog).getByText("Next follow-up")).toBeInTheDocument();
    expect(within(dialog).queryByText("Owner & next step")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Owner")).toBeInTheDocument();
    const convertAction = await within(dialog).findByRole("button", { name: "Convert to opportunity" });
    expect(convertAction.closest("section")?.className).toContain("dealNextStepSticky");
    await interaction.click(within(dialog).getByRole("tab", { name: "Activity" }));
    expect(convertAction).toBeVisible();
  });

  it.each(["stage", "table action"])("routes a Not Sure Yet enquiry from %s to editing instead of deal creation", async entry => {
    const data = structuredClone(leadsPageFixture);
    const lead = { ...data.items[0], serviceType: "not_sure" };
    data.items = [lead];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...lead, enquiry: { serviceType: "not_sure", partyName: lead.partyName, title: lead.title } }) }));
    render(<LeadsPage initialData={data} />);
    const user = userEvent.setup();
    if (entry === "stage") await chooseOption(user, /Stage for Dr Maya Nair/, "Qualified");
    else await user.click(screen.getByRole("button", { name: `Choose enquiry type for ${lead.partyName}` }));
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
    expect(within(dialog).getByRole("tab", { name: "Activity" })).toBeInTheDocument();
  });

  it("assigns from the table, preserves other rows, and uses the returned version for auto-assignment", async () => {
    const user = userEvent.setup();
    const data = structuredClone(leadsPageFixture);
    const lead = data.items[0];
    const manager = { ...data.members[0], id: "10000000-0000-4000-8000-000000000099", displayName: "New sales owner" };
    data.members.push(manager);
    const saved = { id: lead.id, ownerMembershipId: manager.id, queueId: lead.queueId, nextActionAt: lead.nextActionAt, status: lead.status, updatedAt: lead.updatedAt, version: lead.version + 1 };
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
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url === "/api/workspace/crm/leads" ? { status: "ready", leadId: createdLead.id, reference: createdLead.reference } : url.includes("/data/leads/") ? createdLead : { data: [createdLead, ...structuredClone(leadsPageFixture.items)], nextCursor: null } }));
    vi.stubGlobal("fetch", fetchMock);
    const fixture = structuredClone(leadsPageFixture);
    fixture.defaultLocale = "en-AE";
    fixture.leadOptions = { sources: [{id:"company",label:"Company"}], channels: {company:[{id:"call",label:"Call"}]}, enquiryTypes: [{id:"not_sure",label:"Not Sure Yet"}], customerTypes: [], budgetRanges: [], emirates: [{id:"dubai",label:"Dubai"}], areas: {dubai:[]} };
    render(<LeadsPage initialData={fixture} />);
    await user.click(screen.getByRole("button", { name: "New enquiry" }));
    const dialog = await screen.findByRole("dialog", { name: "Add enquiry" });
    await user.type(within(dialog).getByLabelText(/Customer name/), "Layla Karim");
    await user.type(within(dialog).getByRole("textbox", { name: "Mobile" }), "050 123 4567");
    await user.click(within(dialog).getByRole("button", { name: /Emirate/ }));
    await user.click(screen.getByRole("option", { name: "Dubai" }));
    await user.click(within(dialog).getByRole("button", { name: /Assignment/ }));
    await user.click(screen.getByRole("option", { name: mode === "automatic" ? "Use routing rules" : "Leave unassigned" }));
    await user.click(within(dialog).getByRole("button", { name: "Create enquiry" }));
    expect(await screen.findByText("Enquiry created.")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspace/crm/leads");
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, {body:string}])[1].body);
    expect(body).toMatchObject({ displayName: "Layla Karim", assignment: { mode }, source: "company", channel: "call" });
    expect(body).not.toHaveProperty("title");
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

    await interaction.click(screen.getByRole("button", { name: "Load more enquiries" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(String(fetchMock.mock.calls[0][0])).toContain(`workspaceId=${leadsPageFixture.workspaceId}`);
    expect(String(fetchMock.mock.calls[0][0])).toContain("cursor=fixture-next-page");
    expect(await screen.findByRole("button", { name: "Open Omar Al Ketbi" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Open Dr Maya Nair" })).toHaveLength(1);
    expect(screen.getByText("6 records")).toBeInTheDocument();
  });

  it("filters independently by source and status and resets to all leads", async () => {
    const interaction = userEvent.setup();
    render(<LeadsPage initialData={structuredClone(leadsPageFixture)} />);
    await filterLeads(interaction, "Source", "Instagram");
    await filterLeads(interaction, "Stage", "Qualified");
    expect(screen.getByRole("button", { name: "Open Amira Al Mansoori" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Leena Mathew" })).not.toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Filter" }));
    await interaction.click(screen.getByRole("button", { name: "Clear filters" }));
    await interaction.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Open Leena Mathew" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Dr Maya Nair" })).toBeInTheDocument();
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
    expect(screen.getByRole("button", {name: "View linked records"})).toBeEnabled();
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
    expect(within(dialog).getByRole("button", { name: /Open calendar Next follow-up date/ })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    for (const [segment, value] of [["year", "2026"], ["month", "9"], ["day", "20"]]) {
      await interaction.click(within(dialog).getByRole("spinbutton", { name: new RegExp(`${segment},.*Next follow-up date`, "i") }));
      await interaction.keyboard(value);
    }
    await interaction.click(screen.getByRole("spinbutton", { name: "hour, Next follow-up time" })); await interaction.keyboard("09");
    await interaction.click(screen.getByRole("spinbutton", { name: "minute, Next follow-up time" })); await interaction.keyboard("30");
    await interaction.click(screen.getByRole("spinbutton", { name: /am\/pm, Next follow-up time/i })); await interaction.keyboard("a");
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
  }, 20_000);

  it("shows a permission state instead of an empty data grid", () => {
    render(<LeadsPage initialData={{ ...structuredClone(leadsPageFixture), canView: false, items: [] }} />);

    expect(screen.getByText("Enquiry access is restricted")).toBeInTheDocument();
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
