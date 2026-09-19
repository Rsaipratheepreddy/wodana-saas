import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  fireEvent.click(screen.getByRole("button", { name: "New change case" }));
  const dialog = screen.getByRole("dialog", { name: "New change case" });
  fireEvent.change(dialog.querySelector("select")!, { target: { value: "replacement" } });
  expect(screen.getByRole("button", { name: "Create change case" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/V1 · Bedroom · Wardrobe/));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Replace wardrobe" } });
  fireEvent.change(screen.getByLabelText("What needs to change or be clarified?"), { target: { value: "Use oak finish" } });
  fireEvent.click(screen.getByRole("button", { name: "Create change case" }));
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
