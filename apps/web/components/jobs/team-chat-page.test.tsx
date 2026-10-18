import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { TeamChatPage } from "./team-chat-page";

vi.mock("next/navigation", () => ({ usePathname: () => "/workspace/team-chat", useSearchParams: () => new URLSearchParams() }));

const workspaceId = "2ab00a25-4912-469a-9081-d8602f2b715a";
const jobId = "11111111-1111-4111-8111-111111111111";
const threads = { items: [{ jobId, reference: "J-000038", title: "Penthouse", body: "Measured the living room", at: "2026-10-17T08:00:00Z", kind: "message", author: "Sam Sales", unread: 2 }], unread: 2 };
const thread = { messages: [{ id: "m1", kind: "message", author: { id: "u", name: "Sam Sales" }, body: "Measured the living room", mentions: [], eventCode: null, at: "2026-10-17T08:00:00Z", mine: false }],
  people: [], unread: 2, lastReadAt: null };
afterEach(() => vi.unstubAllGlobals());

describe("Team chat (§0.3)", () => {
  it("lists every job's thread with its last line and what's unread, and opens one beside the list", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes("/jobs/threads") ? threads : url.includes("/thread") ? thread : {} })));
    render(<DesignSystemProvider><TeamChatPage workspaceId={workspaceId} /></DesignSystemProvider>);
    const list = await screen.findByRole("list", { name: "Threads" });
    expect(within(list).getByText("Penthouse")).toBeInTheDocument();
    expect(within(list).getByText("Sam Sales: Measured the living room")).toBeInTheDocument();
    expect(within(list).getByLabelText("2 unread")).toBeInTheDocument();
    await userEvent.click(within(list).getByRole("button", { name: /Penthouse/ }));
    expect(await screen.findByRole("region", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "J-000038" })).toHaveAttribute("href", `/workspace/jobs/${jobId}`);
  });

  it("says when there is no team chat yet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ items: [], unread: 0 }) })));
    render(<DesignSystemProvider><TeamChatPage workspaceId={workspaceId} /></DesignSystemProvider>);
    expect(await screen.findByText("No team chat yet")).toBeInTheDocument();
  });
});
