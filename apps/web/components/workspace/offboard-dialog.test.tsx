import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { OffboardDialog } from "./offboard-dialog";

const WORKSPACE = "11111111-1111-4111-8111-111111111111", ALI = "22222222-2222-4222-8222-222222222222", SARA = "33333333-3333-4333-8333-333333333333";
const preview = {
  member: { id: ALI, name: "Ali", status: "active", version: 4 },
  counts: { enquiries: 12, opportunities: 3, followUps: 0, chats: 5, clients: 0, planning: 1, tasks: 0, projects: 2 },
  successors: [{ id: SARA, name: "Sara" }],
};

afterEach(() => vi.unstubAllGlobals());

describe("offboarding a person (SP-4)", () => {
  it("shows what moves, asks who takes over, then hands it all over", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => (init?.method === "POST" ? { status: "suspended" } : preview) }));
    vi.stubGlobal("fetch", fetcher);
    const onDone = vi.fn();
    render(<DesignSystemProvider><OffboardDialog workspaceId={WORKSPACE} membershipId={ALI} name="Ali" onClose={vi.fn()} onDone={onDone} /></DesignSystemProvider>);
    const moving = await screen.findByRole("list", { name: "What moves" });
    expect(within(moving).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["12 Enquiries", "3 Opportunities", "5 Chats", "1 Planning cases", "2 Projects"]);
    expect(screen.getByRole("button", { name: "Offboard" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Who takes over/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Sara" }));
    await userEvent.click(screen.getByRole("button", { name: "Offboard" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("Ali is offboarded. Sara has their work."));
    const post = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ workspaceId: WORKSPACE, successorMembershipId: SARA, version: 4 });
  });

  it("says why when the server refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ message: "Member not found" }) })));
    render(<DesignSystemProvider><OffboardDialog workspaceId={WORKSPACE} membershipId={ALI} name="Ali" onClose={vi.fn()} onDone={vi.fn()} /></DesignSystemProvider>);
    expect(await screen.findByText("Member not found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
