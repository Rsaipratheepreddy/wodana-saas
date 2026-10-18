import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DesignSystemProvider, WorkspaceRegionProvider } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { OpportunityEditDialog } from "./opportunity-edit-dialog";

vi.mock("@/lib/crm/client", async (original) => ({ ...await original<object>(), crmRequest: vi.fn() }));
afterEach(() => vi.mocked(crmRequest).mockReset());

it("edits with names, the workspace's number format and one close date, and sends clean values", async () => {
  vi.mocked(crmRequest).mockResolvedValue({});
  const onSaved = vi.fn().mockResolvedValue(undefined), onClose = vi.fn();
  const user = userEvent.setup();
  render(<WorkspaceRegionProvider locale="en-AE" currency="AED"><DesignSystemProvider><OpportunityEditDialog workspaceId="ws" onClose={onClose} onSaved={onSaved}
    members={[{ id: "m1", label: "Sara Sales" }, { id: "m2", label: "Omar" }]}
    opportunity={{ id: "o1", version: 3, title: "Villa", amount: 385000, currencyCode: "AED", ownerMembershipId: "m1" }} /></DesignSystemProvider></WorkspaceRegionProvider>);
  // Guide J: the value comes from the proposals linked to finance; it is never typed here.
  expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();
  expect(screen.getByRole("button", { name: /Sara Sales/ })).toBeInTheDocument();
  await user.clear(screen.getByRole("textbox", { name: "Title" }));
  expect(screen.getByRole("textbox", { name: "Title" })).toBeRequired();
  await user.type(screen.getByRole("textbox", { name: "Title" }), "Villa · Full interior");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(crmRequest).toHaveBeenCalledWith("ws", "opportunities/o1", "PATCH", { version: 3, title: "Villa · Full interior", ownerMembershipId: "m1", amount: 385000, currencyCode: "AED", expectedCloseAt: null, nextActionAt: null });
  expect(onClose).toHaveBeenCalled();
});

it("sends the value it already holds, unchanged with its currency: it is never typed here", async () => {
  vi.mocked(crmRequest).mockResolvedValue({});
  const user = userEvent.setup();
  render(<WorkspaceRegionProvider locale="en-AE" currency="AED"><DesignSystemProvider><OpportunityEditDialog workspaceId="ws" onClose={vi.fn()} onSaved={vi.fn().mockResolvedValue(undefined)}
    members={[{ id: "m1", label: "Sara Sales" }]} opportunity={{ id: "o1", version: 5, title: "Villa", amount: 385000, currencyCode: "AED", ownerMembershipId: "m1" }} /></DesignSystemProvider></WorkspaceRegionProvider>);
  await user.type(screen.getByRole("textbox", { name: "Title" }), " fit-out");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(crmRequest).toHaveBeenCalledTimes(1));
  expect(vi.mocked(crmRequest).mock.calls[0][3]).toEqual({ version: 5, title: "Villa fit-out", ownerMembershipId: "m1", amount: 385000, currencyCode: "AED", expectedCloseAt: null, nextActionAt: null });
});

it("never sends a value this person can't see, so Sales without it can still save the rest", async () => {
  vi.mocked(crmRequest).mockResolvedValue({});
  const onSaved = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<WorkspaceRegionProvider locale="en-AE" currency="AED"><DesignSystemProvider><OpportunityEditDialog workspaceId="ws" onClose={vi.fn()} onSaved={onSaved}
    members={[{ id: "m1", label: "Sara Sales" }]}
    opportunity={{ id: "o1", version: 4, title: "Villa", amount: null, currencyCode: null, valueHidden: true, ownerMembershipId: "m1" }} /></DesignSystemProvider></WorkspaceRegionProvider>);
  expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();
  await user.type(screen.getByRole("textbox", { name: "Title" }), " fit-out");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(vi.mocked(crmRequest).mock.calls[0][3]).not.toHaveProperty("amount");
});
