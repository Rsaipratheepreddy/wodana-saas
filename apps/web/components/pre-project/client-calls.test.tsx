import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { ClientCallsSection, type ClientCallsView } from "./client-calls";

const caseRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pre-project/content", () => ({ caseRequest }));
afterEach(() => caseRequest.mockReset());

const weekly: ClientCallsView = { caseId: "case-1", frequency: "weekly", mode: "call", started: true, startedFrom: "design_approval", version: 3, ownerName: "Amal Account", hasOwner: true,
  next: { activityId: "a1", startsAt: "2026-10-13T09:00:00.000Z", on: "2026-10-13" } };
const show = () => render(<DesignSystemProvider locale="en-GB" timeZone="UTC"><ClientCallsSection workspaceId="w1" caseId="case-1" /></DesignSystemProvider>);

describe("client update calls on the case (PLM-046)", () => {
  it("show how often, the next call and with whom; a change is sent with the version seen", async () => {
    caseRequest.mockImplementation(async (_w: string, _c: string, _path: string, method = "GET") => method === "GET" ? weekly : { ...weekly, frequency: "fortnightly", version: 4 });
    const user = userEvent.setup();
    show();
    expect(await screen.findByRole("heading", { name: "Client updates" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /How often/ })).toHaveTextContent("Weekly");
    expect(screen.getByText("Amal Account")).toBeInTheDocument();
    expect(screen.getByText(/13 Oct/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /How often/ }));
    await user.click(await screen.findByRole("option", { name: "Every two weeks" }));
    await waitFor(() => expect(caseRequest).toHaveBeenCalledWith("w1", "case-1", "client-calls", "PUT", { frequency: "fortnightly", mode: "call", version: 3 }));
    expect(await screen.findByRole("button", { name: /How often/ })).toHaveTextContent("Every two weeks");
  });

  it("can be declined (off), and stay hidden on a job with no Account Manager", async () => {
    caseRequest.mockResolvedValueOnce({ ...weekly, started: false, hasOwner: false, frequency: "off", next: null, version: 0 });
    const { unmount } = show();
    await waitFor(() => expect(caseRequest).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { name: "Client updates" })).toBeNull();
    unmount();
    caseRequest.mockReset();
    caseRequest.mockImplementation(async (_w: string, _c: string, _path: string, method = "GET") => method === "GET" ? weekly : { ...weekly, frequency: "off", next: null, version: 4 });
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole("button", { name: /How often/ }));
    await user.click(await screen.findByRole("option", { name: "Off" }));
    await waitFor(() => expect(caseRequest).toHaveBeenCalledWith("w1", "case-1", "client-calls", "PUT", { frequency: "off", mode: "call", version: 3 }));
    await waitFor(() => expect(screen.queryByText("Amal Account")).toBeNull());
  });

  it("switch to a progress update in the portal: the next update is due on a day, for the Account Manager", async () => {
    const portal: ClientCallsView = { ...weekly, mode: "portal", version: 4, next: { activityId: "t1", startsAt: "2026-10-13T18:00:00.000Z", on: "2026-10-13" } };
    caseRequest.mockImplementation(async (_w: string, _c: string, _path: string, method = "GET") => method === "GET" ? weekly : portal);
    const user = userEvent.setup();
    show();
    expect(await screen.findByText("Next call")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Update by/ }));
    await user.click(await screen.findByRole("option", { name: "Portal update" }));
    await waitFor(() => expect(caseRequest).toHaveBeenCalledWith("w1", "case-1", "client-calls", "PUT", { frequency: "weekly", mode: "portal", version: 3 }));
    expect(await screen.findByText("Next update due")).toBeInTheDocument();
    expect(screen.getByText("Tue 13 Oct")).toBeInTheDocument();
    expect(screen.getByText("Account Manager")).toBeInTheDocument();
    expect(screen.queryByText("Next call")).toBeNull();
  });
});
