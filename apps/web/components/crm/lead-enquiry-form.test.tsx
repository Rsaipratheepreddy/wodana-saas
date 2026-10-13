import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { leadsPageFixture } from "@/lib/crm/leads";
import type { ClientMatch } from "@/lib/crm/client-match";
import { forgetAiReady } from "@/lib/workspace/ai-settings";
import { LeadEnquiryForm, type EditableEnquiry } from "./lead-enquiry-form";

afterEach(() => { vi.unstubAllGlobals(); forgetAiReady(); });
type Data = ReturnType<typeof structuredClone<typeof leadsPageFixture>>;
function setup(existing?: EditableEnquiry, tweak?: (data: Data) => void, matches: ClientMatch[] = []) {
  const data = structuredClone(leadsPageFixture);
  data.defaultLocale = "en-AE";
  data.canAssign = true;
  data.leadOptions = {
    enquiryTypes: [{ id: "design", label: "Design consultation" }],
    budgetRanges: [{ id: "small", label: "Small budget" }], customerTypes: [],
    emirates: [{ id: "dubai", label: "Dubai" }, { id: "other", label: "Other" }], areas: { dubai: [{ id: "marina", label: "Dubai Marina" }] },
    sources: [{ id: "company", label: "Company" }, { id: "referral", label: "Referral" }, { id: "self_generated", label: "Self Generated", allowedRoles: ["sales"] }, { id: "returning_customer", label: "Returning Customer" }],
    channels: { company: [{ id: "call", label: "Call" }], referral: [{ id: "external", label: "External" }, { id: "partner", label: "Partner" }], self_generated: [{ id: "whatsapp", label: "WhatsApp" }], returning_customer: [{ id: "old_leads", label: "Old leads" }] },
    referralPartners: [{ id: "odg", label: "ODG" }],
  };
  tweak?.(data);
  const fetchMock = vi.fn(async (url: string): Promise<{ ok: boolean; json: () => Promise<unknown> }> => ({ ok: true, json: async () => String(url).includes("contact-match") ? { valid: true, message: null, matches } : { leadId: "saved", reference: "E-0042" } }));
  vi.stubGlobal("fetch", fetchMock);
  const onSaved = vi.fn().mockResolvedValue(undefined);
  const onOpenLead = vi.fn();
  const saved = existing ? { ...existing, party: { mobile: "+971501234567", ...existing.party }, details: { emirate: "dubai", ...existing.details } } : undefined;
  render(<DesignSystemProvider><LeadEnquiryForm initialData={data} existing={saved} onClose={vi.fn()} onSaved={onSaved} onOpenLead={onOpenLead} /></DesignSystemProvider>);
  const saves = () => fetchMock.mock.calls.filter(([url]) => !String(url).includes("contact-match") && !String(url).includes("ai-settings"));
  return { user: userEvent.setup(), fetchMock, onSaved, onOpenLead, saves, body: (index = 0) => JSON.parse((saves()[index] as unknown as [string, { body: string }])[1].body) };
}
async function choose(user: ReturnType<typeof userEvent.setup>, label: RegExp, option: string) {
  await user.click(screen.getByRole("button", { name: label }));
  await user.click(screen.getByRole("option", { name: option }));
}
async function completeRequired(user: ReturnType<typeof userEvent.setup>, source = "Company") {
  await user.type(screen.getByRole("textbox", { name: "Mobile" }), "050 123 4567");
  await user.type(screen.getByLabelText(/Customer name/), "Test customer");
  await choose(user, /^Choose source|^Source/, source);
  await choose(user, /Emirate/, "Dubai");
}

