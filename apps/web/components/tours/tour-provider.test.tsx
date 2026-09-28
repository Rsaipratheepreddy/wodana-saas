import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { TourProvider, useTours } from "./tour-provider";
import { WALKTHROUGH_KEY, walkthroughKey } from "./walkthrough-callout";
import { WoddyMenu } from "./woddy-menu";

const router = vi.hoisted(() => ({
  push: vi.fn((href: string) => window.history.pushState({}, "", href)),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const writes: string[] = [];
const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (init?.method && !["GET", "HEAD"].includes(init.method)) writes.push(`${init.method} ${url}`);
  // No recorded lines in tests: captions are paced on screen.
  if (url.endsWith(".mp3")) return new Response(null, { status: 404 });
  return new Response(JSON.stringify({ items: [], projects: [] }), { headers: { "content-type": "application/json" } });
});

/** Something on the page with its own state, to prove it comes back fresh after a tour. */
function Draft() {
  const [count, setCount] = useState(0);
  return <button type="button" onClick={() => setCount((value) => value + 1)}>Typed {count}</button>;
}

function Start({ id }: { id: string }) {
  const tours = useTours();
  return <button type="button" onClick={() => tours?.start(id)}>Start {id}</button>;
}

function page(extra: React.ReactNode = null) {
  return render(<DesignSystemProvider><TourProvider userId="u1" userName="Maya Test" workspaceId="4f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d">
    <main data-tour="page-content"><div data-tour="enquiry-list">Enquiries</div><Draft /><Start id="full-journey" />{extra}</main>
  </TourProvider></DesignSystemProvider>);
}

beforeEach(() => {
  writes.length = 0;
  vi.stubGlobal("fetch", network);
  window.history.replaceState({}, "", "/workspace/tasks?view=mine");
  // jsdom lays nothing out: every element counts as on screen.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(() => [{ top: 0, left: 0, width: 10, height: 10 }] as unknown as DOMRectList);
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  router.push.mockClear();
  router.refresh.mockClear();
});

describe("starting and leaving a tour", () => {
  it("shows the loader until the first screen is ready, keeps demo mode on throughout, and brings the real workspace back", async () => {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole("button", { name: "Typed 0" }));
    expect(screen.getByRole("button", { name: "Typed 1" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start full-journey" }));
    // At once: the loader covers the page and nothing can be written.
    expect(await screen.findByText("Getting the tour ready…")).toBeInTheDocument();
    expect(document.documentElement.dataset.tourDemo).toBe("true");
    await expect(fetch("/api/workspace/crm/leads", { method: "POST", body: "{}" })).rejects.toMatchObject({ name: "AbortError" });
    // The tour shows once its first screen and target are there; the loader has gone.
    await waitFor(() => expect(document.querySelector(".wd-tour")).not.toBeNull(), { timeout: 8000 });
    expect(router.push).toHaveBeenCalledWith("/workspace/crm/leads");
    await waitFor(() => expect(screen.queryByText("Getting the tour ready…")).not.toBeInTheDocument());
    expect(document.documentElement.dataset.tourDemo).toBe("true");

    // Leaving: the loader covers the page again, demo mode goes, the page is fresh and the person is back.
    await user.click(screen.getByRole("button", { name: "Exit tour" }));
    expect(await screen.findByText("Back to your workspace…")).toBeInTheDocument();
    expect(document.querySelector(".wd-tour")).toBeNull();
    await waitFor(() => expect(screen.queryByText("Back to your workspace…")).not.toBeInTheDocument(), { timeout: 8000 });
    expect(router.push).toHaveBeenLastCalledWith("/workspace/tasks?view=mine");
    expect(window.location.pathname + window.location.search).toBe("/workspace/tasks?view=mine");
    expect(router.refresh).toHaveBeenCalled();
    expect(document.documentElement.dataset.tourDemo).toBeUndefined();
    // Nothing from the demo remains: the page's own state starts again, and writes go through once more.
    expect(screen.getByRole("button", { name: "Typed 0" })).toBeInTheDocument();
    await fetch("/api/workspace/crm/leads", { method: "POST", body: "{}" });
    expect(writes).toEqual(["POST /api/workspace/crm/leads"]);
  }, 20_000);
});

describe("the first-run highlight", () => {
  const callout = "Here's Woddy. He'll walk you through Wodana.";

  it("offers the walkthrough on Ask Woddy the first time, and one click starts it", async () => {
    const user = userEvent.setup();
    page(<WoddyMenu />);
    expect(await screen.findByText(callout, undefined, { timeout: 3000 })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start the walkthrough" }));
    expect(window.localStorage.getItem(walkthroughKey("u1"))).toBe("true");
    expect(await screen.findByText("Getting the tour ready…")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(callout)).not.toBeInTheDocument());
    // The walkthrough opens with Woddy's greeting.
    await waitFor(() => expect(document.querySelector(".wd-tour-text")?.textContent).toBe("Hi Maya! Let's follow one job from enquiry to handover."), { timeout: 8000 });
    await user.click(screen.getByRole("button", { name: "Exit tour" }));
    await waitFor(() => expect(screen.queryByText("Back to your workspace…")).not.toBeInTheDocument(), { timeout: 8000 });
  }, 20_000);

  it("stays quiet once it has been seen", async () => {
    window.localStorage.setItem(walkthroughKey("u1"), "true");
    page(<WoddyMenu />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 1000)));
    expect(screen.queryByText(callout)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask Woddy" })).toBeInTheDocument();
  });

  it("remembers \"Not now\" for this person", async () => {
    const user = userEvent.setup();
    page(<WoddyMenu />);
    await user.click(await screen.findByRole("button", { name: "Not now" }, { timeout: 3000 }));
    expect(screen.queryByText(callout)).not.toBeInTheDocument();
    expect(window.localStorage.getItem(`${WALKTHROUGH_KEY}:u1`)).toBe("true");
    expect(document.querySelector(".wd-tour-loader")).toBeNull();
  });

  it("is never shown on a phone", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width: 40rem"), addEventListener() {}, removeEventListener() {} }));
    page(<WoddyMenu />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 1000)));
    expect(screen.queryByText(callout)).not.toBeInTheDocument();
  });
});
