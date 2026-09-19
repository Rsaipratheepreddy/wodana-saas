import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { WorkspaceTerminologyData } from "@/lib/workspace/company-profile";
import { companyProfileFixture } from "@/lib/workspace/company-profile";
import { TerminologyPanel } from "./terminology-panel";

const data: WorkspaceTerminologyData = {
  items: [{
    key: "opportunity",
    defaultVisibleName: "Deal",
    defaultVisibleNamePlural: "Deals",
    visibleName: "Deal",
    visibleNamePlural: "Deals",
    overridden: false,
    version: 0,
    updatedAt: null,
  }],
  map: { opportunity: { visibleName: "Deal", visibleNamePlural: "Deals" } },
};

function renderPanel(onChange = vi.fn()) {
  render(<DesignSystemProvider><TerminologyPanel canManage data={data} onChange={onChange} workspaceId={companyProfileFixture.workspace.id} /></DesignSystemProvider>);
  return onChange;
}

afterEach(() => vi.unstubAllGlobals());

describe("TerminologyPanel", () => {
  it("saves a versioned override using the tenant workspace API", async () => {
    const interaction = userEvent.setup();
    const onChange = renderPanel();
    const saved = { ...data.items[0], visibleName: "Opportunity", visibleNamePlural: "Opportunities", overridden: true, version: 1 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => saved });
    vi.stubGlobal("fetch", fetchMock);

    await interaction.click(screen.getByRole("button", { name: "Edit Deal language" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Deal" });
    await interaction.clear(within(dialog).getByRole("textbox", { name: "Singular" }));
    await interaction.type(within(dialog).getByRole("textbox", { name: "Singular" }), "Opportunity");
    await interaction.clear(within(dialog).getByRole("textbox", { name: "Plural" }));
    await interaction.type(within(dialog).getByRole("textbox", { name: "Plural" }), "Opportunities");
    await interaction.click(within(dialog).getByRole("button", { name: "Save language" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspace/terminology/opportunity");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      workspaceId: companyProfileFixture.workspace.id,
      version: 0,
      visibleName: "Opportunity",
      visibleNamePlural: "Opportunities",
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      map: { opportunity: { visibleName: "Opportunity", visibleNamePlural: "Opportunities" } },
    }));
  });

  it("restores a custom label with its current version", async () => {
    const interaction = userEvent.setup();
    const custom: WorkspaceTerminologyData = {
      ...data,
      items: [{ ...data.items[0], visibleName: "Opportunity", visibleNamePlural: "Opportunities", overridden: true, version: 2 }],
    };
    const onChange = vi.fn();
    const restored = { ...data.items[0] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => restored });
    vi.stubGlobal("fetch", fetchMock);
    render(<DesignSystemProvider><TerminologyPanel canManage data={custom} onChange={onChange} workspaceId={companyProfileFixture.workspace.id} /></DesignSystemProvider>);

    await interaction.click(screen.getByRole("button", { name: "Edit Deal language" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Deal" });
    await interaction.click(within(dialog).getByRole("button", { name: "Restore default" }));
    const confirmation = await screen.findByRole("dialog", { name: "Restore default language?" });
    await interaction.click(within(confirmation).getByRole("button", { name: "Restore default" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspace/terminology/opportunity");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ workspaceId: companyProfileFixture.workspace.id, version: 2 });
  });
});
