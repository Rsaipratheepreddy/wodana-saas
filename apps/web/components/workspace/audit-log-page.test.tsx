import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditLogFixture, type AuditEvent } from "@/lib/workspace/audit-log";
import { AuditLogPage } from "./audit-log-page";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuditLogPage", () => {
  it("searches readable audit events and opens immutable change details", async () => {
    const interaction = userEvent.setup();
    render(<AuditLogPage initialData={{ ...structuredClone(auditLogFixture), nextCursor: null }} />);

    expect(screen.getByRole("table", { name: "Workspace audit log" })).toBeInTheDocument();
    expect(screen.getByText("Member invited")).toBeInTheDocument();

    await interaction.type(screen.getByRole("searchbox", { name: "Search audit log" }), "google");
    expect(screen.getByText("Connection completed")).toBeInTheDocument();
    expect(screen.queryByText("Member invited")).not.toBeInTheDocument();

    await interaction.clear(screen.getByRole("searchbox", { name: "Search audit log" }));
    await interaction.click(screen.getByRole("button", { name: "View Member invited details" }));
    const dialog = await screen.findByRole("dialog", { name: "Member invited" });
    expect(within(dialog).getByText("Changed fields")).toBeInTheDocument();
    expect(within(dialog).getByText("Email")).toBeInTheDocument();
    expect(within(dialog).getByText("Roles")).toBeInTheDocument();
  });

  it("names events and records in the product's words, not table names", () => {
    const base = structuredClone(auditLogFixture.items[0]);
    const items: AuditEvent[] = [
      { ...base, id: "70000000-0000-4000-8000-000000000011", action: "pre_project.case_started.v1", entityType: "pre_project_case" },
      { ...base, id: "70000000-0000-4000-8000-000000000012", action: "crm.lead_created.v1", entityType: "crm_lead" },
      { ...base, id: "70000000-0000-4000-8000-000000000013", action: "workspace.invitation_sent.v1", entityType: "workspace_invitation" },
    ];
    render(<AuditLogPage initialData={{ ...structuredClone(auditLogFixture), items, nextCursor: null }} />);
    const table = within(screen.getByRole("table", { name: "Workspace audit log" }));
    for (const text of ["Planning case started", "Planning case", "Enquiry created", "Enquiry", "Invitation sent", "Invitation"]) expect(table.getByText(text)).toBeInTheDocument();
    expect(table.queryByText(/Crm|Pre Project|Workspace Invitation/)).toBeNull();
  });

  it("finds events by the names it shows", async () => {
    const interaction = userEvent.setup();
    const base = structuredClone(auditLogFixture.items[0]);
    const items: AuditEvent[] = [
      { ...base, id: "70000000-0000-4000-8000-000000000021", action: "hrms.leave_decided.v1", entityType: "hrms_leave_request" },
      { ...base, id: "70000000-0000-4000-8000-000000000022", action: "security.view_as_started.v1", entityType: "view_as_session" },
    ];
    render(<AuditLogPage initialData={{ ...structuredClone(auditLogFixture), items, nextCursor: null }} />);
    const table = within(screen.getByRole("table", { name: "Workspace audit log" }));
    expect(table.getByText("Leave decided")).toBeInTheDocument();
    await interaction.type(screen.getByRole("searchbox", { name: "Search audit log" }), "View as");
    expect(table.getByText("View as")).toBeInTheDocument();
    expect(table.queryByText("Leave decided")).toBeNull();
  });

  it("loads the next cursor page without duplicating existing events", async () => {
    const interaction = userEvent.setup();
    const nextEvent: AuditEvent = {
      id: "70000000-0000-4000-8000-000000000006",
      source: "user",
      action: "legal_entity.updated",
      entityType: "legal_entity",
      entityId: "30000000-0000-4000-8000-000000000001",
      before: { displayName: "Iglo" },
      after: { displayName: "Iglo Architects" },
      correlationId: "71000000-0000-4000-8000-000000000006",
      occurredAt: "2026-09-01T06:00:00.000Z",
      actorName: "Iglo Administrator",
      actorEmail: "admin@igloarchitects.com",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [structuredClone(auditLogFixture.items[0]), nextEvent], nextCursor: null }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuditLogPage initialData={structuredClone(auditLogFixture)} />);

    await interaction.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(String(fetchMock.mock.calls[0][0])).toContain(`workspaceId=${auditLogFixture.workspaceId}`);
    expect(String(fetchMock.mock.calls[0][0])).toContain("cursor=fixture-next-page");
    expect(await screen.findByText("Legal entity updated")).toBeInTheDocument();
    expect(screen.getAllByText("Member invited")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("shows a clear permission state instead of an empty table", () => {
    render(<AuditLogPage initialData={{ canView: false, items: [], nextCursor: null, referenceTime: auditLogFixture.referenceTime, workspaceId: auditLogFixture.workspaceId }} />);

    expect(screen.getByText("Audit log access is restricted")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Workspace audit log" })).not.toBeInTheDocument();
  });
});