it("puts the mobile first, then the required fields, and keeps the rest under More details (LF-1)", async () => {
  setup();
  const fields = screen.getAllByRole("textbox").map((box) => box.getAttribute("aria-label") ?? (box as HTMLInputElement).labels?.[0]?.textContent ?? "");
  expect(fields[0]).toMatch(/Mobile/);
  expect(screen.getByRole("button", { name: "More details" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("textbox", { name: "Email" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Enquiry reference" })).not.toBeInTheDocument();
});

it("doesn't preselect a source, resets the channel with it and saves the chosen option IDs", async () => {
  const { user, onSaved, body, saves } = setup();
  expect(screen.getByRole("button", { name: /Enquiry type/ })).toHaveTextContent("Design consultation");
  await user.type(screen.getByRole("textbox", { name: "Mobile" }), "050 123 4567");
  await user.type(screen.getByLabelText(/Customer name/), "Test customer");
  await choose(user, /Emirate/, "Dubai");
  await choose(user, /Owner/, "Leave unassigned");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  // Nothing is saved until the source is chosen.
  expect(saves()).toHaveLength(0);
  await choose(user, /^Choose source|^Source/, "Referral");
  expect(screen.getByRole("button", { name: /Channel/ })).not.toHaveTextContent("External");
  await choose(user, /Channel/, "External");
  await user.type(screen.getByRole("textbox", { name: /^Referred by/ }), "Omar");
  await user.click(screen.getByRole("button", { name: "More details" }));
  await choose(user, /Budget range/, "Small budget");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("saved", "E-0042"));
  expect(body()).toMatchObject({ serviceType: "design", source: "referral", channel: "external", details: { budgetRange: "small" }, assignment: { mode: "unassigned" }, referral: { name: "Omar" } });
}, 20_000);

it("passes the selected country with a locally entered mobile", async () => {
  const { user, onSaved, body } = setup();
  await completeRequired(user);
  await choose(user, /Owner/, "Leave unassigned");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(body()).toMatchObject({ mobile: "501234567", mobileCountryCode: "AE", channel: "call" });
}, 15_000);

it("types the place when the region is Other", async () => {
  const { user, onSaved, body } = setup();
  await completeRequired(user);
  await choose(user, /Emirate/, "Other");
  await user.type(screen.getByRole("textbox", { name: /Area \/ city/ }), "Muscat, Oman");
  await choose(user, /Owner/, "Leave unassigned");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(body().details).toMatchObject({ emirate: "other", area: "Muscat, Oman" });
}, 15_000);

const match: ClientMatch = { partyId: "party-1", name: "Asha Rao", mobile: "+971501234567", email: "asha@example.com", leadId: "lead-9", reference: "E-0123", status: "qualified", receivedAt: "2026-05-01T08:00:00.000Z", open: false, ownerName: "Ali" };

it("recognises an existing client from the mobile and needs an answer before saving (LF-1)", async () => {
  const { user, onSaved, body, fetchMock } = setup(undefined, undefined, [match]);
  await completeRequired(user);
  expect(await screen.findByText("Existing client?")).toBeVisible();
  expect(String(fetchMock.mock.calls.find(([url]) => String(url).includes("contact-match"))?.[0])).toContain("mobile=%2B971501234567");
  const card = screen.getByRole("list", { name: "Clients with this mobile or email" });
  expect(card).toHaveTextContent("Asha Rao");
  expect(card).toHaveTextContent("asha@example.com");
  expect(card).toHaveTextContent("E-0123");
  expect(card).toHaveTextContent("Owner Ali");
  await choose(user, /Owner/, "Leave unassigned");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  expect(await screen.findByText("Choose the existing client or Different person.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Add as returning" }));
  expect(screen.getByLabelText(/Customer name/)).toHaveValue("Asha Rao");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(body()).toMatchObject({ identity: "existing", partyId: "party-1", displayName: "Asha Rao" });
}, 20_000);

it("keeps a different person as a new client, and opens an open enquiry instead of adding one", async () => {
  const first = setup(undefined, undefined, [match]);
  await completeRequired(first.user);
  await first.user.click(await screen.findByRole("button", { name: "Different person" }));
  await choose(first.user, /Owner/, "Leave unassigned");
  await first.user.click(screen.getByRole("button", { name: "Create enquiry" }));
  await waitFor(() => expect(first.onSaved).toHaveBeenCalled());
  expect(first.body()).toMatchObject({ identity: "new", displayName: "Test customer" });
  expect(first.body()).not.toHaveProperty("partyId");
  cleanup();

  const second = setup(undefined, undefined, [{ ...match, open: true, status: "new" }]);
  await second.user.type(screen.getByRole("textbox", { name: "Mobile" }), "050 123 4567");
  await second.user.click(await screen.findByRole("button", { name: "Open it" }));
  expect(second.onOpenLead).toHaveBeenCalledWith("lead-9");
  expect(screen.getByRole("button", { name: "Add to this client" })).toBeVisible();
}, 20_000);

it("shows retired values while editing and allows clearing an optional selection", async () => {
  const { user, onSaved, body } = setup({ id: "old", version: 3, serviceType: "legacy_service", source: "company", channel: "call", party: { displayName: "Test customer" }, details: { budgetRange: "legacy_budget", customerType: "legacy_customer" } });
  expect(screen.queryByRole("textbox", { name: /Enquiry title/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Enquiry type/ })).toHaveTextContent("legacy service");
  expect(screen.getByRole("button", { name: /Budget range/ })).toHaveTextContent("legacy budget");
  expect(screen.getByRole("button", { name: /Client type/ })).toHaveTextContent("legacy customer");
  expect(screen.queryByRole("button", { name: /Owner/ })).not.toBeInTheDocument();
  await choose(user, /Budget range/, "Not provided");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("old", undefined));
  expect(body()).toMatchObject({ version: 3, serviceType: "legacy_service", details: { budgetRange: "", customerType: "legacy_customer" } });
  expect(body()).not.toHaveProperty("title");
});

it("keeps the modal and selections when the backend rejects a save", async () => {
  const { user, fetchMock, onSaved } = setup({ id: "old", version: 3, serviceType: "design", source: "company", channel: "call", party: { displayName: "Test customer" }, details: { budgetRange: "small" } });
  fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: "Lead changed; reload before saving" }) });
  await choose(user, /Budget range/, "Not provided");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("Lead changed; reload before saving")).toBeVisible();
  expect(screen.getByRole("button", { name: /Budget range/ })).toHaveTextContent("Not provided");
  expect(onSaved).not.toHaveBeenCalled();
});

