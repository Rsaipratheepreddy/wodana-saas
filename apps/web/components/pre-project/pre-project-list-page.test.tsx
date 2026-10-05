import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreProjectList } from "@/lib/pre-project/types";
import { PreProjectListPage } from "./pre-project-list-page";

const { replace, refresh, push } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh, push }) }));
const record = {
  id: "00000000-0000-4000-8000-000000000001", title: "Villa interiors", description: null,
  status: "active" as const, customerId: "customer-1", customerName: "Khalid Rahman",
  opportunityId: "opportunity-1", opportunityStatus: "open", leadId: null,
  leadManagerName: "Iglo Administrator", amount: null, currencyCode: null,
  createdAt: "2026-09-06T10:00:00Z", updatedAt: "2026-09-06T10:00:00Z",
};
const data: PreProjectList = { items: [record], total: 1, canCreate: true, workspaceId: "workspace-1" };

describe("pre-project table selector", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());
  it("shows qualified leads in the same table without linking to a nonexistent case", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ members: [{ id: "manager-1", name: "Iglo Administrator" }] }) }));
    render(<PreProjectListPage initialData={{ ...data, canStartLead: true, items: [{ ...record, status: "qualified", qualifiedLead: true, leadId: "lead-1", leadVersion: 3, opportunityId: null }] }} search="" />);
    expect(within(screen.getByRole("table")).getAllByText("Qualified")[0]).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Villa interiors" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start Villa interiors" }));
    const dialog = await screen.findByRole("dialog", { name: "Start planning" });
    expect((await within(dialog).findAllByLabelText(/Next follow-up date/)).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("button", { name: "Start planning" })).toBeDisabled();
  });
  it("disables start for a qualified lead when the user only has view access", () => {
    render(<PreProjectListPage initialData={{ ...data, canCreate: false, canStartLead: false, items: [{ ...record, status: "qualified", qualifiedLead: true, opportunityId: null }] }} search="" />);
    expect(screen.getByRole("button", { name: "Start Villa interiors" })).toBeDisabled();
  });
  it("always shows the table with customer initials and real case links", () => {
    render(<PreProjectListPage initialData={data} search="view=cards" />);
    const table = screen.getByRole("table", { name: "Planning cases" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Client", "Case", "Phase", "Status", "Owner", "Value", "Target", "Priority", "Risk", "Updated", "Created", "Action"]);
    expect(within(table).getByRole("img", { name: "Khalid Rahman" })).toHaveTextContent("KR");
    expect(within(table).getByRole("link", { name: "Open Villa interiors" })).toHaveAttribute("href", `/workspace/pre-projects/cases/${record.id}/requirements`);
    expect(screen.queryByRole("button", { name: "Cards" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Table options" })).toBeInTheDocument();
    expect(table.closest(".wd-table-scroll")).not.toBeNull();
  });
  it("searches all server pages as you type and drops obsolete filters", async () => {
    render(<PreProjectListPage initialData={data} search="view=cards&status=released&page=2&search=Villa" />);
    expect(screen.queryByRole("heading", { name: "Cases" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Planning status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start planning" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search cases" }), { target: { value: "Palm" } });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/workspace/pre-projects?search=Palm"));
  });
  it("keeps the server page and section when paging or opening an existing case", () => {
    render(<PreProjectListPage initialData={{ ...data, total: 70 }} search="page=2&section=designs" />);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("navigation", { name: "Planning cases pagination" })).toHaveTextContent("Page 2 of 3");
        fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(replace).toHaveBeenCalledWith("/workspace/pre-projects?page=3&section=designs");
    expect(screen.getByRole("link", { name: "Open Villa interiors" })).toHaveAttribute("href", `/workspace/pre-projects/cases/${record.id}/designs?page=2&section=designs`);
  });
  it("starts an opportunity once and redirects to the requested case section", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "created-case" }) });
    vi.stubGlobal("fetch", fetcher);
    render(<PreProjectListPage initialData={{ ...data, items: [{ ...record, qualifiedLead: true, status: "qualified" }] }} search="section=quotations"/>);
    fireEvent.click(screen.getByRole("button", { name: "Start Villa interiors" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/workspace/pre-projects/cases/created-case/quotations?section=quotations"));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ opportunityId: record.opportunityId });
  });
  it("distinguishes an empty first list from an empty filtered list and keeps the section on clear", () => {
    render(<PreProjectListPage initialData={{ ...data, items: [], total: 0 }} search="section=site&search=Villa" />);
    expect(screen.getByText("No matching cases")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear search" })[1]);
    expect(replace).toHaveBeenCalledWith("/workspace/pre-projects?section=site");
  });
  it("shows load errors and retries without suggesting a fake zero count", () => {
    render(<PreProjectListPage initialData={{ ...data, items: [], total: 0, error: "Unable to connect" }} search="" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to connect");
    expect(screen.queryByLabelText("0 qualified leads")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
