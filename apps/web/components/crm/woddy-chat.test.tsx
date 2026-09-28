import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { useWoddy, WoddyProvider } from "./woddy-chat";

function Launcher() { const woddy = useWoddy(); return <button onClick={woddy?.open}>Ask Woddy</button>; }
async function openChat() {
  const user = userEvent.setup();
  render(<DesignSystemProvider><WoddyProvider workspaceId="workspace-1"><Launcher /></WoddyProvider></DesignSystemProvider>);
  await user.click(screen.getByRole("button", { name: "Ask Woddy" }));
  return { user, input: screen.getByRole("textbox", { name: "Message Woddy" }) };
}
afterEach(() => vi.unstubAllGlobals());

describe("Woddy chat", () => {
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
    await act(async () => finish(new Response(JSON.stringify({ answer: "Review your next customer follow-up." }), { status: 200 })));
    expect(await screen.findByRole("article", { name: "Woddy reply" })).toHaveTextContent("Review your next customer follow-up.");
    expect(screen.queryByRole("status", { name: "Woddy is typing" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("log")).getByRole("img", { name: "Woddy is celebrating" })).toHaveAttribute("src", "/brand/woddy/celebrating.webp");
    expect(input).toHaveValue("");
    await waitFor(() => expect(input).toHaveFocus());
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).messages[0].text).toBe("What is next?\nKeep it short.");
  });

  it("preserves a failed question for retry and supports the send button", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ message: "Temporarily unavailable" }), { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify({ answer: "Ready now." }), { status: 200 }));
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
