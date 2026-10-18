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
  expect(screen.getByRole("textbox", { name: "Value" })).toHaveValue("385,000");
  expect(screen.getByRole("textbox", { name: "Value" }).closest(".wd-field")).toHaveTextContent("AED");
  expect(screen.getByRole("button", { name: /Sara Sales/ })).toBeInTheDocument();
  await user.clear(screen.getByRole("textbox", { name: "Title" }));
  expect(screen.getByRole("textbox", { name: "Title" })).toBeRequired();
  await user.type(screen.getByRole("textbox", { name: "Title" }), "Villa · Full interior");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(crmRequest).toHaveBeenCalledWith("ws", "opportunities/o1", "PATCH", { version: 3, title: "Villa · Full interior", ownerMembershipId: "m1", amount: 385000, currencyCode: "AED", expectedCloseAt: null, nextActionAt: null });
  expect(onClose).toHaveBeenCalled();
});

it("sends the value as a pair: none while it's Not set, both cleared when it's removed", async () => {
  vi.mocked(crmRequest).mockResolvedValue({});
  const user = userEvent.setup();
  const dialog = (amount: number | null) => <WorkspaceRegionProvider locale="en-AE" currency="AED"><DesignSystemProvider><OpportunityEditDialog workspaceId="ws" onClose={vi.fn()} onSaved={vi.fn().mockResolvedValue(undefined)}
    members={[{ id: "m1", label: "Sara Sales" }]} opportunity={{ id: "o1", version: 5, title: "Villa", amount, currencyCode: amount === null ? null : "AED", ownerMembershipId: "m1" }} /></DesignSystemProvider></WorkspaceRegionProvider>;
  // Value "Not set": changing only the title sends no currency (an amount-less currency is refused).
  const { unmount } = render(dialog(null));
  await user.type(screen.getByRole("textbox", { name: "Title" }), " fit-out");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(crmRequest).toHaveBeenCalledTimes(1));
  expect(vi.mocked(crmRequest).mock.calls[0][3]).toEqual({ version: 5, title: "Villa fit-out", ownerMembershipId: "m1", expectedCloseAt: null, nextActionAt: null });
  unmount();
  // A value that's removed clears the amount and its currency together.
  render(dialog(385000));
  await user.clear(screen.getByRole("textbox", { name: "Value" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(crmRequest).toHaveBeenCalledTimes(2));
  expect(vi.mocked(crmRequest).mock.calls[1][3]).toMatchObject({ amount: null, currencyCode: null });
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
