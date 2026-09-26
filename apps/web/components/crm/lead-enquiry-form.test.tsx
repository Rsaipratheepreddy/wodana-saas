import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { leadsPageFixture } from "@/lib/crm/leads";
import { LeadEnquiryForm, type EditableEnquiry } from "./lead-enquiry-form";

afterEach(() => vi.unstubAllGlobals());
function setup(existing?: EditableEnquiry, tweak?: (data: ReturnType<typeof structuredClone<typeof leadsPageFixture>>) => void) {
  const data = structuredClone(leadsPageFixture);
  data.defaultLocale = "en-AE";
  data.leadOptions = {
    enquiryTypes: [{ id: "design", label: "Design consultation" }],
    budgetRanges: [{ id: "small", label: "Small budget" }], customerTypes: [],
    emirates: [{ id: "dubai", label: "Dubai" }, { id: "other", label: "Other" }], areas: { dubai: [{ id: "marina", label: "Dubai Marina" }] },
    sources: [{ id: "company", label: "Company" }, { id: "referral", label: "Referral" }, { id: "self_generated", label: "Self Generated", allowedRoles: ["SALES"] }],
    channels: { company: [{ id: "call", label: "Call" }], referral: [{ id: "external", label: "External" }, { id: "partner", label: "Partner" }], self_generated: [{ id: "whatsapp", label: "WhatsApp" }] },
    referralPartners: [{ id: "odg", label: "ODG" }],
  };
  tweak?.(data);
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ leadId: "saved" }) });
  vi.stubGlobal("fetch", fetchMock);
  const onSaved = vi.fn().mockResolvedValue(undefined);
  const saved = existing ? { ...existing, party: { mobile: "+971501234567", ...existing.party }, details: { emirate: "dubai", ...existing.details } } : undefined;
  render(<DesignSystemProvider><LeadEnquiryForm initialData={data} existing={saved} onClose={vi.fn()} onSaved={onSaved} /></DesignSystemProvider>);
  return { user: userEvent.setup(), fetchMock, onSaved };
}
async function choose(user: ReturnType<typeof userEvent.setup>, label: RegExp, option: string) {
  await user.click(screen.getByRole("button", { name: label }));
  await user.click(screen.getByRole("option", { name: option }));
}
async function completeRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: "Mobile" }), "050 123 4567");
  await choose(user, /Emirate/, "Dubai");
}
it("uses configured enquiry types, resets dependent channels and saves selected option IDs", async () => {
  const { user, fetchMock, onSaved } = setup();
  expect(screen.getByRole("button", { name: /Enquiry type/ })).toHaveTextContent("Design consultation");
  await user.type(screen.getByLabelText(/Customer name/), "Test customer");
  await completeRequired(user);
  await choose(user, /Source/, "Referral");
  expect(screen.getByRole("button", { name: /Channel/ })).toHaveTextContent("External");
  await user.type(screen.getByRole("textbox", { name: /^Referred by/ }), "Omar");
  await choose(user, /Budget range/, "Small budget");
  await choose(user, /Assignment/, "Leave unassigned");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("saved"));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ serviceType: "design", source: "referral", channel: "external", details: { budgetRange: "small" }, assignment: { mode: "unassigned" } });
}, 15_000);
it("passes the selected country with a locally entered mobile", async () => {
  const { user, fetchMock, onSaved } = setup();
  await user.type(screen.getByLabelText(/Customer name/), "Test customer");
  await user.type(screen.getByRole("textbox", { name: "Mobile" }), "050 123 4567");
  await choose(user, /Emirate/, "Dubai");
  await choose(user, /Assignment/, "Leave unassigned");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("saved"));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ mobile: "501234567", mobileCountryCode: "AE" });
});
it("types the place when the region is Other", async () => {
  const { user, fetchMock, onSaved } = setup();
  await user.type(screen.getByLabelText(/Customer name/), "International customer");
  await user.type(screen.getByRole("textbox", { name: "Mobile" }), "050 123 4567");
  await choose(user, /Emirate/, "Other");
  expect(screen.queryByRole("button", { name: /Area · optional/ })).not.toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: /Area \/ city/ }), "Muscat, Oman");
  await choose(user, /Assignment/, "Leave unassigned");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("saved"));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).details).toMatchObject({ emirate: "other", area: "Muscat, Oman" });
});
it("shows retired values while editing and allows clearing an optional selection", async () => {
  const { user, fetchMock, onSaved } = setup({ id: "old", version: 3, serviceType: "legacy_service", party: { displayName: "Test customer" }, details: { budgetRange: "legacy_budget", customerType: "legacy_customer" } });
  expect(screen.getByRole("textbox", { name: "Enquiry reference" })).toHaveAttribute("readonly");
  expect(screen.queryByRole("textbox", { name: /Enquiry title/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Enquiry type/ })).toHaveTextContent("legacy service");
  expect(screen.getByRole("button", { name: /Budget range/ })).toHaveTextContent("legacy budget");
  expect(screen.getByRole("button", { name: /Client type/ })).toHaveTextContent("legacy customer");
  await choose(user, /Budget range/, "Not provided");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("old"));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ version: 3, serviceType: "legacy_service", details: { budgetRange: "", customerType: "legacy_customer" } });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("title");
});
it("keeps the modal and selections when the backend rejects a save", async () => {
  const { user, fetchMock, onSaved } = setup({ id: "old", version: 3, serviceType: "design", party: { displayName: "Test customer" } });
  fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: "Lead changed; reload before saving" }) });
  await choose(user, /Budget range/, "Small budget");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("Lead changed; reload before saving")).toBeVisible();
  expect(screen.getByRole("button", { name: /Budget range/ })).toHaveTextContent("Small budget");
  expect(onSaved).not.toHaveBeenCalled();
});
it.each([['Test customer', 'attach'], ['Different person — create a new client', 'create_new']])('resolves %s inside the original form', async (option, decision) => {
  const { user, fetchMock, onSaved } = setup();
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'duplicate_candidate', intakeEventId: 'intake-1' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [{ id: 'candidate-1', partyId: 'party-1', partyName: 'Test customer', status: 'pending', version: 2 }] }) });
  await user.type(screen.getByLabelText(/Customer name/), 'Test customer');
  await completeRequired(user);
  await choose(user, /Assignment/, 'Leave unassigned');
  await user.click(screen.getByRole('button', { name: 'Create enquiry' }));
  expect(await screen.findByText('Is this an existing client?')).toBeVisible();
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(onSaved).not.toHaveBeenCalled();
  await choose(user, /Client for this enquiry/, option);
  await user.click(screen.getByRole('button', { name: 'Save enquiry' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('saved'));
  const body = JSON.parse(fetchMock.mock.calls[2][1].body);
  expect(body).toMatchObject({ decision, version: 2 });
  expect(body.partyId).toBe(decision === 'attach' ? 'party-1' : undefined);
});
it("lets an existing enquiry correct its source and channel, and keeps an older source untouched", async () => {
  const legacy = { id: "lead-1", version: 3, serviceType: "design", party: { displayName: "Amira" }, source: "instagram", channel: "dm" };
  const first = setup(legacy);
  expect(screen.getByRole("button", { name: /Source/ })).toHaveTextContent("instagram");
  await first.user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(first.onSaved).toHaveBeenCalled());
  const untouched = JSON.parse(first.fetchMock.mock.calls[0][1].body);
  expect(untouched).not.toHaveProperty("source");
  expect(untouched).not.toHaveProperty("channel");
  cleanup();

  const second = setup(legacy);
  await choose(second.user, /Source/, "Referral");
  expect(screen.getByRole("button", { name: /Channel/ })).toHaveTextContent("External");
  await second.user.type(screen.getByRole("textbox", { name: /^Referred by/ }), "Omar");
  await second.user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(second.onSaved).toHaveBeenCalled());
  expect(JSON.parse(second.fetchMock.mock.calls[0][1].body)).toMatchObject({ version: 3, source: "referral", channel: "external", referral: { name: "Omar" } });
}, 15_000);

