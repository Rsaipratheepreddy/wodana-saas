import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { membersPageFixture } from "@/lib/workspace/members";
import { MembersPage } from "./members-page";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MembersPage", () => {
  it("renders a full-width directory from real member and invitation records", () => {
    const data = structuredClone(membersPageFixture);
    data.invitations.push({
      id: "10000000-0000-4000-8000-000000000001",
      displayName: "Maya Thomas",
      email: "maya@igloarchitects.com",
      status: "pending",
      expiresAt: "2026-09-13T12:00:00.000Z",
      acceptedAt: null,
      cancelledAt: null,
      createdAt: "2026-09-06T12:00:00.000Z",
      invitedByName: "Iglo Administrator",
      roles: ["member"],
    });

    render(<MembersPage initialData={data} />);

    expect(screen.getByRole("heading", { name: "Member settings" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Workspace members" })).toBeInTheDocument();
    expect(screen.getByText("admin@igloarchitects.com")).toBeInTheDocument();
    expect(screen.getByText("maya@igloarchitects.com")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Iglo Administrator" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select maya@igloarchitects.com" })).toBeInTheDocument();
  });

  it("creates an invitation and shows the one-time activation link", async () => {
    const interaction = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "10000000-0000-4000-8000-000000000001",
        displayName: "Maya Thomas",
        email: "maya@igloarchitects.com",
        roleCodes: ["member"],
        expiresAt: "2026-09-13T12:00:00.000Z",
        invitationToken: "a-secure-invitation-token-that-is-long-enough",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<MembersPage initialData={structuredClone(membersPageFixture)} />);

    await interaction.click(screen.getByRole("button", { name: "Personalize invitation" }));
    const dialog = await screen.findByRole("dialog", { name: "Invite a member" });
    await interaction.type(within(dialog).getByRole("textbox", { name: /Full name/ }), "Maya Thomas");
    await interaction.type(within(dialog).getByRole("textbox", { name: /Work email/ }), "maya@igloarchitects.com");
    await interaction.click(within(dialog).getByRole("button", { name: "Create invitation" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      workspaceId: membersPageFixture.workspaceId,
      displayName: "Maya Thomas",
      email: "maya@igloarchitects.com",
      roleCodes: ["member"],
    });
    const ready = await screen.findByRole("dialog", { name: "Invitation ready" });
    expect(within(ready).getByDisplayValue(/\/login\?invitation=/)).toBeInTheDocument();
    expect(screen.getByText("maya@igloarchitects.com")).toBeInTheDocument();
  });

  it("creates a standard member invitation from the inline composer", async () => {
    const interaction = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "10000000-0000-4000-8000-000000000002",
        displayName: "Maya Thomas",
        email: "maya.thomas@igloarchitects.com",
        roleCodes: ["member"],
        expiresAt: "2026-09-13T12:00:00.000Z",
        invitationToken: "a-second-secure-invitation-token-that-is-long-enough",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<MembersPage initialData={structuredClone(membersPageFixture)} />);

    await interaction.type(screen.getByRole("textbox", { name: "Email addresses to invite" }), "maya.thomas@igloarchitects.com");
    await interaction.click(screen.getByRole("button", { name: "Invite (1)" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      displayName: "Maya Thomas",
      email: "maya.thomas@igloarchitects.com",
      roleCodes: ["member"],
    });
    expect(await screen.findByRole("dialog", { name: "Invitation ready" })).toBeInTheDocument();
  });

  it("creates bulk invitations from comma-separated email addresses", async () => {
    const interaction = userEvent.setup();
    let responseNumber = 0;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as { displayName: string; email: string; roleCodes: string[] };
      responseNumber += 1;
      return {
        ok: true,
        json: async () => ({
          id: `10000000-0000-4000-8000-${String(responseNumber).padStart(12, "0")}`,
          displayName: request.displayName,
          email: request.email,
          roleCodes: request.roleCodes,
          expiresAt: "2026-09-13T12:00:00.000Z",
          invitationToken: `secure-token-${responseNumber}`,
          emailDelivery: { status: "sent", provider: "mailgun" },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<MembersPage initialData={structuredClone(membersPageFixture)} />);

    await interaction.type(
      screen.getByRole("textbox", { name: "Email addresses to invite" }),
      "maya@igloarchitects.com, noah@igloarchitects.com",
    );
    await interaction.click(screen.getByRole("button", { name: "Invite (2)" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("dialog", { name: "Bulk invitations ready" })).toBeInTheDocument();
    expect(screen.getByText("2 invitations created")).toBeInTheDocument();
    expect(screen.getByText("2 emails were accepted for delivery.")).toBeInTheDocument();
  });

  it("loads unique addresses from a CSV into the bulk composer", async () => {
    const interaction = userEvent.setup();
    render(<MembersPage initialData={structuredClone(membersPageFixture)} />);
    const file = new File(
      ["name,email\nMaya,maya@igloarchitects.com\nNoah,noah@igloarchitects.com\nDuplicate,maya@igloarchitects.com"],
      "members.csv",
      { type: "text/csv" },
    );
    Object.defineProperty(file, "text", {
      value: async () => "name,email\nMaya,maya@igloarchitects.com\nNoah,noah@igloarchitects.com\nDuplicate,maya@igloarchitects.com",
    });

    await interaction.upload(screen.getByLabelText("Upload invitation CSV"), file);

    expect(screen.getByRole("textbox", { name: "Email addresses to invite" })).toHaveValue(
      "maya@igloarchitects.com, noah@igloarchitects.com",
    );
    expect(screen.getByRole("button", { name: "Invite (2)" })).toBeInTheDocument();
  });

  it("keeps management controls hidden for read-only members", () => {
    const data = structuredClone(membersPageFixture);
    data.canManage = false;
    render(<MembersPage initialData={data} />);
    expect(screen.queryByRole("button", { name: "Personalize invitation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Actions for/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Only workspace owners and administrators/)).toBeInTheDocument();
  });
});
