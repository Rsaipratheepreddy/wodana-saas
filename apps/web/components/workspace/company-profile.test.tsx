import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { companyProfileFixture } from "@/lib/workspace/company-profile";
import { CompanyProfile } from "./company-profile";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CompanyProfile", () => {
  it("renders the company identity without section tabs and opens a focused editor", async () => {
    const interaction = userEvent.setup();
    render(<CompanyProfile canManage initialData={structuredClone(companyProfileFixture)} />);

    expect(screen.getByRole("heading", { name: "Iglo Architects" })).toBeInTheDocument();
    expect(screen.getAllByText("Iglo Architects LLC")).toHaveLength(2);
    expect(screen.getByText("United Arab Emirates · AE")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Company profile sections" })).not.toBeInTheDocument();

    await interaction.click(screen.getByRole("button", { name: "Edit company information" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit company information" });
    expect(within(dialog).getByRole("textbox", { name: /Company display name/ })).toHaveValue("Iglo Architects");
    expect(within(dialog).queryByRole("textbox", { name: /Tenant login ID/ })).not.toBeInTheDocument();
    expect(within(dialog).getByText("iglo-architects")).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox", { name: /Registered company name/ })).not.toBeInTheDocument();
  });

  it("validates the editor and applies a successful versioned save", async () => {
    const interaction = userEvent.setup();
    const updatedWorkspace = {
      ...companyProfileFixture.workspace,
      name: "Iglo Architecture",
      version: 2,
    };
    const updatedEntity = {
      ...companyProfileFixture.legalEntities[0],
      displayName: "Iglo Architecture",
      version: 2,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workspace: updatedWorkspace, legalEntity: updatedEntity }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CompanyProfile canManage initialData={structuredClone(companyProfileFixture)} />);

    await interaction.click(screen.getByRole("button", { name: "Edit company information" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit company information" });
    const name = within(dialog).getByRole("textbox", { name: /Company display name/ });
    await interaction.clear(name);
    await interaction.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(within(dialog).getAllByText("Enter a company name.")).toHaveLength(2);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await interaction.type(name, "Iglo Architecture");
    await interaction.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(request).toMatchObject({
      workspaceId: companyProfileFixture.workspace.id,
      workspaceVersion: 1,
      legalEntityVersion: 1,
      name: "Iglo Architecture",
    });
    expect(request).not.toHaveProperty("slug");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit company information" })).not.toBeInTheDocument());
    expect(screen.getByText("Org profile saved.")).toBeInTheDocument();
    expect(screen.getAllByText("Iglo Architecture").length).toBeGreaterThan(0);
  });

  it("keeps edit controls hidden from read-only members", () => {
    render(<CompanyProfile canManage={false} initialData={structuredClone(companyProfileFixture)} />);
    expect(screen.queryByRole("button", { name: "Edit company information" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit company logo" })).not.toBeInTheDocument();
    expect(screen.getByText(/Only workspace owners and administrators/)).toBeInTheDocument();
  });

  it("loads only locations for the company country and selected administrative area", async () => {
    const interaction = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("region=Dubai")) {
        return { ok: true, json: async () => ({ items: [{ id: "Dubai", label: "Dubai" }] }) };
      }
      return { ok: true, json: async () => ({ items: [{ id: "Dubai", label: "Dubai" }, { id: "Sharjah Emirate", label: "Sharjah Emirate" }] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CompanyProfile canManage initialData={structuredClone(companyProfileFixture)} />);

    await interaction.click(screen.getByRole("button", { name: "Edit registered office" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit registered office" });
    const emirate = within(dialog).getByRole("combobox", { name: "Emirate" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/geo/locations?countryCode=AE", expect.objectContaining({ signal: expect.any(AbortSignal) })));

    await interaction.click(emirate);
    await interaction.type(emirate, "Dubai{ArrowDown}{Enter}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/geo/locations?countryCode=AE&region=Dubai", expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(within(dialog).getByRole("combobox", { name: "City" })).toBeEnabled();
  });

  it("renders repeated address values as labeled fields without duplicate React keys", () => {
    const profile = structuredClone(companyProfileFixture);
    profile.legalEntities[0].address = {
      line1: "Ras Al Khaimah",
      line2: "Ras Al Khaimah",
      city: "Ras Al Khaimah",
      region: "Ras al-Khaimah",
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<CompanyProfile canManage initialData={profile} />);

    const office = screen.getByRole("region", { name: "Registered office" });
    expect(within(office).getByText("Address")).toBeInTheDocument();
    expect(within(office).getByText("City")).toBeInTheDocument();
    expect(within(office).getByText("Emirate")).toBeInTheDocument();
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
    consoleError.mockRestore();
  });
});
