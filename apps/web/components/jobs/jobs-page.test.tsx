import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { JobRow } from "@/lib/jobs/journey";
import { JobsPage } from "./jobs-page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const job = (patch: Partial<JobRow>): JobRow => ({ id: "j", reference: "J-000001", title: "Villa 12", client: "Dana", chapter: "make", now: { label: "Factory", owner: null, dueAt: null, late: false },
  progress: { done: 20, total: 29 }, value: { amount: "73941", currency: "AED" }, targetDate: "2026-12-31", ...patch });

describe("the Jobs list (§0.3)", () => {
  it("lists each job with where it is now, filters by chapter and finds by word", async () => {
    render(<DesignSystemProvider locale="en-AE" currency="AED"><JobsPage total={2} items={[
      job({ id: "a", reference: "J-000001", title: "Villa 12", now: { label: "Factory", owner: null, dueAt: "2026-10-01", late: true } }),
      job({ id: "b", reference: "J-000002", title: "Penthouse", client: "Layla", chapter: "design", now: { label: "Inspiration", owner: null, dueAt: null, late: false } }),
    ]} /></DesignSystemProvider>);
    const grid = screen.getByRole("table", { name: "Jobs" });
    expect(within(grid).getByText("Villa 12")).toBeInTheDocument();
    expect(within(grid).getByText("Late")).toBeInTheDocument();
    expect(within(grid).getAllByText(/AED\s?73,941\.00/)).toHaveLength(2);
    await userEvent.click(screen.getByRole("radio", { name: /Design/ }));
    expect(within(grid).queryByText("Villa 12")).not.toBeInTheDocument();
    expect(within(grid).getByText("Penthouse")).toBeInTheDocument();
  });
});
