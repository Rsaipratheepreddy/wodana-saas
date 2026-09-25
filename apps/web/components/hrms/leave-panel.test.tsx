import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HrmsBootstrap } from "@wodana/contracts";
import type { ReactNode } from "react";

const api = vi.hoisted(() => ({ request: vi.fn(), error: "" }));
vi.mock("@/lib/hrms/client", () => ({
  hrmsRequest: api.request,
  localDay: () => "2026-09-22",
  statusLabel: (value: string) => value,
}));
vi.mock("./shared", () => ({
  useHrms: (_workspace: string, path: string) => ({
    data: path === "leave/types" ? [{ id: "annual", name: "Annual leave", active: true, allowHalfDay: true }]
      : api.error && path.startsWith("leave/requests") ? null : [],
    error: path.startsWith("leave/requests") ? api.error : "", loading: false,
  }),
  Notice: ({ children }: { children: ReactNode }) => <div role="alert">{children}</div>,
  Empty: ({ title }: { title: string }) => <div>{title}</div>,
  Modal: ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title}>{children}</section>,
}));
vi.mock("./controls", () => ({
  Button: ({ children, loading, ...props }: { children: ReactNode; loading?: boolean }) => <button {...props} aria-busy={loading}>{children}</button>,
  SelectField: ({ id, label, children, onChange, ...props }: { id: string; label: string; children: ReactNode; onChange: (value: string) => void }) => <label>{label}<select id={id} {...props} onChange={event => onChange(event.target.value)}>{children}</select></label>,
  TextField: ({ label, ...props }: { label: string }) => <label>{label}<input {...props} /></label>,
  TextArea: ({ label, ...props }: { label: string }) => <label>{label}<textarea {...props} /></label>,
  DataTable: () => <div>Requests table</div>,
}));
vi.mock("./time-summary", () => ({ DecisionDialog: () => null }));
import { LeavePanel } from "./leave-panel";

const boot = { workspace: { timezone: "UTC" }, membershipId: "me", permissions: { team: false }, employee: { enabled: true, calendar: { timezone: "UTC", holidays: [] } } } as unknown as HrmsBootstrap;
describe("HRMS leave recovery", () => {
  beforeEach(() => { api.error = ""; api.request.mockReset(); api.request.mockResolvedValue({}); });

  it("resets a half-day selection when the start date creates a multi-day request", async () => {
    render(<LeavePanel workspaceId="workspace" boot={boot} revision={0} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Request leave" }));
    fireEvent.change(screen.getByLabelText("Day portion"), { target: { value: "first_half" } });
    fireEvent.change(screen.getByLabelText("First day"), { target: { value: "2026-09-21" } });
    expect(screen.getByLabelText("Day portion")).toHaveValue("full");
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Family leave" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith("workspace", "leave/requests", "POST", expect.objectContaining({ startDate: "2026-09-21", endDate: "2026-09-22", dayPart: "full" })));
  });

  it("shows retry instead of claiming an errored request history is empty", () => {
    api.error = "Connection interrupted";
    const retry = vi.fn();
    render(<LeavePanel workspaceId="workspace" boot={boot} revision={0} onSaved={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Connection interrupted");
    expect(screen.queryByText("No leave requests")).not.toBeInTheDocument();
    expect(screen.queryByText("No leave requests yet.")).not.toBeInTheDocument();
    expect(screen.queryByText("0 requests")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
