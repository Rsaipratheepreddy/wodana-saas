import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openAuthenticatedWorkspace } from "@/lib/auth/client";
import { LoginScreen } from "./login-screen";
import { securityPageFixture } from "@/lib/workspace/security";

const replace = vi.fn(), refresh = vi.fn(), push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh, push }) }));
vi.mock("@/lib/auth/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/client")>(), openAuthenticatedWorkspace: vi.fn(),
}));
afterEach(() => { vi.unstubAllGlobals(); replace.mockReset(); push.mockReset(); refresh.mockReset(); vi.mocked(openAuthenticatedWorkspace).mockClear(); });

async function fillCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: /^Email/ }), "owner@example.com");
  await user.type(screen.getByLabelText(/^Password/, { selector: "input" }), "DemoPassword#2026");
}

async function limitedLogin() {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: "DEVICE_LIMIT_REACHED", sessions: securityPageFixture.sessions.slice(0, 2) }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<LoginScreen nextPath="/workspace" tenant={{ displayName: "Test", loginSlug: "test", logoUrl: null }} />);
  await fillCredentials(user);
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
  it("closes the reclaimed-device dialog before continuing into MFA enrollment", async () => {
    const { user, fetchMock, dialog } = await limitedLogin();
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({
      authenticated: true,
      selectedWorkspaceId: securityPageFixture.workspaceId,
      mfaEnrollmentRequired: true,
      mfaEnrollmentDeadline: "2026-09-22T00:00:00.000Z",
    }) });

    await user.click(within(dialog).getAllByRole("button", { name: "Log out device" })[0]);

    expect(await screen.findByRole("heading", { name: "Protect your account" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Device limit reached" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Set up authenticator" })).toBeEnabled();
  });
});

describe("login tenant branding", () => {
  it("presents the tenant as the primary identity and Wodana as the platform provider", () => {
    render(<LoginScreen nextPath="/workspace" tenant={{ displayName: "Palm Living", loginSlug: "palm-living", logoUrl: null }} />);

    expect(screen.getAllByLabelText("Palm Living workspace")).toHaveLength(1);
    expect(screen.getAllByLabelText("Powered by Wodana")).toHaveLength(1);
  });
});

describe("login progress and failure feedback", () => {
  it("does not present a completed password reset as a sign-in error", () => {
    render(<LoginScreen nextPath="/workspace" initialStatus="Password updated. Sign in with your new password." initialStatusTone="info" tenant={{ displayName: "Test", loginSlug: "test", logoUrl: null }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Password updated");
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "info");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  async function renderLogin() {
    render(<LoginScreen nextPath="/workspace" tenant={{ displayName: "Test", loginSlug: "test", logoUrl: null }} />);
    const user = userEvent.setup();
    await fillCredentials(user);
    return user;
  }
  it("keeps progress visible through session confirmation and the workspace handoff", async () => {
    let releaseLogin!: (response: unknown) => void;
    let releaseSession!: (response: unknown) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { releaseLogin = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { releaseSession = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const user = await renderLogin();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("status")).toHaveTextContent("Signing you in");
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "info");
    expect(screen.getByRole("button", { name: /Signing in/ })).toBeDisabled();
    releaseLogin({ ok: true, status: 200, json: async () => ({ authenticated: true }) });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Confirming your browser session"));
    expect(openAuthenticatedWorkspace).not.toHaveBeenCalled();
    releaseSession({ ok: true, status: 200, json: async () => ({ authenticated: true }) });
    await waitFor(() => expect(openAuthenticatedWorkspace).toHaveBeenCalledWith("/workspace"));
    expect(screen.getByRole("status")).toHaveTextContent("Signed in. Opening your workspace");
    expect(screen.getByRole("link", { name: "Open workspace" })).toHaveAttribute("href", "/workspace");
  });
  it("sends a first-time owner into resumable onboarding", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ authenticated: true, nextAction: "start_onboarding" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ authenticated: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = await renderLogin();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(openAuthenticatedWorkspace).toHaveBeenCalledWith("/onboarding"));
  });
  it("highlights a rate-limit error as an assertive alert without retrying automatically", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ message: "Too many sign-in attempts. Try again later." }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = await renderLogin();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Sign-in needs attention");
    expect(alert).toHaveTextContent("Too many sign-in attempts");
    expect(alert).toHaveAttribute("data-tone", "error");
    expect(alert).toHaveAttribute("data-visible", "true");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each([
    { label: "invalid JSON", login: { ok: true, status: 200, json: async () => null }, session: null, message: "incomplete response" },
    { label: "missing authentication result", login: { ok: true, status: 200, json: async () => ({}) }, session: null, message: "could not be completed" },
    { label: "missing cookie session", login: { ok: true, status: 200, json: async () => ({ authenticated: true }) }, session: { ok: false, status: 401, json: async () => ({ authenticated: false }) }, message: "browser session could not be confirmed" },
    { label: "service failure", login: { ok: false, status: 503, json: async () => ({ message: "Sign-in is temporarily unavailable." }) }, session: null, message: "temporarily unavailable" },
  ])("shows a retryable error for $label", async ({ login, session, message }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(login).mockResolvedValueOnce(session));
    const user = await renderLogin();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(message));
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(openAuthenticatedWorkspace).not.toHaveBeenCalled();
  });
});

