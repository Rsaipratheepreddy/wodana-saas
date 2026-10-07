import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActionDialog } from "./crm-workbench";
vi.mock("@/lib/crm/client", async (original) => ({ ...await original<object>(), crmRequest: vi.fn() }));
import { crmRequest } from "@/lib/crm/client";
describe("CRM safe mutation dialog", () => {
  it("prevents duplicate submissions after saving succeeds but refresh fails", async () => {
    const user = userEvent.setup(); vi.mocked(crmRequest).mockResolvedValue({ id: "saved" });
    render(<ActionDialog workspaceId="workspace" action={{ title: "Create item", path: "leads", fields: [{ key: "title", label: "Title", required: true }] }} onClose={vi.fn()} onSaved={async () => { throw new Error("refresh failed"); }} />);
    await user.type(screen.getByRole("textbox", { name: /Title/ }), "Design enquiry");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Saved. Refresh needed.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(crmRequest).toHaveBeenCalledTimes(1);
  });
});
