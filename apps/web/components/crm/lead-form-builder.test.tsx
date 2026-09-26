import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  render(<LeadFormBuilder initialData={withFields()} />);
  await user.click(await screen.findByRole("button", { name: /Edit form Project enquiry/ }));
  return user;
}
afterEach(() => vi.unstubAllGlobals());

describe("LeadFormBuilder", () => {
  it("shows a focused form gallery and keeps attribution in settings", async () => {
    mockApi();
    render(<LeadFormBuilder initialData={structuredClone(leadsPageFixture)} />);
    expect(await screen.findByRole("button", { name: /Edit form Project enquiry/ })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search forms" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Enquiry forms" })).not.toBeInTheDocument();
  });
  it("adds an enquiry field, previews it, and saves and reloads the draft", async () => {
    const { saves } = mockApi(); const user = await openBuilder();
    const palette = screen.getByRole("complementary", { name: "Enquiry fields" });
    expect(within(palette).queryByRole("button", { name: "Add Budget" })).not.toBeInTheDocument();
    expect(within(palette).queryByRole("button", { name: "Add Email" })).not.toBeInTheDocument();
    await user.click(within(palette).getByRole("button", { name: "Add Property type" }));
    expect(within(palette).queryByRole("button", { name: "Add Property type" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Preview form" }));
    const preview = await screen.findByRole("dialog", { name: "Form preview" });
    expect(within(preview).getByRole("checkbox", { name: "Villa" })).toBeInTheDocument();
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
    render(<LeadFormBuilder initialData={structuredClone(leadsPageFixture)} initialBranding={{ logoUrl: "/api/auth/tenant-logo/test", primaryColor: "#35715b", secondaryColor: null, workspaceName: "Test Company", canManage: true }} />);
    await user.click(await screen.findByRole("button", { name: /Edit form Project enquiry/ }));
    await user.click(screen.getByRole("button", { name: "Brand" }));
    expect(screen.getByRole("img", { name: "Test Company logo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace logo" })).toBeEnabled();
    await user.click(screen.getByRole("tab", { name: "Responses" }));
    expect(await screen.findByText("E-0007")).toBeInTheDocument();
    await user.click(screen.getByText("E-0007"));
    expect(screen.getByRole("link", { name: "Open E-0007 in Enquiries" })).toHaveAttribute("href", "/workspace/crm/leads?lead=62000000-0000-4000-8000-000000000001");
  });

  it("provides touch/keyboard reorder controls and protects required lead fields", async () => {
    const { saves } = mockApi(); const user = await openBuilder();
    expect(screen.getByRole("checkbox", { name: "Required" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Delete Your name" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duplicate" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move Your name down" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("Draft saved.");
    expect(saves[0].draft.questions.map(question => question.id)).toEqual(["mobile", "name", "email", "location"]);
    await user.click(screen.getByRole("button", { name: "Delete Email address" }));
    expect(within(screen.getByRole("complementary", { name: "Enquiry fields" })).getByRole("button", { name: "Add Email" })).toBeInTheDocument();
  });

  it("creates a new enquiry field from the form and keeps edits after a failed save", async () => {
    const { fetchMock, saves } = mockApi(); const user = await openBuilder();
    const created = { id: "9f3d8e3a-4b2c-4e77-9f90-2c3d4e5f6071", key: "floor_ab12cd", label: "Floor", dataType: "text", configuration: {}, visible: true, position: 2, version: 1 };
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => created } as never);
    await user.click(within(screen.getByRole("complementary", { name: "Enquiry fields" })).getByRole("button", { name: "New field" }));
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
    render(<LeadFormBuilder initialData={structuredClone(leadsPageFixture)} />);
    await user.click(await screen.findByRole("button", { name: "Retry loading forms" }));
    await screen.findByRole("button", { name: /Edit form Project enquiry/ });
    await user.click(screen.getByRole("button", { name: "New form" }));
    expect(await screen.findByRole("complementary", { name: "Enquiry fields" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
  });

  it("adds every shown enquiry field once and saves their order", async () => {
    const { saves } = mockApi(); const user = await openBuilder();
    const palette = screen.getByRole("complementary", { name: "Enquiry fields" });
    for (const name of ["Emirate", "Area / city", "Enquiry type", "Project details", "Property type"]) await user.click(within(palette).getByRole("button", { name: `Add ${name}` }));
    expect(within(palette).getByText("Every field is on this form.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].draft.questions.slice(4).map(question => question.field)).toEqual(["emirate", "area", "serviceType", "summary", `cf:${FIELD_ID}`]);
  }, 10_000);
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
