import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { securityPageFixture } from "@/lib/workspace/security";
import { SecurityPage } from "./security-page";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SecurityPage", () => {
  it("shows active sessions directly with a current-device label", () => {
    render(<SecurityPage initialData={structuredClone(securityPageFixture)} />);
    expect(screen.getByRole("heading", { name: "Authenticator verification" })).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === "9 recovery codes remaining")).toBeInTheDocument();
    expect(screen.getByText("Required by account policy")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Active sessions" })).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
  });

  it("revokes one selected session after confirmation", async () => {
    const interaction = userEvent.setup();
    const target = securityPageFixture.sessions[1];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ familyId: target.familyId, revoked: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SecurityPage initialData={structuredClone(securityPageFixture)} />);

    await interaction.click(screen.getByRole("button", { name: "Sign out Safari on iPhone or iPad" }));
    const dialog = await screen.findByRole("dialog", { name: "Sign out this session?" });
    await interaction.click(within(dialog).getByRole("button", { name: "Sign out session" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/workspace/security/sessions/${target.familyId}`);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ workspaceId: securityPageFixture.workspaceId });
    expect(await screen.findByText("Safari on iPhone or iPad was signed out.")).toBeInTheDocument();
    expect(screen.queryByText("iPhone or iPad")).not.toBeInTheDocument();
  });

  it("requires a fresh factor before replacing recovery codes", async () => {
    const interaction = userEvent.setup();
    const codes = ["AAAA-BBBB-CCCC-DDDD", "EEEE-FFFF-GGGG-HHHH"];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ accessToken: "new-access" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ recoveryCodes: codes }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SecurityPage initialData={structuredClone(securityPageFixture)} />);

    await interaction.click(screen.getByRole("button", { name: "New recovery codes" }));
    const dialog = await screen.findByRole("dialog", { name: "Generate new recovery codes" });
    await interaction.type(within(dialog).getByRole("textbox", { name: /Authenticator or recovery code/ }), "123456");
    await interaction.click(within(dialog).getByRole("button", { name: "Generate new codes" }));

    expect(await screen.findByRole("dialog", { name: "Save your recovery codes" })).toBeInTheDocument();
    expect(screen.getByText(codes[0])).toBeInTheDocument();
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/auth/mfa/step-up",
      "/api/auth/mfa/recovery",
    ]);
  });

});
