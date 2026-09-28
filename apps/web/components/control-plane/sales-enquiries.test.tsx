import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { DesignSystemProvider, ToastProvider } from "@/design-system";
import type { SalesContactFormSettings, SalesEnquiryDetail, SalesEnquirySummary } from "@/lib/internal/sales";
import { ContactFormSettings } from "./contact-form-settings";
import { SalesEnquiriesPage } from "./sales-enquiries-page";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const search = vi.hoisted(() => ({ value: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => search.value, usePathname: () => "/internal/sales-enquiries" }));

type Call = { url: string; init?: RequestInit; body?: Record<string, unknown> };
function mount(respond: (url: string, init?: RequestInit) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const value = respond(url, init);
    if (value instanceof Error) return Response.json({ message: value.message }, { status: 409 });
    return Response.json(value ?? {});
  }));
  return calls;
}

const ID = "6a1f0f3e-5b4e-4f0e-9c8a-1f2d3e4b5a60";
const OTHER = "7b2a1e4f-6c5d-4a1f-8d9b-2e3f4a5b6c71";
const NOW = new Date().toISOString();
const summary = (overrides: Partial<SalesEnquirySummary> = {}): SalesEnquirySummary => ({
  id: ID, reference: "SE-0007", name: "Lena Fischer", email: "lena@fischer.example", company: "Fischer Interiors", countryCode: "DE",
  phone: "+4915112345678", teamSize: "11–50", status: "new", assignee: null, source: "landing", createdAt: NOW, updatedAt: NOW, version: 1, ...overrides,
});
const detail = (overrides: Partial<SalesEnquiryDetail> = {}): SalesEnquiryDetail => ({
  ...summary(), message: "We run three studios.\nNeed quotes fast.", teamSizeId: "11-50",
  consentText: "I agree that Wodana may contact me about this enquiry.", consentedAt: NOW, pagePath: "/", referrer: null,
  utm: { source: "google", medium: null, campaign: null, term: null, content: null }, locale: "en", formVersion: 1,
  contactedAt: null, qualifiedAt: null, closedAt: null, nextStatuses: ["contacted", "lost"], notes: [],
  history: [{ id: "h1", action: "received", actorName: null, details: { source: "landing" }, createdAt: NOW }],
  notices: [{ id: "n1", recipient: "sales@wodana.example", status: "sent", lastAttemptedAt: NOW }], ...overrides,
});
const list = () => ({
  enquiries: [summary(), summary({ id: OTHER, reference: "SE-0008", name: "Omar Haddad", email: "omar@haddad.example", company: null, countryCode: "AE", status: "contacted",
    assignee: { userId: "op-1", name: "Ada Operator" } })],
  counts: { new: 1, contacted: 1 }, total: 2, observedAt: NOW,
});
const form = (): SalesContactFormSettings => ({
  version: 3,
  configuration: {
    fields: {
      name: { enabled: true, required: true, label: null }, email: { enabled: true, required: true, label: null },
      company: { enabled: true, required: true, label: null }, country: { enabled: true, required: true, label: null },
      phone: { enabled: true, required: false, label: null }, teamSize: { enabled: true, required: false, label: null },
      message: { enabled: true, required: false, label: null },
    },
    teamSizes: [{ id: "1-10", label: "1–10" }, { id: "11-50", label: "11–50" }],
    consentLabel: null, thankYouTitle: null, thankYouMessage: null, recipients: ["sales@wodana.example"],
  },
  history: [{ version: 3, createdAt: NOW, createdByName: "Ada Operator" }],
});
const assignees = { assignees: [{ userId: "op-1", name: "Ada Operator", email: "ada@wodana.example" }] };
const Providers = ({ children }: { children: ReactNode }) => <DesignSystemProvider><ToastProvider>{children}</ToastProvider></DesignSystemProvider>;

afterEach(() => {
  vi.unstubAllGlobals();
  router.push.mockReset(); router.replace.mockReset();
  search.value = new URLSearchParams();
});

describe("sales enquiries list", () => {
  it("shows every status with its count, and filters by status chip and search", async () => {
    mount(() => list());
    render(<Providers><SalesEnquiriesPage canManage /></Providers>);
    expect(await screen.findByText("Lena Fischer")).toBeInTheDocument();
    expect(screen.getByText("Omar Haddad")).toBeInTheDocument();
    const chips = within(screen.getByRole("group", { name: "Status" }));
    expect(chips.getByRole("button", { name: /^All/ })).toHaveTextContent("2");
    expect(chips.getByRole("button", { name: /^New/ })).toHaveTextContent("1");
    expect(chips.getByRole("button", { name: /^Won/ })).toHaveTextContent("0");
    expect(chips.getByRole("button", { name: /^Lost/ })).toHaveTextContent("0");
    expect(screen.getAllByText("Germany · DE").length).toBeGreaterThan(0);
    await userEvent.click(chips.getByRole("button", { name: /^Contacted/ }));
    await waitFor(() => expect(screen.queryByText("Lena Fischer")).not.toBeInTheDocument());
    expect(screen.getByText("Omar Haddad")).toBeInTheDocument();
    await userEvent.click(chips.getByRole("button", { name: /^All/ }));
    await userEvent.type(screen.getByRole("searchbox"), "SE-0007");
    await waitFor(() => expect(screen.queryByText("Omar Haddad")).not.toBeInTheDocument());
    expect(screen.getByText("Lena Fischer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export filtered rows" })).toBeInTheDocument();
  });

  it("says when there are no enquiries yet, without a fake action", async () => {
    mount(() => ({ enquiries: [], counts: {}, total: 0, observedAt: NOW }));
    render(<Providers><SalesEnquiriesPage canManage={false} /></Providers>);
    expect(await screen.findByText("No enquiries yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Contact form" })).toBeInTheDocument();
  });
});

