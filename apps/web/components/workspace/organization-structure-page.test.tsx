import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { organizationStructureFixture } from "@/lib/workspace/organization-structure";
import { membersPageFixture } from "@/lib/workspace/members";
import { OrganizationStructurePage } from "./organization-structure-page";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OrganizationStructurePage", () => {
  it("separates business units and teams into compact tabs", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(organizationStructureFixture);
    data.teams.push({
      id: "30000000-0000-4000-8000-000000000001",
      businessUnitId: data.businessUnits[0].id,
      code: "CONCEPT",
      name: "Concept Design",
      description: "Concepts and client presentations",
      status: "active",
      version: 1,
      members: [],
    });

    render(<OrganizationStructurePage initialData={data} />);

    expect(screen.getByRole("tab", { name: "Teams (1)" })).toHaveAttribute("aria-selected", "true");
    // The counts show once, on the tabs: no summary strip repeating them.
    expect(screen.queryByText("1 team")).not.toBeInTheDocument();
    expect(screen.queryByText("1 department")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Organization structure summary" })).not.toBeInTheDocument();
    expect(screen.getByText("Concept Design")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit members in Concept Design" })).toBeInTheDocument();
    await interaction.click(screen.getByRole("tab", { name: "Business units (1)" }));
    expect(screen.getByText("Design Studio")).toBeInTheDocument();
    expect(screen.queryByText("Concept Design")).not.toBeInTheDocument();
  });

  it("creates a team with selected members through the real endpoint contract", async () => {
    const interaction = userEvent.setup();
    const data = structuredClone(organizationStructureFixture);
    const administrator = structuredClone(membersPageFixture.members[0]);
    const secondMember = {
      ...structuredClone(membersPageFixture.members[0]),
      id: "20000000-0000-4000-8000-000000000002",
      userId: "10000000-0000-4000-8000-000000000002",
      displayName: "Studio Member",
      email: "studio.member@igloarchitects.com",
    };
    data.members = [administrator, secondMember];
    const created = {
      id: "30000000-0000-4000-8000-000000000002",
      businessUnitId: data.businessUnits[0].id,
      code: "CONCEPT",
      name: "Concept Design",
      description: "Concepts and presentations",
      status: "active" as const,
      version: 1,
      members: [{
        membershipId: data.members[0].id,
        userId: data.members[0].userId,
        displayName: data.members[0].displayName,
        email: data.members[0].email,
        isLead: false,
      }, {
        membershipId: data.members[1].id,
        userId: data.members[1].userId,
        displayName: data.members[1].displayName,
        email: data.members[1].email,
        isLead: false,
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => created });
    vi.stubGlobal("fetch", fetchMock);

    render(<OrganizationStructurePage initialData={data} />);
    await interaction.click(screen.getByRole("button", { name: "Team" }));
    const dialog = await screen.findByRole("dialog", { name: "Create team" });
    await interaction.type(within(dialog).getByRole("textbox", { name: /Team name/ }), "Concept Design");
    await interaction.type(within(dialog).getByRole("textbox", { name: /Code/ }), "concept");
    await interaction.type(within(dialog).getByRole("textbox", { name: "Description" }), "Concepts and presentations");
    await interaction.click(within(dialog).getByRole("checkbox", { name: /Iglo Administrator/ }));
    await interaction.click(within(dialog).getByRole("checkbox", { name: /Studio Member/ }));
    await interaction.click(within(dialog).getByRole("button", { name: "Save team" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspace/teams");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      workspaceId: data.workspaceId,
      businessUnitId: data.businessUnits[0].id,
      code: "concept",
      name: "Concept Design",
      memberIds: [data.members[0].id, data.members[1].id],
    });
    expect(await screen.findByText("Concept Design was saved.")).toBeInTheDocument();
  });
});
