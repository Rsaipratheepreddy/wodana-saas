import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { DesignQueue } from "./design-queue";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

it("lists what's waiting on me and opens the drawing in Design", () => {
  render(<DesignSystemProvider><DesignQueue items={[
    { designId: "d1", caseId: "c1", title: "Kitchen concept", stage: "concepts", roomName: "Kitchen", clientName: "Maya", caseTitle: "Villa", status: "internal_review", step: "review", since: "2026-09-20T08:00:00Z", dueAt: null },
    { designId: "d2", caseId: "c1", title: "Living render", stage: "renders", roomName: null, clientName: "Maya", caseTitle: "Villa", status: "client_review", step: "record_client", since: "2026-09-21T08:00:00Z", dueAt: "2026-10-01T08:00:00Z" },
  ]} /></DesignSystemProvider>);
  const table = screen.getByRole("table", { name: "Designs waiting on you" });
  expect(within(table).getByText("Kitchen · Concepts")).toBeInTheDocument();
  expect(within(table).getByText("Record client decision")).toBeInTheDocument();
  expect(within(table).getByText(/^Due /)).toBeInTheDocument();
  fireEvent.click(within(table).getByText("Kitchen concept"));
  expect(push).toHaveBeenCalledWith("/workspace/pre-projects/cases/c1/designs?file=d1");
});

it("says so when nothing is waiting", () => {
  render(<DesignSystemProvider><DesignQueue items={[]} /></DesignSystemProvider>);
  expect(screen.getByText("Nothing waiting on you")).toBeInTheDocument();
});
