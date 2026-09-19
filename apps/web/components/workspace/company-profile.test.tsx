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
  it("shows company information cards and opens one complete profile editor", async () => {
    const interaction = userEvent.setup();
    render(<CompanyProfile canManage initialData={structuredClone(companyProfileFixture)} />);

    expect(screen.getByRole("heading", { name: "Company profile" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Iglo Architects" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Legal & tax" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Registered office" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Regional defaults" })).toBeInTheDocument();
    expect(screen.getByText("Company code")).toBeInTheDocument();
    expect(screen.getByText("Tax registration number")).toBeInTheDocument();
    expect(screen.getByText("Time zone")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Brand colour" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Primary colour")).not.toBeInTheDocument();
    expect(screen.getByText(/Iglo Architects LLC/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Business records/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Company profile sections" })).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Edit profile" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit legal and tax details" })).not.toBeInTheDocument();

    await interaction.click(screen.getByRole("button", { name: "Edit profile" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit profile" });
    expect(within(dialog).getByRole("textbox", { name: "Company name" })).toHaveValue("Iglo Architects");
    expect(within(dialog).queryByRole("textbox", { name: /Tenant login ID/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByText("iglo-architects")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Registered company name" })).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Time zone" })).toBeInTheDocument();
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

    await interaction.click(screen.getByRole("button", { name: "Edit profile" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit profile" });
    const name = within(dialog).getByRole("textbox", { name: "Company name" });
    await interaction.clear(name);
    await interaction.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(within(dialog).getAllByText("Enter a company name.")).toHaveLength(2);
    });
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/workspace/company-profile")).toBe(false);

    await interaction.type(name, "Iglo Architecture");
    await interaction.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/workspace/company-profile")).toBe(true));
    const saveCall = fetchMock.mock.calls.find(([url]) => url === "/api/workspace/company-profile");
    const request = JSON.parse(String(saveCall?.[1]?.body)) as Record<string, unknown>;
    expect(request).toMatchObject({
      workspaceId: companyProfileFixture.workspace.id,
      workspaceVersion: 1,
      legalEntityVersion: 1,
      name: "Iglo Architecture",
    });
    expect(request).not.toHaveProperty("slug");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit profile" })).not.toBeInTheDocument());
    expect(screen.getByText("Company profile saved.")).toBeInTheDocument();
    expect(screen.getAllByText("Iglo Architecture").length).toBeGreaterThan(0);
  });

  it("keeps edit controls hidden from read-only members", () => {
    render(<CompanyProfile canManage={false} initialData={structuredClone(companyProfileFixture)} />);
    expect(screen.queryByRole("button", { name: "Edit profile" })).not.toBeInTheDocument();
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

    await interaction.click(screen.getByRole("button", { name: "Edit profile" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit profile" });
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
    expect(within(office).getByText("Registered office")).toBeInTheDocument();
    expect(within(office).getByText("Street address")).toBeInTheDocument();
    expect(within(office).getByText("City")).toBeInTheDocument();
    expect(within(office).getAllByText("Ras Al Khaimah")).toHaveLength(2);
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
    consoleError.mockRestore();
  });
});
