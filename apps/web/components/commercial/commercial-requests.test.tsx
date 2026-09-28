import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommercialState } from "@/lib/commercial/types";
import { CommercialRequests } from "./commercial-workflows";

vi.mock("@/design-system", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/design-system")>()),
  DataGrid: () => null,
  ControlledModalDialog: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: React.ReactNode }) =>
    isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));

it("creates a controlled replacement from remaining accepted scope", async () => {
  const state = { canEdit: true, workspaceId: "workspace", caseId: "case",
    data: { requests: [], quotes: [{ id: "quote", kind: "quotation", status: "accepted", number: 1,
      lines: [{ id: "line", title: "Wardrobe", room: "Bedroom", quantity: 1, unit: "nos" }],
    }] },
  } as unknown as CommercialState;
  const run = vi.fn().mockResolvedValue(true);
  render(<CommercialRequests state={state} run={run} busy={false} />);
  fireEvent.click(screen.getByRole("button", { name: "New change request" }));
  const dialog = screen.getByRole("dialog", { name: "New change request" });
  fireEvent.change(dialog.querySelector("select")!, { target: { value: "replacement" } });
  expect(screen.getByRole("button", { name: "Create change request" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/V1 · Bedroom · Wardrobe/));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Replace wardrobe" } });
  fireEvent.change(screen.getByLabelText("What needs to change or be clarified?"), { target: { value: "Use oak finish" } });
  fireEvent.click(screen.getByRole("button", { name: "Create change request" }));
  await waitFor(() => expect(run).toHaveBeenCalledWith("create_change_case", expect.objectContaining({
    kind: "replacement", sourceLineIds: ["line"], title: "Replace wardrobe", detail: "Use oak finish",
  })));
});

it("sends a client decision request pinned to an assigned exact revision", async () => {
  const user = userEvent.setup();
  const state = {
    canEdit: true,
    workspaceId: "workspace",
    caseId: "case",
    data: {
      requests: [],
      quotes: [{
        id: "quote",
        kind: "quotation",
        status: "issued",
        number: 2,
        issuedAt: "2026-09-18T08:00:00.000Z",
        approverId: "client-grant",
        lines: [],
      }],
    },
  } as unknown as CommercialState;
  const run = vi.fn().mockResolvedValue(true);
  render(<CommercialRequests state={state} run={run} busy={false} />);

  await user.click(screen.getByRole("button", { name: "Request client decision" }));
  await user.type(screen.getByLabelText("Question *"), "Confirm final finish");
  await user.type(screen.getByLabelText("What does the client need to decide? *"), "Choose the approved finish for this exact quotation.");
  await user.click(screen.getByRole("button", { name: /Select an option Exact revision/ }));
  await user.click(screen.getByRole("option", { name: "Quotation V2" }));
  fireEvent.change(screen.getByLabelText("Due date *"), { target: { value: "2099-01-02" } });
  await user.click(screen.getByRole("button", { name: "Send decision request" }));

  await waitFor(() => expect(run).toHaveBeenCalledWith("request", expect.objectContaining({
    decisionRequest: true,
    targetType: "quotation",
    targetId: "quote",
    targetRevision: 2,
    dueDate: "2099-01-02",
    allowedChoices: ["Approve", "Request changes"],
    reminderChannels: ["in_app"],
    escalationMinutes: 1440,
  })));
});

describe("a client's conversation", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const conversation = (clientRead: string) => {
    const fetcher = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (String(url).includes("/threads?") ? {
      files: { r1: [{ id: "f1", name: "wall.jpg", mimeType: "image/jpeg", hasPreview: true }], c1: [{ id: "f2", name: "plan.pdf", mimeType: "application/pdf", hasPreview: false }] },
      clientRead: { r1: clientRead },
    } : { ok: true }) }));
    vi.stubGlobal("fetch", fetcher);
    const state = { canEdit: true, workspaceId: "workspace", caseId: "case",
      data: { quotes: [], requests: [{ id: "r1", number: 4, title: "Move the TV wall", detail: "Can it move 30 cm?", status: "open", owner: "", dueDate: "", resolution: "", createdAt: "2026-09-20T08:00:00.000Z",
        comments: [
          { id: "c1", author: "Aisha", text: "Here is the plan", at: "2026-09-20T10:00:00.000Z", visibility: "client", fromClient: true },
          { id: "c2", author: "Sara", text: "We'll check on site", at: "2026-09-21T10:00:00.000Z", visibility: "client" },
          { id: "c3", author: "Sara", text: "Needs the electrician", at: "2026-09-23T10:00:00.000Z", visibility: "internal" },
        ] }] },
    } as unknown as CommercialState;
    render(<CommercialRequests state={state} run={vi.fn()} busy={false} openRequestId="r1" />);
    return fetcher;
  };

  it("shows the client's files on the request and on their messages, tells them it was seen, and whether they saw the reply", async () => {
    const fetcher = conversation("2026-09-22T08:00:00.000Z");
    const dialog = screen.getByRole("dialog", { name: "Move the TV wall" });
    expect(await within(dialog).findByRole("img", { name: "wall.jpg" })).toHaveAttribute("src", "/api/client-portal-admin/cases/case/files/f1?workspaceId=workspace&preview=1");
    expect(within(dialog).getByRole("link", { name: "plan.pdf" })).toHaveAttribute("href", "/api/client-portal-admin/cases/case/files/f2?workspaceId=workspace");
    // Read after the team's last client-visible reply (internal notes don't count).
    expect(within(dialog).getByText(/^Seen by the client · /)).toBeInTheDocument();
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/client-portal-admin/cases/case/threads/r1/read?workspaceId=workspace", expect.objectContaining({ method: "POST" })));
  });

  it("says when the client hasn't seen the team's latest reply", async () => {
    conversation("2026-09-20T11:00:00.000Z");
    expect(await screen.findByText("Not seen by the client yet")).toBeInTheDocument();
  });
});