describe("sales enquiry inspector", () => {
  const respond = (url: string) => {
    if (url.endsWith("/assignees")) return assignees;
    if (url.endsWith("/status")) return detail({ status: "contacted", version: 2, nextStatuses: ["qualified", "lost"], contactedAt: NOW });
    if (url.endsWith("/notes")) return detail({ notes: [{ id: "note-1", body: "Called, no answer.", authorName: "Ada Operator", createdAt: NOW }] });
    if (url.endsWith(`/sales-enquiries/${ID}`)) return detail();
    return list();
  };

  it("opens from the link, shows the answers and marks the enquiry contacted with the version it saw", async () => {
    search.value = new URLSearchParams({ enquiry: ID });
    const calls = mount(respond);
    render(<Providers><SalesEnquiriesPage canManage /></Providers>);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "SE-0007 · Lena Fischer" })).toBeInTheDocument();
    expect(await within(dialog).findByRole("link", { name: "lena@fischer.example" })).toHaveAttribute("href", "mailto:lena@fischer.example");
    expect(within(dialog).getByText("sales@wodana.example")).toBeInTheDocument();
    expect(within(dialog).getByText("Sent")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark contacted" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/status"))).toBe(true));
    const status = calls.find((call) => call.url.endsWith("/status"))!;
    expect(status.url).toBe(`/api/internal/sales-enquiries/${ID}/status`);
    expect(status.body).toEqual({ expectedVersion: 1, status: "contacted" });
    expect(await within(dialog).findByRole("button", { name: "Mark qualified" })).toBeInTheDocument();
    // The open drawer hides the page from assistive technology; the list behind it still moved the count.
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Status", hidden: true })).getByRole("button", { name: /^New/, hidden: true })).toHaveTextContent("0"));
  });

  it("adds a note with a client-side key", async () => {
    search.value = new URLSearchParams({ enquiry: ID });
    const calls = mount(respond);
    render(<Providers><SalesEnquiriesPage canManage /></Providers>);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(await within(dialog).findByRole("tab", { name: /Notes/ }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Note" }), "Called, no answer.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/notes"))).toBe(true));
    const note = calls.find((call) => call.url.endsWith("/notes"))!;
    expect(note.body).toMatchObject({ body: "Called, no answer." });
    expect(String(note.body?.noteId)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await within(dialog).findByText("Called, no answer.")).toBeInTheDocument();
  });

  it("is read-only without the manage permission", async () => {
    search.value = new URLSearchParams({ enquiry: ID });
    mount(respond);
    render(<Providers><SalesEnquiriesPage canManage={false} /></Providers>);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Lena Fischer")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Mark contacted" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Mark lost" })).not.toBeInTheDocument();
  });
});

describe("contact form settings", () => {
  it("saves the draft with the version it saw and one request key, keeping name and email required", async () => {
    const calls = mount((url, init) => init?.method === "PUT"
      ? { ...form(), version: 4, configuration: (JSON.parse(String(init.body)) as { configuration: SalesContactFormSettings["configuration"] }).configuration,
        history: [{ version: 4, createdAt: NOW, createdByName: "Ada Operator" }, ...form().history] }
      : form());
    render(<Providers><ContactFormSettings canManage /></Providers>);
    expect(await screen.findByRole("heading", { level: 1, name: "Contact form" })).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    const shown = screen.getAllByRole("switch", { name: "Shown" });
    const required = screen.getAllByRole("switch", { name: "Required" });
    expect(shown).toHaveLength(7);
    expect(shown[0]).toBeDisabled(); expect(shown[1]).toBeDisabled();
    expect(required[0]).toBeDisabled(); expect(required[1]).toBeDisabled();
    expect(required[0]).toBeChecked(); expect(required[1]).toBeChecked();
    expect(screen.getAllByText("Always required")).toHaveLength(2);
    await userEvent.click(required[6]);
    await userEvent.type(screen.getByRole("textbox", { name: "Label for Company" }), "Studio");
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(calls.some((call) => call.init?.method === "PUT")).toBe(true));
    const put = calls.find((call) => call.init?.method === "PUT")!;
    expect(put.url).toBe("/api/internal/sales-contact-form");
    expect(new Headers(put.init?.headers).get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(put.body).toMatchObject({ expectedVersion: 3, configuration: {
      fields: { name: { enabled: true, required: true }, email: { enabled: true, required: true }, company: { label: "Studio" }, message: { enabled: true, required: true } },
      recipients: ["sales@wodana.example"],
    } });
    expect(await screen.findByText(/Version 4 · saved .* by Ada Operator/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
  });

  it("keeps the draft and offers a reload when the form changed elsewhere", async () => {
    mount((_url, init) => (init?.method === "PUT" ? new Error("The form changed. Refresh and try again.") : form()));
    render(<Providers><ContactFormSettings canManage /></Providers>);
    await screen.findByRole("heading", { level: 1, name: "Contact form" });
    await userEvent.click(screen.getAllByRole("switch", { name: "Required" })[6]);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The form changed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getAllByRole("switch", { name: "Required" })[6]).toBeChecked();
  });

  it("offers no save without the manage permission", async () => {
    mount(() => form());
    render(<Providers><ContactFormSettings canManage={false} /></Providers>);
    await screen.findByRole("heading", { level: 1, name: "Contact form" });
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("switch", { name: "Shown" })[2]).toBeDisabled();
  });
});
