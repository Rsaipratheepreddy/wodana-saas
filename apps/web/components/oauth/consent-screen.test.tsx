import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsentRequest } from "@/lib/mcp/consent";
import { ConsentScreen } from "./consent-screen";

const replace = vi.fn();
const router = { push: vi.fn(), replace, refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const QUERY = "response_type=code&client_id=c-1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&code_challenge=abc&code_challenge_method=S256&scope=read+write&state=s1";
const [OFF, OPEN, NO_AI] = ["00000000-0000-4000-8000-00000000000a", "00000000-0000-4000-8000-00000000000b", "00000000-0000-4000-8000-00000000000c"];
const consent = (patch: Partial<ConsentRequest> = {}): ConsentRequest => ({
  client: { id: "c-1", name: "Claude", uri: "https://claude.ai" },
  redirectHost: "claude.ai",
  scopes: ["read", "write"],
  workspaces: [
    { id: OFF, name: "Palm Studio", available: false, reason: "mcp_off" },
    { id: OPEN, name: "Palm Living", available: true, reason: null },
    { id: NO_AI, name: "Palm Joinery", available: false, reason: "ai_off" },
  ],
  ...patch,
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let assign: ReturnType<typeof vi.fn>;
const posted = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST").map(([url, init]) => ({ url, body: JSON.parse(String((init as RequestInit).body)) }));

beforeEach(() => { assign = vi.fn(); replace.mockClear(); vi.stubGlobal("location", { ...window.location, assign }); });
afterEach(() => vi.unstubAllGlobals());

describe("Connecting an AI app", () => {
  it("asks for the app's request and pre-selects the first workspace that can connect", async () => {
    const fetcher = vi.fn(async () => json(200, consent()));
    vi.stubGlobal("fetch", fetcher);
    render(<ConsentScreen query={QUERY} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Connect Claude" })).toBeInTheDocument();
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe(`/api/oauth/authorize?${QUERY}`);
    expect(screen.getByText("Returns to claude.ai")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Workspace/ })).toHaveTextContent("Palm Living");
    expect(screen.getByRole("checkbox", { name: "Read your records" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Read your records" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Prepare changes you confirm" })).toBeChecked();
    // A workspace that can't connect is shown, with why, and can't be picked.
    await userEvent.click(screen.getByRole("button", { name: /Workspace/ }));
    expect(await screen.findByRole("option", { name: /Palm Studio/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("option", { name: /Palm Studio/ })).toHaveTextContent("AI apps are off in this workspace");
    expect(screen.getByRole("option", { name: /Palm Joinery/ })).toHaveTextContent("AI assistance is off in this workspace");
    expect(screen.getByRole("option", { name: /Palm Living/ })).not.toHaveAttribute("aria-disabled");
  });

  it("allows with the workspace and access chosen, then returns to the app", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? json(200, { redirectTo: "https://claude.ai/api/mcp/auth_callback?code=xyz&state=s1" }) : json(200, consent()));
    vi.stubGlobal("fetch", fetcher);
    render(<ConsentScreen query={QUERY} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Prepare changes you confirm" }));
    await userEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://claude.ai/api/mcp/auth_callback?code=xyz&state=s1"));
    expect(posted(fetcher)).toEqual([{ url: "/api/oauth/authorize", body: { query: QUERY, workspaceId: OPEN, scopes: ["read"], decision: "allow" } }]);
  });

  it("asks for changes only when the app does, and sends both when kept", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST" ? json(200, { redirectTo: "http://localhost:6274/callback?code=1" }) : json(200, consent()));
    vi.stubGlobal("fetch", fetcher);
    const { unmount } = render(<ConsentScreen query={QUERY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Allow" }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(posted(fetcher)[0].body.scopes).toEqual(["read", "write"]);
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => json(200, consent({ scopes: ["read"] }))));
    render(<ConsentScreen query={QUERY} />);
    expect(await screen.findByRole("checkbox", { name: "Read your records" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Prepare changes you confirm" })).not.toBeInTheDocument();
  });

  it("denies, and the app hears no", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? json(200, { redirectTo: "https://claude.ai/api/mcp/auth_callback?error=access_denied&state=s1" }) : json(200, consent()));
    vi.stubGlobal("fetch", fetcher);
    render(<ConsentScreen query={QUERY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Deny" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://claude.ai/api/mcp/auth_callback?error=access_denied&state=s1"));
    expect(posted(fetcher)[0].body).toEqual({ query: QUERY, workspaceId: OPEN, scopes: ["read"], decision: "deny" });
  });

  it("can't allow when no workspace can connect, and says why", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, consent({ workspaces: [{ id: OFF, name: "Palm Studio", available: false, reason: "no_ai_access" }] }))));
    render(<ConsentScreen query={QUERY} />);
    expect(await screen.findByRole("button", { name: "Allow" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeEnabled();
    expect(screen.getAllByText("You don't have access to Woddy here").length).toBeGreaterThan(0);
  });

  it("sends a signed-out person to sign in and back here", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(401, { message: "Your session has expired. Sign in again." })));
    render(<ConsentScreen query={QUERY} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(`/oauth/authorize?${QUERY}`)}`));
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows a bad request as an error and never sends the person anywhere", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(400, { message: "This connection request isn't valid.", code: "invalid_request" })));
    render(<ConsentScreen query="client_id=unknown" />);
    expect(await screen.findByText("This connection request isn't valid.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("offers the way back to the app when the refusal can go there, without going on its own", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(400, { message: "PKCE with S256 is required.", code: "invalid_request", redirectTo: "https://claude.ai/cb?error=invalid_request&state=s1" })));
    render(<ConsentScreen query={QUERY} />);
    expect(await screen.findByText("PKCE with S256 is required.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to the app" })).toHaveAttribute("href", "https://claude.ai/cb?error=invalid_request&state=s1");
    expect(assign).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps the person here when Business Core refuses the decision, or answers with an unsafe address", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST" ? json(200, { redirectTo: "javascript:alert(1)" }) : json(200, consent()));
    vi.stubGlobal("fetch", fetcher);
    render(<ConsentScreen query={QUERY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Allow" }));
    expect(await screen.findByText("The AI app could not be connected.")).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Allow" })).toBeEnabled();
  });
});
