import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocumentTable } from "./document-table";

type Row = { id: string; item: string; amount: string };

describe("document table", () => {
  it("shows groups with their subtotal and a summary that ends in the total", () => {
    render(<DocumentTable<Row> label="Items" getRowKey={(row) => row.id}
      columns={[{ id: "item", header: "Item", cell: (row) => row.item }, { id: "amount", header: "Amount", align: "end", cell: (row) => row.amount }]}
      groups={[{ key: "kitchen", title: "Kitchen", total: "1,200.00", rows: [{ id: "a", item: "Base cabinets", amount: "1,200.00" }] }]}
      summary={[{ key: "tax", label: "Tax", value: "60.00" }, { key: "total", label: "Total", value: "1,260.00", emphasis: true }]} />);
    const table = screen.getByRole("table", { name: "Items" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Item", "Amount"]);
    expect(within(table).getByRole("rowheader", { name: "Kitchen" })).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /Base cabinets 1,200.00/ })).toBeInTheDocument();
    const total = within(table).getByRole("row", { name: /Total 1,260.00/ });
    expect(total).toHaveAttribute("data-emphasis", "true");
    expect(within(total).getByRole("cell")).toHaveAttribute("data-align", "end");
  });

  it("lists plain rows when there are no groups", () => {
    render(<DocumentTable<Row> label="Gate list" getRowKey={(row) => row.id} rows={[{ id: "1", item: "Sara", amount: "" }, { id: "2", item: "Omar", amount: "" }]}
      columns={[{ id: "item", header: "Name", cell: (row) => row.item }]} />);
    expect(within(screen.getByRole("table", { name: "Gate list" })).getAllByRole("row")).toHaveLength(3);
  });
});