it("lets an existing enquiry correct its source and channel, and keeps an older source untouched", async () => {
  const legacy = { id: "lead-1", version: 3, serviceType: "design", party: { displayName: "Amira" }, source: "instagram", channel: "dm" };
  const first = setup(legacy);
  expect(screen.getByRole("button", { name: /Source/ })).toHaveTextContent("instagram");
  await first.user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(first.onSaved).toHaveBeenCalled());
  expect(first.body()).not.toHaveProperty("source");
  expect(first.body()).not.toHaveProperty("channel");
  cleanup();

  const second = setup(legacy);
  await choose(second.user, /Source/, "Referral");
  await choose(second.user, /Channel/, "External");
  await second.user.type(screen.getByRole("textbox", { name: /^Referred by/ }), "Omar");
  await second.user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(second.onSaved).toHaveBeenCalled());
  expect(second.body()).toMatchObject({ version: 3, source: "referral", channel: "external", referral: { name: "Omar" } });
}, 15_000);

it("never offers Returning Customer or a role-limited source to someone without the role", async () => {
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: /^Choose source|^Source/ }));
  expect(screen.queryByRole("option", { name: "Self Generated" })).toBeNull();
  expect(screen.queryByRole("option", { name: "Returning Customer" })).toBeNull();
  expect(screen.getByRole("option", { name: "Referral" })).toBeVisible();
});

const FLOOR = "7d1b6c1e-2f0a-4c55-9d7e-0a1b2c3d4e5f";
it("saves the workspace's own fields with the enquiry and hides hidden fixed fields", async () => {
  const { user, fetchMock, onSaved } = setup(undefined, (data) => {
    data.enquiryFields = { system: { email: { visible: false, version: 1 }, customerType: { visible: true, version: 0 }, area: { visible: true, version: 0 }, budgetRange: { visible: false, version: 1 }, summary: { visible: true, version: 0 } },
      custom: [{ id: FLOOR, key: "floor", label: "Floor", dataType: "text", configuration: {}, visible: true, position: 1, version: 1 }] };
  });
  await user.click(screen.getByRole("button", { name: "More details" }));
  expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Budget range/ })).not.toBeInTheDocument();
  await completeRequired(user);
  await user.type(screen.getByRole("textbox", { name: "Floor" }), "3rd");
  await choose(user, /Owner/, "Leave unassigned");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  const fieldsCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/leads/saved/fields")) as unknown as [string, { method: string; body: string }] | undefined;
  expect(fieldsCall?.[1].method).toBe("PUT");
  expect(JSON.parse(fieldsCall?.[1].body ?? "{}")).toEqual({ values: { [FLOOR]: "3rd" } });
}, 15_000);

