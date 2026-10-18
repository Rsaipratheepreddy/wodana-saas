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
    expect(screen.getByRole("heading", { name: "Brand" })).toBeInTheDocument();
    expect(screen.getByText("Iglo Architects")).toBeInTheDocument();
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

    // The empty required name blocks the save, and the summary names it.
    expect(await within(dialog).findByText("Check 1 field")).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Upload background" })).not.toBeInTheDocument();
  });

  it("uploads a sign-in background through the short-lived upload, previews it, and removes it after confirmation", async () => {
    const interaction = userEvent.setup();
    const assetId = "7c1d0c2e-3b51-4a39-9f6e-0d7c1a2b3c4d";
    const workspaceId = companyProfileFixture.workspace.id;
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/workspace/company-profile/login-background-uploads") {
        return { ok: true, json: async () => ({ assetId, uploadMode: "application", uploadUrl: null, uploadHeaders: { "content-type": "image/jpeg" } }) };
      }
      if (url.endsWith("/complete?workspaceId=" + workspaceId)) {
        return { ok: true, json: async () => ({ assetId, loginBackgroundUrl: `/api/auth/tenant-background/iglo-architects?v=${assetId}`, updatedAt: "2026-10-15T08:00:00.000Z" }) };
      }
      return { ok: true, json: async () => ({ uploaded: true, removed: true }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CompanyProfile canManage initialData={structuredClone(companyProfileFixture)} />);

    expect(screen.getByText("Sign-in background")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
    const file = new File([new Uint8Array(2048)], "showroom.jpg", { type: "image/jpeg" });
    await interaction.upload(screen.getByLabelText("Upload background"), file);

    await waitFor(() => expect(screen.getByText("Sign-in background updated.")).toBeInTheDocument());
    const started = fetchMock.mock.calls.find(([url]) => url === "/api/workspace/company-profile/login-background-uploads");
    expect(JSON.parse(String(started?.[1]?.body))).toEqual({ workspaceId, filename: "showroom.jpg", mimeType: "image/jpeg", byteSize: 2048 });
    expect(fetchMock).toHaveBeenCalledWith(`/api/workspace/company-profile/login-background-uploads/${assetId}/content?workspaceId=${workspaceId}`,
      expect.objectContaining({ method: "PUT", body: file }));
    expect(screen.getByRole("img", { name: "Sign-in background" })).toHaveAttribute("src", `/api/auth/tenant-background/iglo-architects?v=${assetId}`);

    await interaction.click(screen.getAllByRole("button", { name: "Remove" }).at(-1)!);
    const dialog = await screen.findByRole("dialog", { name: "Remove sign-in background?" });
    await interaction.click(within(dialog).getByRole("button", { name: "Remove background" }));
    await waitFor(() => expect(screen.getByText("Sign-in background removed.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(`/api/workspace/company-profile/login-background?workspaceId=${workspaceId}`, { method: "DELETE" });
    expect(screen.queryByRole("img", { name: "Sign-in background" })).not.toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
  });

  it("refuses a sign-in background over 10 MB before uploading anything", async () => {
    const interaction = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<CompanyProfile canManage initialData={structuredClone(companyProfileFixture)} />);
    const file = new File(["x"], "huge.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 10 * 1024 * 1024 + 1 });
    await interaction.upload(screen.getByLabelText("Upload background"), file);
    expect(await screen.findByText("Sign-in background must be 10 MB or smaller.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("login-background"))).toBe(false);
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
