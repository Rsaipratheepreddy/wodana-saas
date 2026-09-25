import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Order, ProjectState } from "@/lib/projects/execution";
import { expediting, OrdersTable } from "./project-stage";

const order = (id: string, accepted: number): Order => ({
  id,
  number: id,
  title: "Long approved oak veneer and calibrated plywood material name",
  vendor: "Supplier with a long trading name",
  status: "acknowledged",
  quantity: 10,
  unit: "sheet",
  unitCost: 12,
  currency: "AED",
  promisedDate: "2026-09-20",
  receipts: [{ id: `${id}-receipt`, accepted, rejected: 0, pending: 0 }],
}) as Order;

const project = (orders: Order[], supplierReturns: ProjectState["data"]["supplierReturns"] = []): ProjectState => ({
  today: "2026-09-25",
  canBuy: false,
  data: { orders, supplierReturns, materials: [], tasks: [] },
}) as unknown as ProjectState;

describe("project order delivery states", () => {
  it("does not mark a fully accepted order overdue while a partial delivery stays overdue", () => {
    const state = project([order("PO-FULL", 10), order("PO-PART", 4)]);
    render(<OrdersTable state={state} search="" onAction={vi.fn()} />);

    const full = screen.getByRole("row", { name: /PO-FULL/ });
    const partial = screen.getByRole("row", { name: /PO-PART/ });
    expect(within(full).queryByText("overdue")).not.toBeInTheDocument();
    expect(within(partial).getByText("overdue")).toBeInTheDocument();
    expect(within(full).getByText("Acknowledged")).toHaveAttribute("data-tone", "info");
    expect(screen.getByRole("region", { name: "Purchase and subcontract orders" })).toHaveAttribute("data-wrap-text", "true");
  });

  it("keeps an order in expediting when a supplier return makes it incomplete again", () => {
    const full = order("PO-FULL", 10);
    const returned = order("PO-RETURNED", 10);
    const state = project([full, returned], [{ id: "return", orderId: returned.id, quantity: 2, status: "dispatched" }] as ProjectState["data"]["supplierReturns"]);
    expect(expediting(state).map((item) => item.id)).toEqual(["PO-RETURNED"]);
  });

  it("does not ask purchasing to chase units already awaiting inspection", () => {
    const awaitingReview = {
      ...order("PO-QC", 4),
      receipts: [{ id: "qc", accepted: 4, rejected: 0, pending: 6 }],
    } as Order;
    expect(expediting(project([awaitingReview]))).toEqual([]);
  });
});
