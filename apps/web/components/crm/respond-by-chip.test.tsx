import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { RespondByChip } from "./respond-by-chip";

const now = Date.parse("2026-09-30T08:00:00Z");
const lead = { slaStatus: "active", slaDueAt: "2026-09-30T18:36:00Z" };

it("shows only the time left in a list column already headed Respond by, with the deadline in its tooltip", () => {
  render(<DesignSystemProvider><RespondByChip compact lead={lead} now={now} /></DesignSystemProvider>);
  const chip = screen.getByText("10 h 36 min").closest("[data-chip]")!;
  expect(chip).toHaveAttribute("title", expect.stringMatching(/^Respond by .+ · 10 h 36 min$/));
});

it("says how long it is overdue", () => {
  render(<DesignSystemProvider><RespondByChip compact lead={{ slaStatus: "breached", slaDueAt: "2026-09-30T06:00:00Z" }} now={now} /></DesignSystemProvider>);
  expect(screen.getByText("2 h overdue")).toBeInTheDocument();
});
