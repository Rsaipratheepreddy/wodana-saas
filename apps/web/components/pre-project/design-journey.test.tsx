import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { DesignJourney, type JourneyStage, type JourneyView } from "./design-journey";

afterEach(() => vi.unstubAllGlobals());
const stage = (over: Partial<JourneyStage>): JourneyStage => ({ stage: "concepts", label: "Concepts", status: "locked", ownerName: "Dana", dueAt: null, completedAt: null, overdue: false, version: 1, scheduledAt: null, scheduledEnd: null, scheduledTimezone: null, scheduledLocation: null, ...over });
const view = (over: Partial<JourneyView> = {}): JourneyView => ({ journey: { packageName: "Bespoke Interior Design", includedRevisions: 2 }, stages: [], measurements: [], siteEvidenceProblem: null, timezone: "Europe/London", canStart: false, ...over });
const stub = (value: JourneyView) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => value })));
const renderJourney = () => render(<DesignSystemProvider><DesignJourney workspaceId="ws" caseId="c1" locale="en-GB" /></DesignSystemProvider>);

describe("design journey on the case (PLM-047, PLM-048)", () => {
  it("offers to start design when nothing has started", async () => {
    stub(view({ journey: null, canStart: true }));
    renderJourney();
    expect(await screen.findByRole("button", { name: "Start design" })).toBeInTheDocument();
    expect(screen.getByText("Design starts once the design deposit is paid.")).toBeInTheDocument();
  });

  it("shows each stage with its state, and the inspiration timer waiting for the first inspiration", async () => {
    stub(view({ stages: [stage({ stage: "inspiration", label: "Inspiration", status: "active" }), stage({ stage: "site_visit", label: "Site visit" }), stage({ stage: "approval", label: "Design approval" })] }));
    renderJourney();
    expect(await screen.findByText("Timer starts with the first inspiration")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close inspiration" })).toBeInTheDocument();
    const steps = screen.getAllByRole("listitem");
    expect(steps.map((step) => step.getAttribute("data-status"))).toEqual(["active", "locked", "locked"]);
    expect(screen.getByLabelText("0 of 3 stages done")).toHaveTextContent("0/3");
    expect(screen.getByText("Bespoke Interior Design")).toBeInTheDocument();
  });

  it("flags an overdue site visit and blocks completion until the evidence is in", async () => {
    stub(view({ stages: [stage({ stage: "inspiration", status: "done", completedAt: "2031-04-01T10:00:00Z" }), stage({ stage: "site_visit", label: "Site visit", status: "active", dueAt: "2031-04-03T10:00:00Z", overdue: true })],
      siteEvidenceProblem: "Add a photo for Kitchen wall", measurements: [{ title: "Kitchen wall", status: "measured", files: 0 }] }));
    renderJourney();
    expect(await screen.findByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("1 Apr")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[1]).toHaveAttribute("data-overdue", "true");
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    expect(await screen.findByText(/Add a photo for Kitchen wall/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete site visit" })).toBeDisabled();
  });
});
