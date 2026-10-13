import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineCheckPage, TimelineChecks } from "./timeline-checks";
afterEach(() => vi.unstubAllGlobals());

const WORKSPACE = "d004d45c-7140-4b0c-a68d-e87d012c2390", OPPORTUNITY = "40000000-0000-4000-8000-000000000001", CHECK = "50000000-0000-4000-8000-000000000001";
const PAVEL = "10000000-0000-4000-8000-000000000003";

function setup(payloads: Record<string, unknown>) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url, "http://localhost").pathname.replace("/api/workspace/crm/data/", "");
    return { ok: true, status: 200, json: async () => init?.method && init.method !== "GET" ? { ok: true } : payloads[path] ?? {} };
  });
  vi.stubGlobal("fetch", fetcher);
  const sent = (suffix: string) => fetcher.mock.calls.filter(([url, init]) => String(url).includes(suffix) && init?.method === "POST").map(([, init]) => JSON.parse(String(init?.body)));
  return { sent };
}

const open = { id: CHECK, opportunityId: OPPORTUNITY, question: "Lead time for the wardrobes?", status: "open", answer: null, dueAt: "2026-10-14T14:00:00Z", answeredAt: null,
  createdAt: "2026-10-14T08:00:00Z", version: 1, teamCode: "PRODUCTION", assigneeMembershipId: PAVEL, assigneeName: "Pavel Production", askerName: "Sara Sales", answeredByName: null, canAnswer: true, canCancel: true };

describe("timeline checks (PLM-155)", () => {
  it("asks one person of the chosen teams, with the client's target date in the question, and answers an open one", async () => {
    const user = userEvent.setup();
    const { sent } = setup({ [`opportunities/${OPPORTUNITY}/timeline-checks`]: { opportunityId: OPPORTUNITY, targetCompletion: "2027-01-15", canAsk: true,
      people: [{ membershipId: PAVEL, name: "Pavel Production", teams: [{ code: "PRODUCTION", name: "Production" }] }], checks: [open] } });
    render(<TimelineChecks workspaceId={WORKSPACE} opportunityId={OPPORTUNITY} />);
    expect(await screen.findByText("Lead time for the wardrobes?")).toBeInTheDocument();
    expect(screen.getByText(/Pavel Production · Due/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ask" }));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByRole("textbox", { name: /Question/ }) as HTMLTextAreaElement).value).toMatch(/^Can we meet the client.s target of .*2027\?$/);
    await user.click(within(dialog).getByRole("button", { name: /Choose who answers/ }));
    await user.click(await screen.findByRole("option", { name: "Pavel Production · Production" }));
    await user.click(within(dialog).getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(sent(`opportunities/${OPPORTUNITY}/timeline-checks`)).toEqual([expect.objectContaining({ assigneeMembershipId: PAVEL, requestId: expect.any(String),
      question: expect.stringMatching(/^Can we meet the client's target/) })]));

    await user.click(screen.getByRole("button", { name: "Answer" }));
    const answer = await screen.findByRole("dialog");
    await user.type(within(answer).getByRole("textbox", { name: /Answer/ }), "Six weeks from the approved drawings");
    await user.click(within(answer).getByRole("button", { name: "Send answer" }));
    await waitFor(() => expect(sent(`timeline-checks/${CHECK}/answer`)).toEqual([{ version: 1, answer: "Six weeks from the approved drawings" }]));
  });

  it("opens for the person asked without opening the opportunity", async () => {
    setup({ [`timeline-checks/${CHECK}`]: { ...open, opportunity: { id: OPPORTUNITY, reference: "O-0007", title: "Villa", client: "Noura Haddad", targetCompletion: "2027-01-15", canOpen: false } } });
    render(<TimelineCheckPage workspaceId={WORKSPACE} checkId={CHECK} />);
    expect(await screen.findByText("Lead time for the wardrobes?")).toBeInTheDocument();
    expect(screen.getByText("Noura Haddad")).not.toHaveAttribute("href");
    expect(screen.getByRole("button", { name: "Answer" })).toBeInTheDocument();
  });
});
