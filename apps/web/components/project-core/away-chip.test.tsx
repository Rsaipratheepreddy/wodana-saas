import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { AwayChip } from "./work-labels";

describe("assignee away", () => {
  it("says when the assignee is away on approved leave within open work's dates", () => {
    render(<DesignSystemProvider locale="en-GB"><AwayChip item={{ status: "todo", assigneeAway: [{ startDate: "2026-10-06", endDate: "2026-10-07" }, { startDate: "2026-10-12", endDate: "2026-10-12" }] }} /></DesignSystemProvider>);
    expect(screen.getByText(/^Away 6\s?–\s?7 Oct, 12 Oct$/)).toBeInTheDocument();
  });

  it("says nothing for finished work or someone who isn't away", () => {
    const { container } = render(<DesignSystemProvider locale="en-GB">
      <AwayChip item={{ status: "done", assigneeAway: [{ startDate: "2026-10-06", endDate: "2026-10-07" }] }} />
      <AwayChip item={{ status: "in_progress", assigneeAway: [] }} />
      <AwayChip item={{ status: "in_progress" }} />
    </DesignSystemProvider>);
    expect(container.textContent).toBe("");
  });
});
