import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { OpportunityIntro, type IntroView } from "./opportunity-intro";

afterEach(() => vi.unstubAllGlobals());
const base: IntroView = { designer: null, intro: null, history: [], blockers: [], timezone: "Europe/London", canChangeDesigner: false };
/** The API as Sales sees it: the opportunity's designers, and no member directory (403). */
function stub(view: IntroView) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("/members")
    ? { ok: false, status: 403, json: async () => ({ message: "Any permission required: module.members.read" }) }
    : { ok: true, json: async () => url.includes("/opportunities/o1/designers") ? { items: [{ id: "m1", displayName: "Dana Designer" }, { id: "m2", displayName: "Omar Designer" }] } : view }));
}
const renderIntro = () => render(<DesignSystemProvider><OpportunityIntro workspaceId="ws" opportunityId="o1" locale="en-GB" /></DesignSystemProvider>);

describe("opportunity intro meeting (PLM-043, PLM-088)", () => {
  it("waits for the discovery facts before booking, without listing them again", async () => {
    stub({ ...base, blockers: [{ key: "floorPlan", label: "Floor plan" }, { key: "clientEmail", label: "Client email" }] });
    renderIntro();
    expect(await screen.findByRole("button", { name: "Book intro meeting" })).toBeDisabled();
    expect(screen.queryByText(/Add these on Discovery first/)).not.toBeInTheDocument();
    expect(screen.getByText("Not booked")).toBeInTheDocument();
  });

  it("shows the booked meeting in the workspace zone and the dedicated designer", async () => {
    stub({ ...base, canChangeDesigner: true, designer: { membershipId: "m1", name: "Dana Designer", version: 1 },
      intro: { activityId: "a1", status: "pending", title: "Intro to Studio", startsAt: "2031-07-15T08:00:00Z", endsAt: "2031-07-15T09:00:00Z", timezone: "Europe/London", location: { mode: "online", url: "https://meet.example.com/x" } } });
    renderIntro();
    expect(await screen.findByText(/Tue 15 Jul, 9:00 – 10:00/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Online meeting link" })).toHaveAttribute("href", "https://meet.example.com/x");
    expect(screen.getByText("Booked")).toBeInTheDocument();
    expect(screen.getByText("Dana Designer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Book intro meeting" })).not.toBeInTheDocument();
  });

  it("hands a blocked booking back so the missing facts can be added", async () => {
    const blockers = [{ key: "area", label: "Area" }, { key: "targetCompletion", label: "Enter the client's target completion date", where: "enquiry" as const }];
    stub({ ...base, blockers });
    const onBlocked = vi.fn();
    const onBookingStarted = vi.fn();
    render(<DesignSystemProvider><OpportunityIntro workspaceId="ws" opportunityId="o1" locale="en-GB" startBooking onBlocked={onBlocked} onBookingStarted={onBookingStarted} /></DesignSystemProvider>);
    // Everything that is missing goes back, each with where it's completed (PLM-155).
    await waitFor(() => expect(onBlocked).toHaveBeenCalledWith(blockers));
    expect(onBookingStarted).toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Book intro meeting" })).not.toBeInTheDocument();
  });

  it("lets Sales book with a designer from the opportunity's designers, without the member directory", async () => {
    stub(base);
    renderIntro();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Book intro meeting" }));
    const dialog = await screen.findByRole("dialog", { name: "Book intro meeting" });
    await userEvent.setup().click(within(dialog).getByRole("button", { name: /Designer/ }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["Dana Designer", "Omar Designer"]);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url)).some((url) => url.includes("/members"))).toBe(false);
  });

  it("hides Change from people who cannot change the designer", async () => {
    stub({ ...base, designer: { membershipId: "m1", name: "Dana Designer", version: 1 } });
    renderIntro();
    expect(await screen.findByText("Dana Designer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Book intro meeting" })).toBeEnabled();
  });
});
