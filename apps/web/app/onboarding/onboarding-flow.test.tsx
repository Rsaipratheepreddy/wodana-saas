import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/i18n-provider";
import { companyProfileFixture } from "@/lib/workspace/company-profile";
import { OnboardingFlow } from "./onboarding-flow";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }) }));
// jsdom has no canvas: the welcome confetti would fail whenever a slow run lets its timer fire.
vi.mock("canvas-confetti", () => ({ default: { create: () => Object.assign(() => undefined, { reset: () => undefined }) } }));

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

describe("OnboardingFlow", () => {
  it("restores preview completion after remount and returns to connections with Back", async () => {
    const props = { initialData: structuredClone(companyProfileFixture), initialOnboarding: { status: "in_progress" as const, currentStep: "integrations" as const, completedSteps: ["workspace_profile", "organization", "team"] as Array<"workspace_profile" | "organization" | "team">, version: 4 }, isPreview: true, userName: "Katy Palmer" };
    const first = render(<OnboardingFlow {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(await screen.findByRole("heading", { name: "Your workspace is ready, Katy." })).toBeVisible();
    first.unmount();
    render(<OnboardingFlow {...props} />);
    expect(await screen.findByRole("heading", { name: "Your workspace is ready, Katy." })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Step 4 of 4")).toBeVisible();
  });

  it("sends an email-only invitation with the selected role", async () => {
    const request = vi.fn().mockResolvedValue({ok:true, json:async () => ({id:"invitation"})});
    vi.stubGlobal("fetch", request);
    render(<OnboardingFlow initialData={structuredClone(companyProfileFixture)} initialOnboarding={{ status:"in_progress", currentStep:"team", completedSteps:["workspace_profile","organization"], version:3 }} availableRoles={[{id:"member",label:"Member"},{id:"viewer",label:"Viewer"}]} userName="Katy Palmer" />);
    await userEvent.click(screen.getByRole("button",{name:"Member Role"}));
    await userEvent.click(screen.getByRole("option",{name:"Viewer"}));
    await userEvent.type(screen.getByRole("textbox",{name:"Work email"}),"new@example.com");
    await userEvent.click(screen.getByRole("button",{name:"Invite people"}));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({email:"new@example.com",roleCodes:["viewer"]});
    expect(JSON.parse(request.mock.calls[0][1].body)).not.toHaveProperty("displayName");
    expect(await screen.findByText("new@example.com")).toBeVisible();
  });

  it("accepts a dropped logo using the same preview validation and removal flow", async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    render(<OnboardingFlow initialData={structuredClone(companyProfileFixture)} initialOnboarding={{ status: "not_started", currentStep: "workspace_profile", completedSteps: [], version: 1 }} isPreview userName="Katy Palmer" />);
    const target = screen.getByRole('button', { name: 'Upload logo' }).parentElement!;
    fireEvent.drop(target, { dataTransfer: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] } });
    expect(await screen.findByRole('img', { name: 'Iglo Architects logo' })).toHaveAttribute('src', expect.stringContaining('data:image/png'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('button', { name: 'Upload logo' })).toBeEnabled();
    expect(request).not.toHaveBeenCalled();
  });
  it("switches Arabic to RTL without losing the company name or changing financial defaults", async () => {
    const user = userEvent.setup();
    const { container } = render(<I18nProvider language="en"><OnboardingFlow initialData={structuredClone(companyProfileFixture)} initialOnboarding={{ status: "not_started", currentStep: "workspace_profile", completedSteps: [], version: 1 }} isPreview userName="Katy Palmer" /></I18nProvider>);
    await user.clear(screen.getByRole("textbox", { name: "Company display name" }));
    await user.type(screen.getByRole("textbox", { name: "Company display name" }), "Palm Living");
    await user.click(screen.getByRole("button", { name: /Language/ }));
    await user.click(screen.getByRole("option", { name: /Arabic/ }));
    await waitFor(() => expect(container.querySelector('.wd-root')).toHaveAttribute('dir', 'rtl'));
    expect(container.querySelector('.wd-root')).toHaveAttribute('lang', 'ar');
    expect(screen.getByRole("textbox", { name: "اسم الشركة المعروض" })).toHaveValue("Palm Living");
    await user.click(screen.getByRole('button', { name: 'حفظ ومتابعة' }));
    expect((screen.getByRole('combobox', { name: 'العملة الأساسية' }) as HTMLInputElement).value).toContain(companyProfileFixture.workspace.defaultCurrency);
    expect(document.cookie).toContain('wodana_language=ar');
  });
  it("shows allocated seats separately and disables invites at capacity without blocking Continue", () => {
    render(<OnboardingFlow initialData={structuredClone(companyProfileFixture)} initialOnboarding={{ status: "in_progress", currentStep: "team", completedSteps: ["workspace_profile", "organization"], version: 3 }} seatCapacity={{ allocated: 5, reserved: 5, pending: 2 }} isPreview userName="Katy Palmer" />);
    expect(screen.getByRole('region', { name: 'Seats' })).toHaveTextContent('Available0Pending invitations2');
    expect(screen.getByRole('button', { name: 'Invite people' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeEnabled();
  });
  it("keeps entered company data without a decorative workspace preview", async () => {
    render(<OnboardingFlow initialData={structuredClone(companyProfileFixture)} initialOnboarding={{ status: "not_started", currentStep: "workspace_profile", completedSteps: [], version: 1 }} isPreview userName="Katy Palmer" />);
    expect(screen.queryByRole("button", { name: "Open your welcome" })).not.toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Company display name" });
    await userEvent.clear(input);
    await userEvent.type(input, "Palm Living");
    expect(input).toHaveValue("Palm Living");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
  it("saves the required company step and advances resumable progress", async () => {
    const updatedWorkspace = { ...companyProfileFixture.workspace, version: 2 };
    const updatedEntity = { ...companyProfileFixture.legalEntities[0], version: 2 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workspace: updatedWorkspace, legalEntity: updatedEntity }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "in_progress", currentStep: "organization", completedSteps: ["workspace_profile"], version: 2 }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<OnboardingFlow initialData={structuredClone(companyProfileFixture)} initialOnboarding={{ status: "not_started", currentStep: "workspace_profile", completedSteps: [], version: 1 }} userName="Katy Palmer" />);

    expect(await screen.findByRole("heading", { name: "Tell us about your company" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Save and continue/ }));

    expect(await screen.findByRole("heading", { name: "Set your workspace defaults" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      currentStep: "organization",
      completedSteps: ["workspace_profile"],
      version: 1,
    });
  });

  it("lets optional setup steps be reviewed and completes the workspace", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "in_progress", currentStep: "integrations", completedSteps: ["workspace_profile", "organization", "team"], version: 4 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "in_progress", currentStep: "integrations", completedSteps: ["workspace_profile", "organization", "team", "integrations"], version: 5 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "completed", currentStep: null, completedSteps: ["workspace_profile", "organization", "team", "integrations"], version: 6 }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<OnboardingFlow initialData={structuredClone(companyProfileFixture)} initialOnboarding={{ status: "in_progress", currentStep: "team", completedSteps: ["workspace_profile", "organization"], version: 3 }} userName="Katy Palmer" />);

    await userEvent.click(screen.getByRole("button", { name: /Skip for now/ }));
    expect(await screen.findByRole("heading", { name: "Connect the tools you use" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Skip for now/ }));

    expect(await screen.findByRole("heading", { name: "Your workspace is ready, Katy." })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(screen.getByRole("button", { name: /Enter workspace/ })).toBeEnabled());
  });

  it("keeps the local visual preview interactive without writing to a fixture workspace", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<OnboardingFlow initialData={structuredClone(companyProfileFixture)} initialOnboarding={{ status: "not_started", currentStep: "workspace_profile", completedSteps: [], version: 1 }} isPreview userName="Katy Palmer" />);

    await user.click(screen.getByRole("button", { name: /Save and continue/ }));
    expect(await screen.findByRole("heading", { name: "Set your workspace defaults" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Save and continue/ }));
    expect(await screen.findByRole("heading", { name: "Seats & people" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Skip for now/ }));
    expect(await screen.findByRole("heading", { name: "Connect the tools you use" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Skip for now/ }));

    expect(await screen.findByRole("heading", { name: "Your workspace is ready, Katy." })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders one complete set of company and regional controls", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const user = userEvent.setup();
    render(<OnboardingFlow initialData={structuredClone(companyProfileFixture)} initialOnboarding={{ status: "not_started", currentStep: "workspace_profile", completedSteps: [], version: 1 }} isPreview userName="Katy Palmer" />);

    expect(screen.getByRole("textbox", { name: "Company display name" })).toBeRequired();
    expect(screen.getByRole("textbox", { name: "Registered company name" })).toBeRequired();
    expect(screen.getByRole("combobox", { name: "Country / region" })).toBeRequired();
    expect(screen.getByRole("button", { name: "Upload logo" })).toBeEnabled();
    expect(screen.getByLabelText("Choose company logo")).toHaveAttribute("accept", "image/png,image/jpeg,image/webp");
    expect(screen.queryByText("Workspace accent")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Primary colour")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Save and continue/ }));

    expect(await screen.findByRole("combobox", { name: "Base currency" })).toBeRequired();
    expect(screen.getAllByRole("combobox", { name: "Time zone" })).toHaveLength(1);
    expect(screen.getByRole("combobox", { name: "Time zone" })).toBeRequired();
    expect(screen.getByText("Number & date format")).toBeInTheDocument();
    expect(screen.getByText("Measurement system")).toBeInTheDocument();
    expect(screen.getByText("Week starts on")).toBeInTheDocument();
  });

  it("uploads and activates a company logo during onboarding", async () => {
    const assetId = "00000000-0000-4000-8000-000000000099";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ assetId, uploadMode: "application", uploadUrl: null, uploadHeaders: { "content-type": "image/png" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ uploaded: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ assetId, logoUrl: "/api/auth/tenant-logo/iglo-architects?v=logo", updatedAt: "2026-09-16T01:00:00.000Z" }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<OnboardingFlow initialData={structuredClone(companyProfileFixture)} initialOnboarding={{ status: "not_started", currentStep: "workspace_profile", completedSteps: [], version: 1 }} userName="Katy Palmer" />);

    await user.upload(screen.getByLabelText("Choose company logo"), new File(["logo"], "palm-living.png", { type: "image/png" }));

    expect(await screen.findByText("Company logo saved")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Iglo Architects logo" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspace/company-profile/logo-uploads");
    expect(String(fetchMock.mock.calls[1][0])).toContain(`/logo-uploads/${assetId}/content`);
    expect(String(fetchMock.mock.calls[2][0])).toContain(`/logo-uploads/${assetId}/complete`);
  });

  it("keeps preview logo changes local and rejects unsupported files", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<OnboardingFlow initialData={structuredClone(companyProfileFixture)} initialOnboarding={{ status: "not_started", currentStep: "workspace_profile", completedSteps: [], version: 1 }} isPreview userName="Katy Palmer" />);
    const input = screen.getByLabelText("Choose company logo");

    fireEvent.change(input, { target: { files: [new File(["not-an-image"], "logo.txt", { type: "text/plain" })] } });
    expect(screen.getByRole("alert")).toHaveTextContent("PNG, JPEG, or WebP");
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { files: [new File([], "empty.png", { type: "image/png" })] } });
    expect(screen.getByRole("alert")).toHaveTextContent("not empty");
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { files: [new File(["logo"], "logo.webp", { type: "image/webp" })] } });
    expect(await screen.findByText("Company logo ready")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Iglo Architects logo" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByRole("img", { name: "Iglo Architects logo" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