it("doesn't ask for a region when the workspace lists none", async () => {
  const { user, onSaved } = setup(undefined, (data) => { data.leadOptions = { ...data.leadOptions!, emirates: [], areas: {} }; });
  expect(screen.queryByRole("button", { name: /Emirate/ })).not.toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "Mobile" }), "050 123 4567");
  await user.type(screen.getByLabelText(/Customer name/), "No region");
  await choose(user, /^Choose source|^Source/, "Company");
  await user.type(screen.getByRole("textbox", { name: /Area \/ city/ }), "Anywhere");
  await choose(user, /Owner/, "Leave unassigned");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
}, 15_000);

const SARA = "20000000-0000-4000-8000-000000000001";
const ZAID = "20000000-0000-4000-8000-000000000002";
const salesperson = (data: Data) => {
  // A salesperson can't read the member directory; the sales owners come from their own list.
  data.members = [];
  data.currentMembershipId = SARA;
  data.currentRoles = ["sales"];
  data.salesOwners = [{ id: SARA, displayName: "Sara", email: "sara@example.com", status: "active" }, { id: ZAID, displayName: "Zaid", email: "zaid@example.com", status: "active" }];
};

it("routes company enquiries and gives self-generated ones to the person creating them", async () => {
  const { user, onSaved, body } = setup(undefined, salesperson);
  expect(screen.getByRole("button", { name: /Owner/ })).toHaveTextContent("Use routing rules");
  await completeRequired(user, "Self Generated");
  expect(screen.getByRole("button", { name: /Owner/ })).toHaveTextContent("Me · Sara");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(body()).toMatchObject({ source: "self_generated", channel: "whatsapp", assignment: { mode: "manual", ownerMembershipId: SARA } });
}, 15_000);

it("owns it yourself when no routing is set up, and offers others only to people who may assign", async () => {
  const assigner = setup(undefined, (data) => { salesperson(data); data.assignmentPolicies = []; data.queues = []; });
  expect(screen.getByRole("button", { name: /Owner/ })).toHaveTextContent("Me · Sara");
  await choose(assigner.user, /Owner/, "Zaid");
  await completeRequired(assigner.user);
  await assigner.user.click(screen.getByRole("button", { name: "Create enquiry" }));
  await waitFor(() => expect(assigner.onSaved).toHaveBeenCalled());
  expect(assigner.body()).toMatchObject({ assignment: { mode: "manual", ownerMembershipId: ZAID } });
  cleanup();

  const seller = setup(undefined, (data) => { salesperson(data); data.canAssign = false; });
  await seller.user.click(screen.getByRole("button", { name: /Owner/ }));
  expect(screen.queryByRole("option", { name: "Zaid" })).toBeNull();
  expect(screen.getByRole("option", { name: "Me · Sara" })).toBeVisible();
}, 20_000);

it("doesn't preselect someone who can't own enquiries", async () => {
  setup(undefined, (data) => { salesperson(data); data.currentMembershipId = "20000000-0000-4000-8000-000000000009"; data.assignmentPolicies = []; data.queues = []; });
  expect(screen.getByRole("button", { name: /Owner/ })).not.toHaveTextContent(/Sara|Zaid/);
});