describe("login MFA flow", () => {
  async function renderLogin() {
    render(<LoginScreen nextPath="/workspace" tenant={{ displayName: "Test", loginSlug: "test", logoUrl: null }} />);
    const user = userEvent.setup();
    await fillCredentials(user);
    return user;
  }

  async function enterOtp(user: ReturnType<typeof userEvent.setup>, code: string) {
    for (const [index, digit] of [...code].entries()) {
      await user.type(screen.getByLabelText(`Digit ${index + 1}`), digit);
    }
  }

  it("completes a second-factor challenge before opening the workspace", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ mfaRequired: true, methods: ["totp", "recovery_code"] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ authenticated: true, selectedWorkspaceId: "00000000-0000-4000-8000-000000000002" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ authenticated: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = await renderLogin();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Verify it’s you" })).toBeInTheDocument();
    expect(openAuthenticatedWorkspace).not.toHaveBeenCalled();
    await enterOtp(user, "123456");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));

    await waitFor(() => expect(openAuthenticatedWorkspace).toHaveBeenCalledWith("/workspace"));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toEqual({ code: "123456" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/mfa/verify");
  });

  it("returns from the authenticator challenge to sign in and clears the pending session", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ mfaRequired: true, methods: ["totp"] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ signedOut: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = await renderLogin();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Verify it’s you" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to sign in" }));

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/logout");
    expect(openAuthenticatedWorkspace).not.toHaveBeenCalled();
  });

  it("keeps the selected device logout through a second MFA challenge", async () => {
    const sessions = securityPageFixture.sessions.slice(0, 2);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ mfaRequired: true }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ code: "DEVICE_LIMIT_REACHED", message: "Log out a device to continue.", sessions }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ mfaRequired: true }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ authenticated: true, selectedWorkspaceId: securityPageFixture.workspaceId }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ authenticated: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = await renderLogin();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await enterOtp(user, "123456");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));
    const dialog = await screen.findByRole("dialog", { name: "Device limit reached" });
    await user.click(within(dialog).getAllByRole("button", { name: "Log out device" })[1]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await enterOtp(user, "654321");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));

    await waitFor(() => expect(openAuthenticatedWorkspace).toHaveBeenCalledWith("/workspace"));
    expect(JSON.parse(String(fetchMock.mock.calls[2][1].body))).toMatchObject({ revokeFamilyId: sessions[1].familyId });
  });

  it("enrolls a required account and requires recovery-code acknowledgement", async () => {
    const workspaceId = "00000000-0000-4000-8000-000000000002";
    const codes = ["AAAA-BBBB-CCCC-DDDD", "EEEE-FFFF-GGGG-HHHH"];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ authenticated: true, selectedWorkspaceId: workspaceId, mfaEnrollmentRequired: true, mfaEnrollmentDeadline: "2026-09-22T00:00:00.000Z" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ secret: "ABCDEFGHIJKLMNOP", otpauthUri: "otpauth://totp/Wodana:test?secret=ABCDEFGHIJKLMNOP", setupExpiresInSeconds: 600 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ enabled: true, recoveryCodes: codes }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ authenticated: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = await renderLogin();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Protect your account" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Set up authenticator" }));
    expect(await screen.findByText("ABCDEFGHIJKLMNOP")).toBeInTheDocument();
    await enterOtp(user, "654321");
    await user.click(screen.getByRole("button", { name: "Confirm authenticator" }));

    expect(await screen.findByRole("heading", { name: "Save your recovery codes" })).toBeInTheDocument();
    expect(screen.getByText(codes[0])).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to workspace" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Continue to workspace" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Confirm that you saved");
    expect(openAuthenticatedWorkspace).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox", { name: "I saved these recovery codes" }));
    await user.click(screen.getByRole("button", { name: "Continue to workspace" }));
    await waitFor(() => expect(openAuthenticatedWorkspace).toHaveBeenCalledWith("/workspace"));
  });

  it("shows the setup key in one row and lets the user go back through enrollment", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ authenticated: true, selectedWorkspaceId: "00000000-0000-4000-8000-000000000002", mfaEnrollmentRequired: true }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ secret: "ABCDEFGHIJKLMNOP", otpauthUri: "otpauth://totp/Wodana:test?secret=ABCDEFGHIJKLMNOP" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ signedOut: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = await renderLogin();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.click(await screen.findByRole("button", { name: "Set up authenticator" }));
    expect(await screen.findByLabelText("Authenticator setup key")).toHaveTextContent("ABCDEFGHIJKLMNOP");
    expect(screen.getByRole("button", { name: "Copy setup key" })).toBeInTheDocument();
    expect(screen.queryByText("Can’t scan? Use setup key")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Back$/ }));
    expect(await screen.findByRole("heading", { name: "Protect your account" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(fetchMock.mock.calls[2][0]).toBe("/api/auth/logout");
  });
});

