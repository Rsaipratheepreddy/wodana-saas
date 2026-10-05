import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leadsPageFixture } from "@/lib/crm/leads";
import type { LeadFormRecord } from "@/lib/crm/lead-forms";
import { LeadFormBuilder, validateDraft } from "./lead-form-builder";
import { reorderQuestions } from "./lead-form-editor";

const fixture: LeadFormRecord = {
  id: "form-one", token: "test-token", version: 1, status: "draft", published: null, updatedAt: "2026-09-09T00:00:00Z",
  draft: { title: "Project enquiry", description: "Tell us what you need.", source: "company", channel: "website", questions: [
    { id: "name", title: "Your name", type: "text", field: "displayName", description: "", required: true, options: [] },
    { id: "mobile", title: "Mobile number", type: "tel", field: "mobile", description: "", required: true, options: [] },
    { id: "email", title: "Email address", type: "email", field: "email", description: "", required: true, options: [] },
    { id: "location", title: "Property location", type: "text", field: "location", description: "", required: true, options: [] },
  ] },
};

function mockApi() {
  let record = structuredClone(fixture);
  const saves: Array<{ draft: LeadFormRecord["draft"]; version: number; action: string }> = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (String(_url).includes("/responses")) return { ok: true, json: async () => ({ data: [{ id: "response-1", reference: "E-0007", leadId: "62000000-0000-4000-8000-000000000001", name: "Test customer", status: "ready", receivedAt: "2026-09-09T10:00:00Z", answers: [{ title: "Your name", value: "Test customer" }], consentStatus: "granted", candidateCount: 0 }], nextCursor: null }) };
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)); saves.push(body);
      record = { ...record, draft: body.draft, version: record.version + 1, ...(body.action === "publish" ? { status: "published", published: body.draft } : {}) };
      return { ok: true, json: async () => record };
    }
    if (String(_url).includes("lead-forms/blank")) return { ok: true, json: async () => ({ draft: structuredClone(fixture.draft) }) };
    if (init?.method === "DELETE") return { ok: true, json: async () => ({ deleted: true }) };
    // Creating a form saves what the builder holds (a template or the default); it counts as its first save.
    if (init?.method === "POST" && String(_url).includes("/lead-forms?")) {
      const body = JSON.parse(String(init.body ?? "{}")); saves.push({ draft: body.draft, version: 0, action: "create" });
      record = { ...record, draft: body.draft ?? record.draft }; return { ok: true, json: async () => record };
    }
    if (init?.method === "POST") return { ok: true, json: async () => record };
    return { ok: true, json: async () => ({ data: [record] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, saves };
}

const FIELD_ID = "7d1b6c1e-2f0a-4c55-9d7e-0a1b2c3d4e5f";
const withFields = () => ({ ...structuredClone(leadsPageFixture), enquiryFields: {
  system: { email: { visible: true, version: 0 }, customerType: { visible: true, version: 0 }, area: { visible: true, version: 0 }, budgetRange: { visible: false, version: 1 }, summary: { visible: true, version: 0 } },
  custom: [{ id: FIELD_ID, key: "property_type", label: "Property type", dataType: "multi_select" as const, configuration: { options: ["Villa", "Apartment"] }, visible: true, position: 1, version: 1 }],
} });
async function openBuilder() {
  const user = userEvent.setup();
  render(<LeadFormBuilder initialData={withFields()} autosaveDelay={0} />);
  await user.click(await screen.findByRole("button", { name: /Edit form Project enquiry/ }));
  return user;
}
/** "Add question" opens the field palette: the workspace's enquiry fields, then new field types. */
async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Add question", expanded: false }));
  return screen.getByRole("complementary", { name: "Enquiry fields" });
}
afterEach(() => vi.unstubAllGlobals());