it("fills a new enquiry from a pasted message with Woddy, for the person to check before saving", async () => {
  const { user, fetchMock } = setup();
  fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () => String(url).includes("ai-settings") ? { enabled: true, available: true, version: 1 }
    : String(url).includes("form-fill") ? { fields: { customerName: "Sara Khan", mobile: "+971 50 123 4567", company: "Palm Holdings", summary: "Kitchen and majlis" } }
    : String(url).includes("contact-match") ? { valid: true, message: null, matches: [] } : { leadId: "saved", reference: "E-0042" } }));
  cleanup();
  forgetAiReady();
  render(<DesignSystemProvider><LeadEnquiryForm initialData={{ ...structuredClone(leadsPageFixture), defaultLocale: "en-AE" }} onClose={vi.fn()} onSaved={vi.fn()} /></DesignSystemProvider>);
  await user.click(await screen.findByRole("button", { name: "Fill with Woddy" }));
  await user.type(screen.getByRole("textbox", { name: "Paste a message, email or card" }), "Hi, Sara Khan from Palm Holdings, +971 50 123 4567. Kitchen and majlis.");
  await user.click(screen.getByRole("button", { name: "Read it" }));
  await user.click(await screen.findByRole("button", { name: "Use 4 values" }));
  expect(screen.getByLabelText(/Customer name/)).toHaveValue("Sara Khan");
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Mobile" })).toHaveValue("50 123 4567"));
  expect(screen.getByRole("button", { name: "Mobile country code" })).toHaveTextContent("+971");
  // What went under More details is open to check.
  expect(screen.getByRole("textbox", { name: "Company" })).toHaveValue("Palm Holdings");
  const [, init] = fetchMock.mock.calls.find(([url]) => String(url).includes("form-fill")) as unknown as [string, RequestInit];
  expect(JSON.parse(String(init.body))).toMatchObject({ form: "enquiry", text: expect.stringContaining("Sara Khan") });
  expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/workspace/crm/leads")).toBe(false);
});

it("lists every problem at once in one box at the top, marks each field and takes the person to it (PLM-092)", async () => {
  const { user, saves } = setup();
  await choose(user, /Owner/, "Leave unassigned");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  const box = await screen.findByRole("alert");
  expect(box).toHaveTextContent("Enquiry not saved");
  for (const text of ["Enter a customer name.", "Enter a mobile number.", "Select the emirate.", "Choose where this enquiry came from."]) expect(box).toHaveTextContent(text);
  expect(screen.getByLabelText(/Customer name/)).toHaveAttribute("aria-invalid", "true");
  expect(saves()).toHaveLength(0);
  await user.click(within(box).getByRole("button", { name: "Enter a customer name." }));
  expect(screen.getByLabelText(/Customer name/)).toHaveFocus();
  // A fixed field leaves the box.
  await user.type(screen.getByLabelText(/Customer name/), "Test customer");
  expect(screen.getByRole("alert")).not.toHaveTextContent("Enter a customer name.");
});

it("puts every field the server refused into the box and onto its field (PLM-092)", async () => {
  const { user, fetchMock, onSaved } = setup({ id: "old", version: 3, serviceType: "design", source: "company", channel: "call", party: { displayName: "Test customer" } });
  fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: "Enter the client's email. Enter the address", missing: [{ key: "email", label: "Enter the client's email" }, { key: "address", label: "Enter the address" }] }) });
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  const box = await screen.findByRole("alert");
  expect(box).toHaveTextContent("Enter the client's email");
  expect(box).toHaveTextContent("Enter the address");
  expect(screen.getByRole("textbox", { name: "Email" })).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("textbox", { name: "Address" })).toHaveAttribute("aria-invalid", "true");
  expect(onSaved).not.toHaveBeenCalled();
});

it("requires what the enquiry type requires from the start (PLM-096)", async () => {
  const { user, saves } = setup(undefined, (data) => { data.leadOptions!.requirements = { design: { summary: "create", email: "convert" } }; });
  await completeRequired(user);
  await choose(user, /Channel/, "Call");
  await choose(user, /Owner/, "Leave unassigned");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  const box = await screen.findByRole("alert");
  expect(box).toHaveTextContent("Describe the project");
  // Required before converting is not asked here.
  expect(box).not.toHaveTextContent("Enter the client's email");
  expect(saves()).toHaveLength(0);
  expect(screen.getByRole("textbox", { name: "Project description" })).toHaveAttribute("aria-invalid", "true");
});

