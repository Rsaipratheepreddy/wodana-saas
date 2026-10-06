import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("flags an overdue site visit and sends the designer to the guided visit on the Site page", async () => {
    stub(view({ stages: [stage({ stage: "inspiration", status: "done", completedAt: "2031-04-01T10:00:00Z" }), stage({ stage: "site_visit", label: "Site visit", status: "active", dueAt: "2031-04-03T10:00:00Z", overdue: true })],
      siteEvidenceProblem: "Add a photo for Kitchen wall", measurements: [{ title: "Kitchen wall", status: "measured", files: 0 }] }));
    renderJourney();
    expect(await screen.findByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("1 Apr")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[1]).toHaveAttribute("data-overdue", "true");
    expect(screen.getByRole("link", { name: "Open the visit" })).toHaveAttribute("href", "/workspace/pre-projects/cases/c1/site");
  });

  it("counts revisions and flags the chargeable one, and confirms the material list only when the client confirmed every material", async () => {
    stub(view({ canManage: true, ledger: { state: "open", lockProblem: "Waiting for the client's confirmation: Oak", materials: 2, waiting: 1, lock: null },
      stages: [stage({ stage: "concepts", status: "done", completedAt: "2031-04-01T10:00:00Z", outcome: "chosen", note: "Client's choice: Warm minimal" }),
        stage({ stage: "renders", label: "3D renders", status: "locked" }),
        stage({ stage: "material_selection", label: "Material selection", status: "active", dueAt: "2031-04-09T10:00:00Z", clientDueAt: "2031-04-20T10:00:00Z", revisions: { used: 3, included: 2, chargeable: true } })] }));
    renderJourney();
    expect(await screen.findByText("Client's choice: Warm minimal")).toBeInTheDocument();
    expect(screen.getByText("Revision 3 · chargeable")).toBeInTheDocument();
    expect(screen.getByText("2 materials · 1 waiting for the client")).toBeInTheDocument();
    expect(screen.getByText("Client deadline 20 Apr")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm material list" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Material list" })).toHaveAttribute("href", "/workspace/pre-projects/cases/c1/designs?stage=ledger");
  });

  it("books the showroom on the booking engine's free slots when the firm set a showroom booking type", async () => {
    const fetch = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes("material-selection/slots")
      ? { configured: true, timezone: "Europe/London", durationMinutes: 60, location: "Studio showroom", slots: [{ start: "2031-04-09T09:00:00.000Z", end: "2031-04-09T10:00:00.000Z", date: "2031-04-09" }, { start: "2031-04-09T11:00:00.000Z", end: "2031-04-09T12:00:00.000Z", date: "2031-04-09" }] }
      : view({ showroomBooking: true, stages: [stage({ stage: "material_selection", label: "Material selection", status: "active", version: 4 })] }) }));
    vi.stubGlobal("fetch", fetch);
    renderJourney();
    fireEvent.click(await screen.findByRole("button", { name: "Book appointment" }));
    expect(await screen.findByText("Studio showroom")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "12:00" }));
    fireEvent.click(screen.getByRole("button", { name: "Book" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("material-selection/schedule"), expect.objectContaining({ method: "POST" })));
    const body = JSON.parse((fetch.mock.calls.find(([url]) => String(url).includes("material-selection/schedule")) as unknown as [string, { body: string }])[1].body);
    expect(body).toEqual({ version: 4, startsAt: "2031-04-09T11:00:00.000Z", endsAt: "2031-04-09T12:00:00.000Z", timezone: "Europe/London" });
  });
});
