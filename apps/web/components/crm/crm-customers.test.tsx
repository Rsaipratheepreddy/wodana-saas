import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { crmScreenFixture } from "@/lib/crm/screens";
import { crmRequest } from "@/lib/crm/client";
import { CrmCustomers } from "./crm-customers";

vi.mock("@/lib/crm/client", async (original) => ({ ...await original<object>(), crmRequest: vi.fn() }));

describe("CrmCustomers", () => {
  it("keeps people and companies together as customer records", async () => {
    const user = userEvent.setup();
    render(<CrmCustomers initialData={structuredClone(crmScreenFixture("customers"))} />);

    expect(screen.getByRole("heading", { name: "Customers", level: 1 })).toBeInTheDocument();
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
