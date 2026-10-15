import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { RecordLinks } from "@/lib/project-core/types";
import { LinkedRecords, recordHrefs } from "./linked-records";

const links: RecordLinks = {
  caseId: "case-1", quote: { id: "q1", number: 3, title: "Main quotation" }, dealFile: { id: "df1", reference: "DF-2026-7" },
  project: { id: "p1", reference: "PRJ-0007", name: "Villa 12" },
  purchaseOrders: [{ id: "po1", number: "PO-0001", status: "sent" }, { id: "po2", number: "PO-0002", status: "approved" }],
  workOrders: [{ id: "wo1", number: 4, status: "released" }],
};
const wrap = (node: React.ReactNode) => render(<DesignSystemProvider locale="en-GB">{node}</DesignSystemProvider>);

describe("PLM-164: linked records", () => {
  it("links every record of the job to its live record, names the one it sits on, and opens the orders list narrowed to the project", () => {
    wrap(<LinkedRecords links={links} current="purchase_order" currentId="po1" />);
    expect(screen.getByRole("region", { name: "Linked records" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "V3 · Main quotation" })).toHaveAttribute("href", "/workspace/pre-projects/cases/case-1/quotations");
    expect(screen.getByRole("link", { name: "DF-2026-7" })).toHaveAttribute("href", "/workspace/pre-projects/cases/case-1/execution-release");
    expect(screen.getByRole("link", { name: "PRJ-0007" })).toHaveAttribute("href", "/workspace/projects/p1");
    // This order is named, not linked; the other opens in Purchasing, narrowed to the project.
    expect(screen.queryByRole("link", { name: "PO-0001" })).not.toBeInTheDocument();
    expect(screen.getByText("PO-0001")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "PO-0002" })).toHaveAttribute("href", "/workspace/purchasing/orders?order=po2&project=p1");
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("href", "/workspace/purchasing/orders?project=p1");
    expect(screen.getByRole("link", { name: "WO-0004" })).toHaveAttribute("href", "/workspace/factory/orders?order=wo1&project=p1");
  });

  it("says when a record isn't there yet, and shows no heading when its container names it", () => {
    wrap(<LinkedRecords links={{ ...links, quote: null, dealFile: null, purchaseOrders: [], workOrders: [] }} current="project" title={null} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getAllByText("None yet")).toHaveLength(4);
    expect(screen.getByText("PRJ-0007")).toHaveAttribute("aria-current", "page");
    expect(recordHrefs(links).workOrders).toBe("/workspace/factory/orders?project=p1");
  });
});
