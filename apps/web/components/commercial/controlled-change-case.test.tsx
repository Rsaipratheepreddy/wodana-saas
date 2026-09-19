import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChangeRequest, CommercialState } from "@/lib/commercial/types";
import { ControlledChangeCase } from "./controlled-change-case";

function fixture(): { state: CommercialState; request: ChangeRequest } {
  const request = {
    id: "change", number: 1, title: "Replace wardrobe", detail: "Use oak finish",
    status: "under_review", owner: "", dueDate: "", resolution: "", comments: [], createdAt: "2026-09-17",
    control: { kind: "replacement", sourceLineIds: ["line"], quoteIds: [], dispositions: [],
      impact: { assessedAt: "2026-09-17T08:00:00Z", projectId: "project", sourceLineIds: ["line"],
        bookingCount: 1, hasReportedOrCompletedWork: false,
        targets: [{ kind: "task", id: "task", title: "Install wardrobe", status: "planned" }],
      },
    },
  } as ChangeRequest;
  const state = { workspaceId: "workspace", caseId: "case", canEdit: true,
    data: { quotes: [], requests: [request] },
  } as unknown as CommercialState;
  return { state, request };
}

describe("controlled change case", () => {
  it("requires an impact decision and note before saving, then links the paired documents", async () => {
    const { state, request } = fixture();
    const run = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    const { rerender } = render(<ControlledChangeCase request={request} state={state} busy={false} run={run} />);
    expect(screen.getByRole("button", { name: "Save impact decisions" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason / next action"), { target: { value: "Replan the site task" } });
    expect(screen.getByRole("button", { name: "Save impact decisions" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Decision/ }));
    await user.click(screen.getByRole("option", { name: "Hold and replan" }));
    await user.click(screen.getByRole("button", { name: "Save impact decisions" }));
    await waitFor(() => expect(run).toHaveBeenCalledWith("set_change_dispositions", {
      requestId: "change", dispositions: [{ targetKind: "task", targetId: "task", action: "hold_and_replan", note: "Replan the site task" }],
    }));
    request.control!.dispositions = [{ targetKind: "task", targetId: "task", action: "hold_and_replan", note: "Replan the site task" }];
    rerender(<ControlledChangeCase request={{ ...request }} state={state} busy={false} run={run} />);
    fireEvent.click(screen.getByRole("button", { name: "Prepare client documents" }));
    expect(run).toHaveBeenCalledWith("prepare_change_variations", { requestId: "change" });
  });

  it("does not show operational actions to viewers", () => {
    const { state, request } = fixture();
    state.canEdit = false;
    render(<ControlledChangeCase request={request} state={state} busy={false} run={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Save impact decisions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Prepare client documents" })).toBeNull();
  });
});
