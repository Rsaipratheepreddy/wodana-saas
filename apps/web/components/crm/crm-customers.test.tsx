import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { crmScreenFixture } from "@/lib/crm/screens";
import { crmRequest } from "@/lib/crm/client";
import { CrmCustomers } from "./crm-customers";

vi.mock("next/font/google", () => ({ Caveat: () => ({ variable: "note-font" }) }));

vi.mock("@/lib/crm/client", async (original) => ({ ...await original<object>(), crmRequest: vi.fn() }));

describe("CrmCustomers", () => {
  it("keeps people and companies together as customer records", async () => {
    const user = userEvent.setup();
    render(<CrmCustomers initialData={structuredClone(crmScreenFixture("customers"))} />);

    expect(screen.getByRole("region", { name: "Customers workspace" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Customer records" })).toBeInTheDocument();
    expect(screen.getByText("Amira Al Mansoori")).toBeInTheDocument();
    expect(screen.getByText("Al Noor Developments LLC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Table view/ }));
    await user.click(screen.getByRole("option", { name: "Companies (2)" }));
    expect(screen.getByText("Al Noor Developments LLC")).toBeInTheDocument();
    expect(screen.queryByText("Amira Al Mansoori")).not.toBeInTheDocument();
  });

  it("loads every cursor page without duplicating customers", async () => {
    const user = userEvent.setup();
    const data = structuredClone(crmScreenFixture("customers"));
    data.nextCursor = "next-page";
    vi.mocked(crmRequest).mockResolvedValueOnce({ data: [data.items[0], { id: "new-customer", type: "person", status: "active", displayName: "Layla Omar" }], nextCursor: null });
    render(<CrmCustomers initialData={data} />);

    await user.click(screen.getByRole("button", { name: "Load more customers" }));
    await waitFor(() => expect(screen.getByText("Layla Omar")).toBeInTheDocument());
    expect(screen.getAllByRole("row")).toHaveLength(7);
    expect(crmRequest).toHaveBeenCalledWith(data.workspaceId, "parties?limit=100&includeArchived=true&cursor=next-page");
    expect(screen.queryByRole("button", { name: "Load more customers" })).not.toBeInTheDocument();
  });

  it("shows archived customers only in the archived view", async () => {
    const user = userEvent.setup();
    const data = structuredClone(crmScreenFixture("customers"));
    data.items.push({ ...data.items[0], id: "archived-customer", displayName: "Former Customer", status: "archived" });
    render(<CrmCustomers initialData={data} />);

    expect(screen.queryByText("Former Customer")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Table view/ }));
    await user.click(screen.getByRole("option", { name: "Archived (1)" }));
    expect(screen.getByText("Former Customer")).toBeInTheDocument();
    expect(screen.queryByText("Amira Al Mansoori")).not.toBeInTheDocument();
  });
});


it.each(["Amira Al Mansoori", "Al Noor Developments LLC"])("opens %s in a modal and returns to the list", async (name) => {
  vi.mocked(crmRequest).mockImplementation(() => new Promise(() => {}));
  const user = userEvent.setup();
  render(<CrmCustomers initialData={structuredClone(crmScreenFixture("customers"))} />);
  await user.click(screen.getByRole("button", { name: new RegExp(name) }));
  const dialog = await screen.findByRole("dialog", { name: "Customer details" });
  expect(dialog.closest(".wd-modal")?.className).toContain("customerModal");
  expect(within(dialog).queryByRole("heading", { name: "Customer details" })).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Close dialog" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByRole("table", { name: "Customer records" })).toBeVisible();
});

it("shows one customer heading and compact tab-specific actions", async () => {
  const data = structuredClone(crmScreenFixture("customers"));
  const customer = data.items[0];
  vi.mocked(crmRequest).mockImplementation(async (_workspaceId, path) => path === `parties/${customer.id}`
    ? { ...customer, version: 1, relationships: [], contacts: [], addresses: [], consents: [] }
    : { data: [] });
  const user = userEvent.setup();
  render(<CrmCustomers initialData={data} />);
  await user.click(screen.getByRole("button", { name: new RegExp(String(customer.displayName)) }));
  const dialog = await screen.findByRole("dialog", { name: "Customer details" });
  expect(await within(dialog).findByRole("heading", { name: String(customer.displayName) })).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Edit profile" }).querySelector("svg")).toBeInTheDocument();

  await user.click(within(dialog).getByRole("tab", { name: "Activity" }));
  expect(within(dialog).queryByRole("heading", { name: "Activities & follow-ups" })).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Add activity" }).querySelector("svg")).toBeInTheDocument();

  await user.click(within(dialog).getByRole("tab", { name: "Relationships" }));
  expect(within(dialog).getByRole("button", { name: "Add relationship" }).querySelector("svg")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("tab", { name: "Contact" }));
  expect(within(dialog).getByRole("button", { name: "Add contact" }).querySelector("svg")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("tab", { name: "Record controls" }));
  expect(within(dialog).queryByRole("heading", { name: "Record controls" })).not.toBeInTheDocument();
  const erase = within(dialog).getByRole("button", { name: "Privacy erasure" });
  expect(erase).toHaveAttribute("data-variant", "danger");
  expect(erase.querySelector("svg")).toBeInTheDocument();
});
