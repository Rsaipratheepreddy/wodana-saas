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

async function openBuilder() {
  const user = userEvent.setup();
  render(<LeadFormBuilder initialData={structuredClone(leadsPageFixture)} />);
  await user.click(await screen.findByRole("button", { name: "Edit form" }));
  return user;
}
afterEach(() => vi.unstubAllGlobals());

describe("LeadFormBuilder", () => {
  it("shows form attribution without implying a social account connection", async () => {
    mockApi();
    render(<LeadFormBuilder initialData={structuredClone(leadsPageFixture)} />);
    const table = await screen.findByRole("table", { name: "Enquiry forms" });
    expect(within(table).getByRole("columnheader", { name: "Source" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Channel" })).toBeInTheDocument();
    expect(screen.getByText(/does not connect social inboxes or lead ads/i)).toBeInTheDocument();
  });
  it("adds field types, updates live preview without clearing answers, and saves and reloads the draft", async () => {
    const { saves } = mockApi(); const user = await openBuilder();
    const preview = screen.getByRole("complementary", { name: "Live form preview" });
    await user.type(within(preview).getByRole("textbox", { name: "Your name" }), "Preview customer");
    await user.click(screen.getByRole("button", { name: "Add multiple choice" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Field label" }), { target: { value: "Property type" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Option 1" }), { target: { value: "Villa" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Option 2" }), { target: { value: "Apartment" } });
    expect(within(preview).getByRole("radio", { name: "Villa" })).toBeInTheDocument();
    expect(within(preview).getByRole("textbox", { name: "Your name" })).toHaveValue("Preview customer");
    expect(within(preview).getByRole("button", { name: "Submit enquiry" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Draft saved.")).toBeInTheDocument();
    expect(saves[0]).toMatchObject({ version: 1, action: "save" });
    expect(saves[0].draft.questions.at(-1)).toMatchObject({ title: "Property type", type: "radio", field: "custom", options: [{ label: "Villa" }, { label: "Apartment" }] });
    await user.click(screen.getByRole("button", { name: "Back to forms" }));
    await user.click(await screen.findByRole("button", { name: "Edit form" }));
    expect(screen.getByRole("button", { name: "Drag Property type to reorder" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByText("Form published. Its link is ready to share.")).toBeInTheDocument();
    expect(saves[1]).toMatchObject({ version: 2, action: "publish" });
    expect(screen.getByRole("button", { name: "Share form" })).toBeInTheDocument();
  });

  it("provides touch/keyboard reorder controls and protects required lead fields", async () => {
    const { saves } = mockApi(); const user = await openBuilder();
    expect(screen.getByRole("checkbox", { name: "Required" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move Your name down" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("Draft saved.");
    expect(saves[0].draft.questions.map(question => question.id)).toEqual(["mobile", "name", "email", "location"]);
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(screen.getByRole("textbox", { name: "Field label" })).toHaveValue("Your name (copy)");
    expect(screen.getByRole("checkbox", { name: "Required" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("button", { name: /Your name \(copy\)/ })).not.toBeInTheDocument();
  });

  it("edits choices and field types, shows helpful validation, and retains edits after a failed save", async () => {
    const { fetchMock } = mockApi(); const user = await openBuilder();
    await user.click(screen.getByRole("button", { name: "Add dropdown" }));
    await user.clear(screen.getByRole("textbox", { name: "Option 1" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText(/Dropdown: enter a label for every option/)).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Option 1" }), "Office");
    await user.click(screen.getByRole("button", { name: "Dropdown Field type" }));
    await user.click(screen.getByRole("option", { name: "Date" }));
    expect(screen.queryByRole("textbox", { name: "Option 1" })).not.toBeInTheDocument();
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ message: "Connection failed. Please try again." }) } as never);
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Connection failed. Please try again.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Field label" })).toHaveValue("Dropdown");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Draft saved.")).toBeInTheDocument();
  });

  it("retries a failed form load and creates a form", async () => {
    const { fetchMock } = mockApi();
    fetchMock.mockRejectedValueOnce(new Error("Forms could not be loaded."));
    const user = userEvent.setup();
    render(<LeadFormBuilder initialData={structuredClone(leadsPageFixture)} />);
    await user.click(await screen.findByRole("button", { name: "Retry loading forms" }));
    await screen.findByRole("button", { name: "Edit form" });
    await user.click(screen.getByRole("button", { name: "New form" }));
    expect(await screen.findByRole("complementary", { name: "Live form preview" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
  });

  it("adds all nine field types and resets preview answers without changing the form", async () => {
    const { saves } = mockApi(); const user = await openBuilder();
    for (const type of ["short answer", "paragraph", "multiple choice", "checkboxes", "dropdown", "email", "phone number", "number", "date"]) await user.click(screen.getByRole("button", { name: `Add ${type}` }));
    const preview = screen.getByRole("complementary", { name: "Live form preview" });
    fireEvent.change(within(preview).getByRole("textbox", { name: "Your name" }), { target: { value: "Test answer" } });
    await user.click(screen.getByRole("button", { name: "Reset answers" }));
    expect(within(preview).getByRole("textbox", { name: "Your name" })).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].draft.questions.slice(4).map(question => question.type)).toEqual(["text", "paragraph", "radio", "checkboxes", "dropdown", "email", "tel", "number", "date"]);
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
