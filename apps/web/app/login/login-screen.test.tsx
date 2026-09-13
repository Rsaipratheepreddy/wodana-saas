import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openAuthenticatedWorkspace } from "@/lib/auth/client";
import { LoginScreen } from "./login-screen";
import { securityPageFixture } from "@/lib/workspace/security";

const replace = vi.fn(), refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock("@/lib/auth/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/client")>(), openAuthenticatedWorkspace: vi.fn(),
}));
afterEach(() => { vi.unstubAllGlobals(); replace.mockReset(); refresh.mockReset(); vi.mocked(openAuthenticatedWorkspace).mockClear(); });

async function limitedLogin() {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: "DEVICE_LIMIT_REACHED", sessions: securityPageFixture.sessions.slice(0, 2) }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<LoginScreen demoCredentials={{ email: "owner@example.com", password: "DemoPassword#2026" }} nextPath="/workspace" tenant={{ displayName: "Test", loginSlug: "test", logoUrl: null }} />);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  const dialog = await screen.findByRole("dialog", { name: "Device limit reached" });
  return { user, fetchMock, dialog };
}

describe("login device limit modal", () => {
  it("blocks entry, lists devices in a modal, and closes without logging out a device", async () => {
    const { user, fetchMock, dialog } = await limitedLogin();
    expect(within(dialog).getAllByRole("button", { name: "Log out device" })).toHaveLength(2);
    expect(replace).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Back to sign in" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("uses the selected device id and only enters after the backend admits the login", async () => {
    const { user, fetchMock, dialog } = await limitedLogin();
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ authenticated: true }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ authenticated: true }) });
    await user.click(within(dialog).getAllByRole("button", { name: "Log out device" })[1]);
    await waitFor(() => expect(openAuthenticatedWorkspace).toHaveBeenCalledWith("/workspace"));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ revokeFamilyId: securityPageFixture.sessions[1].familyId, tenantSlug: "test" });
  });
  it("keeps the modal open and reports network failures without pretending logout succeeded", async () => {
    const { user, fetchMock, dialog } = await limitedLogin();
    fetchMock.mockRejectedValueOnce(new Error("Offline"));
    await user.click(within(dialog).getAllByRole("button", { name: "Log out device" })[0]);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Unable to reach the sign-in service");
    expect(replace).not.toHaveBeenCalled();
    expect(within(dialog).getAllByRole("button", { name: "Log out device" })).toHaveLength(2);
  });
});

describe("login progress and failure feedback", () => {
  function renderLogin() {
    render(<LoginScreen demoCredentials={{ email: "owner@example.com", password: "DemoPassword#2026" }} nextPath="/workspace" tenant={{ displayName: "Test", loginSlug: "test", logoUrl: null }} />);
    return userEvent.setup();
  }
  it("keeps progress visible through session confirmation and the workspace handoff", async () => {
    let releaseLogin!: (response: unknown) => void;
    let releaseSession!: (response: unknown) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { releaseLogin = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { releaseSession = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const user = renderLogin();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("status")).toHaveTextContent("Signing you in");
    expect(screen.getByRole("button", { name: /Signing in/ })).toBeDisabled();
    releaseLogin({ ok: true, status: 200, json: async () => ({ authenticated: true }) });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Confirming your browser session"));
    expect(openAuthenticatedWorkspace).not.toHaveBeenCalled();
    releaseSession({ ok: true, status: 200, json: async () => ({ authenticated: true }) });
    await waitFor(() => expect(openAuthenticatedWorkspace).toHaveBeenCalledWith("/workspace"));
    expect(screen.getByRole("status")).toHaveTextContent("Signed in. Opening your workspace");
    expect(screen.getByRole("link", { name: "Open workspace" })).toHaveAttribute("href", "/workspace");
  });
  it.each([
    { label: "invalid JSON", login: { ok: true, status: 200, json: async () => null }, session: null, message: "incomplete response" },
    { label: "missing authentication result", login: { ok: true, status: 200, json: async () => ({}) }, session: null, message: "could not be completed" },
    { label: "missing cookie session", login: { ok: true, status: 200, json: async () => ({ authenticated: true }) }, session: { ok: false, status: 401, json: async () => ({ authenticated: false }) }, message: "browser session could not be confirmed" },
    { label: "service failure", login: { ok: false, status: 503, json: async () => ({ message: "Sign-in is temporarily unavailable." }) }, session: null, message: "temporarily unavailable" },
  ])("shows a retryable error for $label", async ({ login, session, message }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(login).mockResolvedValueOnce(session));
    const user = renderLogin();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(message));
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(openAuthenticatedWorkspace).not.toHaveBeenCalled();
  });
});
