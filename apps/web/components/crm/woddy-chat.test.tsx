import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { useWoddy, useWoddyRecord, WoddyProvider } from "./woddy-chat";

function Launcher() { const woddy = useWoddy(); return <button onClick={woddy?.open}>Ask Woddy</button>; }
async function openChat() {
  const user = userEvent.setup();
  render(<DesignSystemProvider><WoddyProvider workspaceId="workspace-1"><Launcher /></WoddyProvider></DesignSystemProvider>);
  await user.click(screen.getByRole("button", { name: "Ask Woddy" }));
  return { user, input: screen.getByRole("textbox", { name: "Message Woddy" }) };
}
afterEach(() => vi.unstubAllGlobals());
const reply = (answer: string, patch: Record<string, unknown> = {}) => ({ runId: "run-1", answer, sources: [], cited: [], proposals: [], draft: null, stopped: null, ...patch });

describe("Woddy chat", () => {
  it("asks a question handed over from ⌘K once, opening the chat (NV-2)", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(reply("Two quotes wait for the client.")), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    function Asker() { const woddy = useWoddy(); return <button onClick={() => woddy?.ask("Which quotes wait?")}>Hand over</button>; }
    render(<DesignSystemProvider><WoddyProvider workspaceId="workspace-1"><Asker /></WoddyProvider></DesignSystemProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Hand over" }));
    expect(await screen.findByRole("article", { name: "Woddy reply" })).toHaveTextContent("Two quotes wait for the client.");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ message: "Which quotes wait?" });
  });


  it("shows Woddy's avatar while typing and answering, and submits Enter only once", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const { user, input } = await openChat();
    await user.type(input, "What is next?{Shift>}{Enter}{/Shift}Keep it short.");
    expect(fetcher).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status", { name: "Woddy is typing" })).toBeVisible();
    expect(within(screen.getByRole("log")).getByRole("img", { name: "Woddy is thinking" })).toHaveAttribute("src", "/brand/woddy/thinking.webp");
    expect(within(screen.getByRole("log")).getByRole("img", { name: "You" })).toBeVisible();
    await act(async () => finish(new Response(JSON.stringify(reply("Review your next customer follow-up.")), { status: 200 })));
    expect(await screen.findByRole("article", { name: "Woddy reply" })).toHaveTextContent("Review your next customer follow-up.");
    expect(screen.queryByRole("status", { name: "Woddy is typing" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("log")).getByRole("img", { name: "Woddy is celebrating" })).toHaveAttribute("src", "/brand/woddy/celebrating.webp");
    expect(input).toHaveValue("");
    await waitFor(() => expect(input).toHaveFocus());
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ workspaceId: "workspace-1", message: "What is next?\nKeep it short.", surface: "panel", context: null, history: [] });
    expect(fetcher.mock.calls[0][0]).toBe("/api/workspace/woddy");
  });

  it("preserves a failed question for retry and supports the send button", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ message: "Temporarily unavailable" }), { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify(reply("Ready now.")), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const { user, input } = await openChat();
    await user.type(input, "Help me plan");
    await user.click(screen.getByRole("button", { name: "Send message to Woddy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Temporarily unavailable");
    expect(input).toHaveValue("Help me plan");
    expect(screen.queryByRole("article", { name: "Your message" })).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("article", { name: "Woddy reply" })).toHaveTextContent("Ready now.");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("says calmly that AI credits are used up, with the next step, instead of an error to retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "AI credits are used up. Ask your admin to top up.", paused: true }), { status: 402 })));
    const { user, input } = await openChat();
    await user.type(input, "What next?{Enter}");
    expect(await screen.findByRole("status")).toHaveTextContent("AI credits are used up. Ask your admin to top up.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).toHaveValue("What next?");
  });

  it("asks about the record open and shows what Woddy prepared as a card to confirm", async () => {
    const lead = "00000000-0000-4000-8000-000000000118";
    function Lead() { useWoddyRecord("lead", lead, "ENQ-118"); return <Launcher />; }
    const card = { id: "00000000-0000-4000-8000-0000000000c1", runId: "run-1", tool: "schedule_follow_up", status: "proposed", title: { key: "Follow up with {client}", values: { client: "Maya Rao" } },
      summary: "Follow up with Maya Rao", version: 1, selection: null, record: null, failures: [], error: null, target: null, expiresAt: new Date(Date.now() + 900_000).toISOString(),
      preview: { kind: "fields", fields: [{ label: "When", after: "2026-09-30T06:00:00.000Z", format: "datetime" }] } };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(reply("", { proposals: [card] })), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<DesignSystemProvider><WoddyProvider workspaceId="workspace-1"><Lead /></WoddyProvider></DesignSystemProvider>);
    await user.click(screen.getByRole("button", { name: "Ask Woddy" }));
    await user.type(screen.getByRole("textbox", { name: "Message Woddy" }), "follow up with Maya tomorrow 10 am{Enter}");
    expect(await screen.findByRole("region", { name: "Woddy action" })).toHaveTextContent("Follow up with Maya Rao");
    expect(screen.getByText("I prepared this for you. Nothing changes until you confirm.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ context: { type: "enquiry", id: lead, label: "ENQ-118" }, surface: "panel" });
  });

  it("stops an in-flight reply and restores the question", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError"))))));
    const { user, input } = await openChat();
    await user.type(input, "Explain the CRM{Enter}");
    await user.click(screen.getByRole("button", { name: "Stop Woddy reply" }));
    await waitFor(() => expect(input).toHaveValue("Explain the CRM"));
    expect(screen.queryByRole("status", { name: "Woddy is typing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
