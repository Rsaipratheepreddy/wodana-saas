import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("runs the order of 13 Oct 2026: the team to allocate, the kick-off, the site measure inside the concept (PLM-140, PLM-141, PLM-151)", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => view({ canEdit: true, journey: { packageName: "Bespoke Interior Design", includedRevisions: 2, flowVersion: 2, includesRenders: true, renderSignoffDueOn: "2031-05-20" },
      team: { version: 4, reviewRole: null, missing: ["junior_designer"], slots: [
        { slot: "lead_designer", role: "designer", label: "Lead Interior Designer", member: { membershipId: "m1", name: "Lina Lead" }, notApplicable: false, canSet: true },
        { slot: "junior_designer", role: "junior_designer", label: "Junior Interior Designer", member: null, notApplicable: false, canSet: true },
        { slot: "visualiser", role: "visualiser", label: "Visualiser", member: null, notApplicable: false, canSet: false }] },
      tasks: [{ task: "team_allocation", label: "Design team", status: "open", ownerId: "a1", ownerName: "Aisha AM", dueAt: "2031-04-01T10:00:00Z", completedAt: null, completedByName: null, note: null, version: 1, overdue: false },
        { task: "site_measure", label: "Design site measure", status: "open", ownerId: "m1", ownerName: "Lina Lead", dueAt: "2031-04-04T10:00:00Z", completedAt: null, completedByName: null, note: null, version: 2, overdue: true }],
      stages: [stage({ stage: "inspiration", status: "done", completedAt: "2031-03-30T10:00:00Z" }), stage({ stage: "kickoff", label: "Kick-off meeting", status: "done", completedAt: "2031-04-01T10:00:00Z" }),
        stage({ stage: "concepts", status: "active", dueAt: "2031-04-08T10:00:00Z", version: 6 }), stage({ stage: "renders", label: "Renders" }), stage({ stage: "samples", label: "Samples" })] }) }));
    vi.stubGlobal("fetch", fetch);
    render(<DesignSystemProvider><DesignJourney workspaceId="ws" caseId="c1" locale="en-GB" members={[{ id: "m1", displayName: "Lina Lead" }, { id: "m2", displayName: "Jad Junior" }]} /></DesignSystemProvider>);
    // The team, the part still to choose, and who may set what.
    expect(await screen.findByText("Lead Interior Designer")).toBeInTheDocument();
    expect(screen.getAllByText("Not chosen")).toHaveLength(2);
    expect(screen.getByText("To allocate by 1 Apr")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Choose|Change/ })).toHaveLength(2);
    // The kick-off's agreed render date, and the site measure on the concept's line.
    expect(screen.getByText("Render sign-off agreed for 20 May 2031")).toBeInTheDocument();
    expect(screen.getByText(/Design site measure due/)).toBeInTheDocument();
    expect(screen.getAllByText("Overdue").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Open the visit" })[0]).toHaveAttribute("href", "/workspace/pre-projects/cases/c1/site");
    // Changing an allocated designer asks for the reason.
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("offers the job's people to an Account Manager who can't read People: the team view brings them (PLM-151)", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => view({ journey: { packageName: "Bespoke Interior Design", includedRevisions: 2, flowVersion: 2, includesRenders: true },
      team: { version: 4, reviewRole: null, missing: ["junior_designer"], candidates: [{ id: "m1", displayName: "Lina Lead" }, { id: "m2", displayName: "Jad Junior" }], slots: [
        { slot: "lead_designer", role: "designer", label: "Lead Interior Designer", member: { membershipId: "m1", name: "Lina Lead" }, notApplicable: false, canSet: true },
        { slot: "junior_designer", role: "junior_designer", label: "Junior Interior Designer", member: null, notApplicable: false, canSet: true }] },
      stages: [stage({ stage: "inspiration", status: "active" })] }) }));
    vi.stubGlobal("fetch", fetch);
    renderJourney();
    fireEvent.click(await screen.findByRole("button", { name: "Choose" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Junior Interior Designer/ }));
    expect(await screen.findByRole("option", { name: "Jad Junior" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Not needed on this job" })).toBeInTheDocument();
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

  it("books the sample meeting at the showroom by hand without a booking page, and at the client's home only when chosen (PLM-144)", async () => {
    const samples = view({ journey: { packageName: "Bespoke Interior Design", includedRevisions: 2, flowVersion: 2, includesRenders: true },
      tasks: [{ task: "sample_collection", label: "Sample collection", status: "done", ownerId: "c1", ownerName: "Mona", dueAt: null, completedAt: "2031-04-10T10:00:00Z", completedByName: "Mona", note: null, version: 2, overdue: false }],
      stages: [stage({ stage: "samples", label: "Samples", status: "active", version: 7 })] });
    const fetch = vi.fn(async () => ({ ok: true, json: async () => samples }));
    vi.stubGlobal("fetch", fetch);
    renderJourney();
    fireEvent.click(await screen.findByRole("button", { name: "Book sample meeting" }));
    const dialog = await screen.findByRole("dialog", { name: "Book sample meeting" });
    // At the showroom: the address is optional and the meeting isn't marked as at the client's home.
    expect(within(dialog).getByRole("button", { name: "Book" })).toBeEnabled();
    expect(within(dialog).queryByText("Client's address")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("material-selection/schedule"), expect.objectContaining({ method: "POST" })));
    const body = JSON.parse((fetch.mock.calls.find(([url]) => String(url).includes("material-selection/schedule")) as unknown as [string, { body: string }])[1].body);
    expect(body).not.toHaveProperty("atClientHome");
    expect(await screen.findByText("Sample meeting booked. The design team has been invited.")).toBeInTheDocument();
    // The client's home is the other choice, with their address.
    fireEvent.click(screen.getByRole("button", { name: "At the client's home" }));
    expect(await screen.findByText("Client's address")).toBeInTheDocument();
  });
});