it("asks who referred a referral enquiry and sends it, and hides role-limited sources", async () => {
  const { user, fetchMock, onSaved } = setup();
  await user.type(screen.getByLabelText(/Customer name/), "Referred client");
  await completeRequired(user);
  await user.click(screen.getByRole("button", { name: /Source/ }));
  expect(screen.queryByRole("option", { name: "Self Generated" })).toBeNull();
  await user.click(screen.getByRole("option", { name: "Referral" }));
  await user.type(screen.getByRole("textbox", { name: /^Referred by/ }), "Omar Haddad");
  await choose(user, /Assignment/, "Leave unassigned");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ source: "referral", channel: "external", referral: { name: "Omar Haddad" } });
}, 15_000);

const FLOOR = "7d1b6c1e-2f0a-4c55-9d7e-0a1b2c3d4e5f";
it("saves the workspace's own fields with the enquiry and hides hidden fixed fields", async () => {
  const { user, fetchMock, onSaved } = setup(undefined, (data) => {
    data.enquiryFields = { system: { email: { visible: false, version: 1 }, customerType: { visible: true, version: 0 }, area: { visible: true, version: 0 }, budgetRange: { visible: false, version: 1 }, summary: { visible: true, version: 0 } },
      custom: [{ id: FLOOR, key: "floor", label: "Floor", dataType: "text", configuration: {}, visible: true, position: 1, version: 1 }] };
  });
  expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Budget range/ })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText(/Customer name/), "Field customer");
  await user.type(screen.getByRole("textbox", { name: "Mobile" }), "050 123 4567");
  await choose(user, /Emirate/, "Dubai");
  await user.type(screen.getByRole("textbox", { name: "Floor" }), "3rd");
  await choose(user, /Assignment/, "Leave unassigned");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("saved"));
  const fieldsCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/leads/saved/fields"));
  expect(fieldsCall?.[1].method).toBe("PUT");
  expect(JSON.parse(fieldsCall?.[1].body)).toEqual({ values: { [FLOOR]: "3rd" } });
});

it("doesn't ask for a region when the workspace lists none", async () => {
  const { user, onSaved } = setup(undefined, (data) => { data.leadOptions = { ...data.leadOptions!, emirates: [], areas: {} }; });
  expect(screen.queryByRole("button", { name: /Emirate/ })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText(/Customer name/), "No region");
  await user.type(screen.getByRole("textbox", { name: "Mobile" }), "050 123 4567");
  await user.type(screen.getByRole("textbox", { name: /Area \/ city/ }), "Anywhere");
  await choose(user, /Assignment/, "Leave unassigned");
  await user.click(screen.getByRole("button", { name: "Create enquiry" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("saved"));
});