describe("email-first sign-in", () => {
  const workspaces = [
    { name: "Palm Living", loginSlug: "palm-living", logoUrl: null },
    { name: "Studio B", loginSlug: "studio-b", logoUrl: null },
  ];

  it("lets a user in several workspaces choose one and resubmits with its slug", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ authenticated: true }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ workspaceSelectionRequired: true, workspaces }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<LoginScreen nextPath="/workspace" tenant={{ displayName: "Wodana", loginSlug: "", logoUrl: null }} />);

    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Choose a workspace" })).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ tenantSlug: "" });
    await user.click(screen.getByRole("button", { name: /Studio B/ }));
    await waitFor(() => expect(openAuthenticatedWorkspace).toHaveBeenCalledWith("/workspace"));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ tenantSlug: "studio-b", email: "owner@example.com" });
  });

  it("returns from the picker to the credentials form", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ workspaceSelectionRequired: true, workspaces }) }));
    render(<LoginScreen nextPath="/workspace" tenant={{ displayName: "Wodana", loginSlug: "", logoUrl: null }} />);
    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("heading", { name: "Choose a workspace" });

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Workspaces" })).not.toBeInTheDocument();
  });

  it("sends a client's mobile number to the tenant portal instead of the staff sign-in", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<LoginScreen nextPath="/workspace" tenant={{ displayName: "Palm Living", loginSlug: "palm-living", logoUrl: null }} />);

    await user.type(screen.getByRole("textbox", { name: /^Email or mobile/ }), "+971 50 123 4567");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(push).toHaveBeenCalledWith("/portal/palm-living");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
