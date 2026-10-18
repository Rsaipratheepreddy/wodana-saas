import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { JourneyMap } from "./journey-map";

const steps = [
  { key: "enquiry", band: "win", lane: "sales", label: "Enquiry received", state: "done" as const, detail: "17 Oct 2026", href: "/a" },
  { key: "outcome", band: "win", lane: "sales", label: "Intro outcome", state: "now" as const, href: "/b" },
  { key: "fee", band: "win", lane: "finance", label: "Design fee paid", state: "next" as const, href: "/c" },
  { key: "concepts", band: "design", lane: "design", label: "Concepts", state: "skipped" as const, detail: "Not in this package" },
];
const bands = [
  { key: "win", label: "Win", state: "now" as const, done: 1, total: 3 },
  { key: "design", label: "Design", state: "skipped" as const, done: 0, total: 0 },
  { key: "price", label: "Price", state: "upcoming" as const, done: 0, total: 0 },
];
const lanes = [{ key: "client", label: "Client" }, { key: "sales", label: "Sales" }, { key: "design", label: "Design team" }, { key: "finance", label: "Finance" }];

describe("the job's map (§0.3 P2)", () => {
  it("puts every step in its seat's row and its chapter's column, in order, and marks the step now", () => {
    render(<DesignSystemProvider><JourneyMap label="Journey map" bands={bands} lanes={lanes} steps={steps} stateLabel={(state) => state} /></DesignSystemProvider>);
    // A chapter with no steps and a seat with no steps leave no empty column or row.
    expect(screen.queryByText("Price")).toBeNull();
    expect(screen.queryByText("Client")).toBeNull();
    const sales = screen.getByRole("list", { name: "Sales · Win" });
    expect(within(sales).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Enquiry received17 Oct 2026", "Intro outcome"]);
    expect(screen.getByRole("link", { name: "Intro outcome · now" })).toHaveAttribute("aria-current", "step");
    // A step not in this job stays out of the way until asked for; then it shows its reason and opens nothing.
    expect(screen.queryByRole("list", { name: "Design team · Design" })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Steps not in this job (1)" }));
    expect(within(screen.getByRole("list", { name: "Design team · Design" })).getByText("Not in this package")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Concepts/ })).toBeNull();
  });

  it("flags a late step in words, not colour alone", () => {
    render(<DesignSystemProvider><JourneyMap label="Journey map" bands={bands} lanes={lanes} stateLabel={(state) => state}
      steps={[{ key: "fee", band: "win", lane: "finance", label: "Design fee paid", state: "now", detail: "Due 1 Oct 2026", href: "/c", late: true }]} /></DesignSystemProvider>);
    expect(screen.getByRole("link", { name: "Design fee paid · now · Late · Due 1 Oct 2026" })).toHaveAttribute("data-late", "true");
  });
});
