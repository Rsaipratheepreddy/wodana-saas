import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { securityPageFixture } from "@/lib/workspace/security";
import { SecurityPage } from "./security-page";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SecurityPage", () => {
  it("shows active sessions directly with a current-device label", () => {
    render(<SecurityPage initialData={structuredClone(securityPageFixture)} />);
    expect(screen.getByRole("heading", { name: "Two-step verification" })).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === "9 left")).toBeInTheDocument();
    expect(screen.getByText("Required by account policy")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Active sessions" })).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
  });

  it("lists every view of the person by someone else under Activity: who, when and how long", () => {
    render(<SecurityPage initialData={structuredClone(securityPageFixture)} viewAsActivity={[
      { id: "v1", viewerName: "Olivia Owner", startedAt: "2026-09-28T09:00:00.000Z", endedAt: "2026-09-28T09:12:00.000Z", minutes: 12, open: false },
      { id: "v2", viewerName: "Adam Admin", startedAt: "2026-09-29T09:00:00.000Z", endedAt: null, minutes: null, open: true },
    ]} />);
    expect(screen.getByRole("heading", { name: "Activity" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Viewed as you" });
    expect(within(table).getByText("Olivia Owner")).toBeInTheDocument();
    expect(within(table).getByText("12 min")).toBeInTheDocument();
    expect(within(table).getByText("Now")).toBeInTheDocument();
  });

  it("revokes one selected session after confirmation", async () => {
    const interaction = userEvent.setup();
    const target = securityPageFixture.sessions[1];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ familyId: target.familyId, revoked: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SecurityPage initialData={structuredClone(securityPageFixture)} />);

    await interaction.click(screen.getByRole("button", { name: "Sign out Safari on iPhone" }));
    const dialog = await screen.findByRole("dialog", { name: "Sign out this session?" });
    await interaction.click(within(dialog).getByRole("button", { name: "Sign out session" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/workspace/security/sessions/${target.familyId}`);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ workspaceId: securityPageFixture.workspaceId });
    expect(await screen.findByText("Safari on iPhone was signed out.")).toBeInTheDocument();
    expect(screen.queryByText("iPhone")).not.toBeInTheDocument();
  });

  it("requires a fresh factor before replacing recovery codes", async () => {
    const interaction = userEvent.setup();
    const codes = ["AAAA-BBBB-CCCC-DDDD", "EEEE-FFFF-GGGG-HHHH"];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ accessToken: "new-access" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ recoveryCodes: codes }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SecurityPage initialData={structuredClone(securityPageFixture)} />);

    await interaction.click(screen.getByRole("button", { name: "New codes" }));
    const dialog = await screen.findByRole("dialog", { name: "Get new recovery codes" });
    await interaction.type(within(dialog).getByRole("textbox", { name: /Authenticator or recovery code/ }), "123456");
    await interaction.click(within(dialog).getByRole("button", { name: "Generate codes" }));

    expect(await screen.findByRole("dialog", { name: "Save your recovery codes" })).toBeInTheDocument();
    expect(screen.getByText(codes[0])).toBeInTheDocument();
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/auth/mfa/step-up",
      "/api/auth/mfa/recovery",
    ]);
  });

  it("explains how to retain recovery codes when clipboard access is unavailable", async () => {
    const interaction = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ recoveryCodes: ["AAAA-BBBB-CCCC-DDDD"] }) }));
    render(<SecurityPage initialData={structuredClone(securityPageFixture)} />);
    await interaction.click(screen.getByRole("button", { name: "New codes" }));
    await interaction.type(screen.getByRole("textbox", { name: /Authenticator or recovery code/ }), "123456");
    await interaction.click(screen.getByRole("button", { name: "Generate codes" }));
    const dialog = await screen.findByRole("dialog", { name: "Save your recovery codes" });
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue(undefined as unknown as Clipboard);
    await interaction.click(within(dialog).getByRole("button", { name: "Copy all" }));
    expect(await within(dialog).findByText("Select and copy the codes manually.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeDisabled();
    expect(within(dialog).getByText("AAAA-BBBB-CCCC-DDDD")).toBeInTheDocument();
  });

  it("removes revoked devices after the server confirms MFA disable", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(securityPageFixture);
    data.mfa.required = false;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SecurityPage initialData={data} />);
    await interaction.click(screen.getByRole("button", { name: "Turn off" }));
    const dialog = await screen.findByRole("dialog", { name: "Turn off two-step verification" });
    await interaction.type(within(dialog).getByRole("textbox", { name: /Authenticator or recovery code/ }), "123456");
    await interaction.click(within(dialog).getByRole("button", { name: "Turn off verification" }));
    expect(await screen.findByText("Two-step verification was turned off. Other sessions were signed out.")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.queryByText("iPhone")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/api/auth/mfa/step-up", "/api/auth/mfa/disable"]);
  });

});