describe("LeadFormBuilder", () => {
  it("lists every form with its source, channel and submissions; a draft has no link yet (PLM-116)", async () => {
    mockApi();
    render(<LeadFormBuilder initialData={structuredClone(leadsPageFixture)} />);
    expect(await screen.findByRole("button", { name: /Edit form Project enquiry/ })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search forms" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Enquiry forms" });
    for (const name of ["Form", "Status", "Source", "Channel", "Submissions"]) expect(within(table).getByRole("columnheader", { name: new RegExp(name) })).toBeInTheDocument();
    expect(within(table).getByText(/^company$/i)).toBeInTheDocument();
    expect(within(table).getByText(/^website$/i)).toBeInTheDocument();
    expect(within(table).getByText("Publish to share")).toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: /Copy link/ })).not.toBeInTheDocument();
  });
  it("copies a published form's link and offers its QR code from the row (PLM-116)", async () => {
    const published = { ...structuredClone(fixture), status: "published", published: structuredClone(fixture.draft), submissions: 12 };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: [published] }) })));
    const user = userEvent.setup();
    render(<LeadFormBuilder initialData={structuredClone(leadsPageFixture)} />);
    await user.click(await screen.findByRole("button", { name: "Copy link to Project enquiry" }));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toContain("/enquiry/test-token"));
    expect(await screen.findByRole("status")).toHaveTextContent("Form link copied.");
    expect(screen.getByRole("button", { name: "Download QR for Project enquiry" })).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Enquiry forms" })).getByText("12")).toBeInTheDocument();
  });
  it("adds an enquiry field, previews it, and saves and reloads the draft", async () => {
    const { saves } = mockApi(); const user = await openBuilder();
    const palette = await openPalette(user);
    expect(within(palette).queryByRole("button", { name: "Add Budget" })).not.toBeInTheDocument();
    expect(within(palette).queryByRole("button", { name: "Add Email" })).not.toBeInTheDocument();
    await user.click(within(palette).getByRole("button", { name: "Add Property type" }));
    expect(within(palette).queryByRole("button", { name: "Add Property type" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Preview form" }));
    const preview = await screen.findByRole("dialog", { name: "Form preview" });
    expect(within(preview).getByRole("checkbox", { name: "Villa" })).toBeInTheDocument();
    // The preview is the public form: light, whatever the workspace theme.
    expect(within(preview).getByRole("checkbox", { name: "Villa" }).closest("[data-wd-theme]")).toHaveAttribute("data-wd-theme", "light");
    await user.click(within(preview).getByRole("button", { name: "Close dialog" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Draft saved.")).toBeInTheDocument();
    expect(saves[0]).toMatchObject({ version: 1, action: "save" });
    expect(saves[0].draft.questions.at(-1)).toMatchObject({ title: "Property type", type: "checkboxes", field: `cf:${FIELD_ID}`, options: [{ label: "Villa" }, { label: "Apartment" }] });
    await user.click(screen.getByRole("button", { name: "Back to forms" }));
    await user.click(await screen.findByRole("button", { name: /Edit form Project enquiry/ }));
    expect(screen.getByRole("button", { name: "Drag Property type to reorder" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByText("Form published. Its link is ready to share.")).toBeInTheDocument();
    expect(saves[1]).toMatchObject({ version: 2, action: "publish" });
    const share = await screen.findByRole("dialog", { name: "Share enquiry form" });
    expect((within(share).getByRole("textbox", { name: "Form link" }) as HTMLInputElement).value).toMatch(/\/enquiry\/test-token$/);
    await user.click(within(share).getByRole("button", { name: "Close dialog" }));
    expect(screen.getByRole("button", { name: "Share form" })).toBeInTheDocument();
  });

  it("shows the workspace brand and links a response to its enquiry", async () => {
    mockApi(); const user = userEvent.setup();
    render(<LeadFormBuilder initialData={structuredClone(leadsPageFixture)} autosaveDelay={0} initialBranding={{ logoUrl: "/api/auth/tenant-logo/test", primaryColor: "#35715b", secondaryColor: null, workspaceName: "Test Company", canManage: true }} />);
    await user.click(await screen.findByRole("button", { name: /Edit form Project enquiry/ }));
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("img", { name: "Test Company logo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace logo" })).toBeEnabled();
    await user.click(screen.getByRole("tab", { name: "Responses" }));
    expect(await screen.findByText("E-0007")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Search responses" }), "nobody");
    expect(screen.queryByText("E-0007")).not.toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "Search responses" }));
    await user.click(screen.getByText("E-0007"));
    expect(screen.getByRole("link", { name: "Open E-0007 in Enquiries" })).toHaveAttribute("href", "/workspace/crm/leads?lead=62000000-0000-4000-8000-000000000001");
  });

  it("provides touch/keyboard reorder controls and protects required lead fields", async () => {
    const { saves } = mockApi(); const user = await openBuilder();
    // Cards start folded: one line each, and one opens at a time.
    expect(screen.queryByRole("switch", { name: "Required" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Your name/, expanded: false }));
    expect(screen.getByRole("switch", { name: "Required" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Field label" })).toHaveValue("Your name");
    expect(screen.queryByRole("button", { name: "Delete Your name" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duplicate" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Mobile number/, expanded: false }));
    expect(screen.getAllByRole("switch", { name: "Required" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^Your name/ })).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "Move Your name down" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("Draft saved.");
    expect(saves[0].draft.questions.map(question => question.id)).toEqual(["mobile", "name", "email", "location"]);
    await user.click(screen.getByRole("button", { name: "Delete Email address" }));
    const palette = await openPalette(user);
    expect(within(palette).getByRole("button", { name: "Add Email" })).toBeInTheDocument();
    // A deleted question comes back where it was.
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(within(palette).queryByRole("button", { name: "Add Email" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Email address" })).toBeInTheDocument();
  });

  it("creates a new enquiry field from the form and keeps edits after a failed save", async () => {
    const { fetchMock, saves } = mockApi(); const user = await openBuilder();
    const created = { id: "9f3d8e3a-4b2c-4e77-9f90-2c3d4e5f6071", key: "floor_ab12cd", label: "Floor", dataType: "text", configuration: {}, visible: true, position: 2, version: 1 };
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => created } as never);
    await user.click(within(await openPalette(user)).getByRole("button", { name: "Short answer" }));
    await user.type(await screen.findByRole("textbox", { name: "Name" }), "Floor");
    await user.click(screen.getByRole("button", { name: "Add field" }));
    const request = fetchMock.mock.calls.find(([url, init]) => String(url).includes("custom-fields") && init?.method === "POST") as unknown as [string, { body: string }];
    expect(JSON.parse(request[1].body)).toMatchObject({ entityType: "enquiry", label: "Floor", dataType: "text" });
    expect(await screen.findByRole("button", { name: "Drag Floor to reorder" })).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ message: "Connection failed. Please try again." }) } as never);
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Connection failed. Please try again.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Draft saved.")).toBeInTheDocument();
    expect(saves.at(-1)!.draft.questions.at(-1)).toMatchObject({ title: "Floor", field: `cf:${created.id}` });
  });

  it("retries a failed form load and creates a form", async () => {
    const { fetchMock } = mockApi();
    fetchMock.mockRejectedValueOnce(new Error("Forms could not be loaded."));
    const user = userEvent.setup();
    render(<LeadFormBuilder initialData={structuredClone(leadsPageFixture)} autosaveDelay={0} />);
    await user.click(await screen.findByRole("button", { name: "Retry loading forms" }));
    await screen.findByRole("button", { name: /Edit form Project enquiry/ });
    await user.click(screen.getByRole("button", { name: "New form" }));
    await user.click(within(await screen.findByRole("dialog", { name: "New form" })).getByRole("button", { name: /Default enquiry form/ }));
    expect(await openPalette(user)).toBeInTheDocument();
    // Nothing is created until the form is saved.
    expect(fetchMock.mock.calls.some(([url, init]) => init?.method === "POST" && String(url).includes("/lead-forms?"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => init?.method === "POST" && String(url).includes("/lead-forms?"))).toBe(true));
  });

  it("adds every shown enquiry field once and saves their order", async () => {
    const { saves } = mockApi(); const user = await openBuilder();
    const palette = await openPalette(user);
    for (const name of ["Emirate", "Area / city", "Enquiry type", "Project details", "Property type"]) await user.click(within(palette).getByRole("button", { name: `Add ${name}` }));
    expect(within(palette).getByText("Every field is on this form.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].draft.questions.slice(4).map(question => question.field)).toEqual(["emirate", "area", "serviceType", "summary", `cf:${FIELD_ID}`]);
  }, 10_000);
});

describe("LeadFormBuilder flows", () => {
  it("starts a form from a template built from enquiry fields", async () => {
    const { saves } = mockApi(); const user = userEvent.setup();
    render(<LeadFormBuilder initialData={withFields()} autosaveDelay={0} />);
    await user.click(await screen.findByRole("button", { name: "New form" }));
    await user.click(within(await screen.findByRole("dialog", { name: "New form" })).getByRole("button", { name: /Callback request/ }));
    expect(await screen.findByText("Unsaved changes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].draft.title).toBe("Request a callback");
    expect(saves[0].draft.questions.map(question => [question.field, question.title, question.required])).toEqual([
      ["mobile", "Mobile number", true], ["displayName", "Your name", true], ["emirate", "Emirate", true],
      ["serviceType", "What should we call about?", true], ["summary", "Best time to call", false],
    ]);
  });

  it("deletes a draft that was never published, after asking", async () => {
    const { fetchMock } = mockApi(); const user = userEvent.setup();
    render(<LeadFormBuilder initialData={withFields()} autosaveDelay={0} />);
    await user.click(await screen.findByRole("button", { name: "Delete the draft Project enquiry" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Delete the draft Project enquiry?" })).getByRole("button", { name: "Delete draft" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => init?.method === "DELETE" && String(url).includes("/lead-forms/form-one?version=1"))).toBe(true));
    expect(await screen.findByText("Draft deleted.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit form Project enquiry/ })).not.toBeInTheDocument();
  });

  it("saves the draft by itself after an edit", async () => {
    const { saves } = mockApi(); const user = userEvent.setup();
    render(<LeadFormBuilder initialData={withFields()} autosaveDelay={20} />);
    await user.click(await screen.findByRole("button", { name: /Edit form Project enquiry/ }));
    await user.click(screen.getByRole("button", { name: "Move Your name down" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ version: 1, action: "save" });
    expect(await screen.findByText("Draft saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
  });

  it("shows the live public form beside the questions on a wide screen, always light", async () => {
    mockApi();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(min-width: 80rem)", addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const user = await openBuilder();
    const preview = screen.getByRole("complementary", { name: "Live preview" });
    expect(within(preview).getByRole("heading", { name: "Project enquiry" })).toBeInTheDocument();
    expect(within(preview).getByRole("textbox", { name: "Your name" }).closest("[data-wd-theme]")).toHaveAttribute("data-wd-theme", "light");
    expect(within(preview).getByRole("button", { name: "Submit enquiry" })).toBeDisabled();
    expect(within(preview).getByText("Tick the box to submit")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Your name/, expanded: false }));
    await user.clear(screen.getByRole("textbox", { name: "Field label" }));
    await user.type(screen.getByRole("textbox", { name: "Field label" }), "Full name");
    expect(within(preview).getByRole("textbox", { name: "Full name" })).toBeInTheDocument();
  });

  it("shares a tagged link, WhatsApp text and embed code", async () => {
    mockApi(); const user = await openBuilder();
    await user.click(screen.getByRole("button", { name: "Publish" }));
    const share = await screen.findByRole("dialog", { name: "Share enquiry form" });
    await user.type(within(share).getByRole("textbox", { name: "Placement" }), "Showroom door");
    await user.click(within(share).getByRole("radio", { name: "One question per screen" }));
    const link = (within(share).getByRole("textbox", { name: "Form link" }) as HTMLInputElement).value;
    expect(link).toMatch(/\/enquiry\/test-token\?placement=showroom-door&layout=steps$/);
    expect(within(share).getByRole("textbox", { name: "WhatsApp message" })).toHaveValue(`Project enquiry: share a few details and we will get back to you. ${link}`);
    expect(within(share).getByRole("link", { name: "Open WhatsApp" })).toHaveAttribute("href", expect.stringContaining("https://wa.me/?text="));
    expect((within(share).getByRole("textbox", { name: "Embed code" }) as HTMLInputElement).value).toContain(`<iframe src="${link}"`);
  });
});

describe("form ordering and validation", () => {
  const questions = fixture.draft.questions;
  it("reorders in both directions without losing fields or duplicating IDs", () => {
    expect(reorderQuestions(questions, new Set(["name"]), "email", "after").map(q => q.id)).toEqual(["mobile", "email", "name", "location"]);
    expect(reorderQuestions(questions, new Set(["location"]), "name", "before").map(q => q.id)).toEqual(["location", "name", "mobile", "email"]);
    expect(reorderQuestions(questions, new Set(["name"]), "name", "after")).toBe(questions);
    expect(questions.map(q => q.id)).toEqual(["name", "mobile", "email", "location"]);
  });
  it("requires labels and choices before publication but allows incomplete draft labels", () => {
    const draft = structuredClone(fixture.draft); draft.questions[0].title = "";
    expect(validateDraft(draft, false)).toBe("");
    expect(validateDraft(draft, true)).toContain("field 1");
    draft.title = " "; expect(validateDraft(draft, false)).toContain("form title");
  });
});
