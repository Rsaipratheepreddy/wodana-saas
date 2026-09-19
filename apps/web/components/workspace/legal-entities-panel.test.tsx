import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { companyProfileFixture } from "@/lib/workspace/company-profile";
import { LegalEntitiesPanel } from "./legal-entities-panel";

function renderPanel(onChange = vi.fn()) {
  render(<DesignSystemProvider><LegalEntitiesPanel canManage initialEntities={companyProfileFixture.legalEntities} onChange={onChange} workspace={companyProfileFixture.workspace} /></DesignSystemProvider>);
  return onChange;
}

afterEach(() => vi.unstubAllGlobals());

describe("LegalEntitiesPanel", () => {
  it("creates a tenant legal entity with inherited regional defaults", async () => {
    const interaction = userEvent.setup();
    const onChange = renderPanel();
    const saved = {
      ...companyProfileFixture.legalEntities[0],
      id: "40000000-0000-4000-8000-000000000001",
      code: "PALM",
      displayName: "Palm Living",
      registeredName: "Palm Living LLC",
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => saved });
    vi.stubGlobal("fetch", fetchMock);

    await interaction.click(screen.getByRole("button", { name: "Add business" }));
    const dialog = await screen.findByRole("dialog", { name: "Add business" });
    await interaction.type(within(dialog).getByRole("textbox", { name: "Display name" }), "Palm Living");
    expect(within(dialog).getByRole("textbox", { name: "Entity code" })).toHaveValue("PALM_LIVING");
    await interaction.clear(within(dialog).getByRole("textbox", { name: "Entity code" }));
    await interaction.type(within(dialog).getByRole("textbox", { name: "Entity code" }), "PALM");
    await interaction.click(within(dialog).getByRole("button", { name: "Add business" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspace/legal-entities");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      workspaceId: companyProfileFixture.workspace.id,
      code: "PALM",
      displayName: "Palm Living",
      registeredName: "Palm Living",
      countryCode: "AE",
      baseCurrency: "AED",
      locale: "en-AE",
      timezone: "Asia/Dubai",
    });
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ code: "PALM" })]));
  });

  it("keeps archive unavailable while only one active legal entity remains", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: "Archive Iglo Architects" })).not.toBeInTheDocument();
    expect(screen.getByText("At least one active business record is required for a workspace.")).toBeInTheDocument();
  });
});