it("asks for the team roles the enquiry type has and sends Not applicable; another type shows none (PLM-100)", async () => {
  const { user, onSaved, body } = setup(undefined, (data) => { data.leadOptions!.teamRoles = { design: ["designer"] }; });
  await completeRequired(user);
  await choose(user, /Channel/, "Call");
  await choose(user, /Owner/, "Leave unassigned");
  await choose(user, /Designer/, "Not applicable");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(body()).toMatchObject({ team: [{ role: "designer", notApplicable: true }] });
  cleanup();
  setup(undefined, (data) => { data.leadOptions!.teamRoles = { design: [] }; });
  expect(screen.queryByRole("button", { name: /Designer/ })).not.toBeInTheDocument();
});

it("leaves the internal notes out for someone who can't read them (PLM-024)", async () => {
  setup({ id: "old", version: 3, serviceType: "design", source: "company", channel: "call", party: { displayName: "Test customer" }, notesVisible: false });
  await userEvent.setup().click(screen.getByRole("button", { name: /More details/ }));
  expect(screen.queryByRole("textbox", { name: "Internal notes" })).not.toBeInTheDocument();
});

it("names each dropdown's own choice and takes the client type problem to the client type field (L8, L10)", async () => {
  const { user } = setup(undefined, (data) => { data.leadOptions!.customerTypes = [{ id: "individual", label: "Individual" }, { id: "company_client", label: "Company" }]; });
  const clientType = screen.getByRole("button", { name: /Client type/ });
  expect(clientType).toHaveTextContent("Choose client type");
  expect(screen.getByRole("button", { name: /Emirate/ })).toHaveTextContent("Choose emirate");
  expect(screen.getByRole("button", { name: /Owner/ })).not.toHaveTextContent("Select an option");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  const box = await screen.findByRole("alert");
  await user.click(within(box).getByRole("button", { name: "Choose the client type." }));
  expect(clientType).toHaveFocus();
  expect(screen.getByRole("button", { name: /^Choose source|^Source/ })).not.toHaveFocus();
});

it("opens a new enquiry empty again after it was closed with something typed (no draft is kept)", async () => {
  const { user } = setup();
  await user.type(screen.getByLabelText(/Customer name/), "Old customer");
  await user.type(screen.getByRole("textbox", { name: "Mobile" }), "050 123 4567");
  // Closing unmounts the form (the page renders it only while open); opening again starts a fresh one.
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 300));
  setup();
  expect(screen.getByLabelText(/Customer name/)).toHaveValue("");
  expect(screen.getByRole("textbox", { name: "Mobile" })).toHaveValue("");
  expect(screen.queryByText("Restored your draft")).not.toBeInTheDocument();
  expect(Object.keys(window.localStorage).filter((key) => key.includes("crm/enquiry/new"))).toEqual([]);
});

it("refuses a customer name with digits or symbols and saves real names (letters, hyphen, apostrophe, full stop)", async () => {
  const { user, saves, body } = setup();
  await completeRequired(user);
  await choose(user, /Owner/, "Leave unassigned");
  const name = screen.getByLabelText(/Customer name/);
  await user.clear(name);
  await user.type(name, "Priya 2");
  expect(screen.getByText("Use letters and spaces only")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Use letters and spaces only");
  expect(saves()).toHaveLength(0);
  await user.clear(name);
  await user.type(name, "  Anil D'Souza-Pinto Jr. ");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  await waitFor(() => expect(saves()).toHaveLength(1));
  expect(body()).toMatchObject({ displayName: "Anil D'Souza-Pinto Jr." });
});

it("refuses a mobile of the wrong length for the chosen country, on the mobile field", async () => {
  const { user, saves } = setup();
  await completeRequired(user);
  await choose(user, /Owner/, "Leave unassigned");
  const mobile = screen.getByRole("textbox", { name: "Mobile" });
  await user.clear(mobile);
  await user.type(mobile, "50 123 456");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid mobile number for United Arab Emirates (9 digits)");
  expect(mobile).toHaveAttribute("aria-invalid", "true");
  expect(saves()).toHaveLength(0);
});
