import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { companyProfileFixture } from "@/lib/workspace/company-profile";
import { OnboardingFlow } from "./onboarding-flow";

afterEach(() => vi.unstubAllGlobals());

describe("OnboardingFlow", () => {
  it("saves the required company step and advances resumable progress", async () => {
    const updatedWorkspace = { ...companyProfileFixture.workspace, version: 2 };
    const updatedEntity = { ...companyProfileFixture.legalEntities[0], version: 2 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workspace: updatedWorkspace, legalEntity: updatedEntity }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "in_progress", currentStep: "organization", completedSteps: ["workspace_profile"], version: 2 }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<OnboardingFlow initialData={structuredClone(companyProfileFixture)} initialOnboarding={{ status: "not_started", currentStep: "workspace_profile", completedSteps: [], version: 1 }} userName="Katy Palmer" />);

    expect(screen.getByRole("heading", { name: "Tell us about your company" })).toBeInTheDocument();
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

    await userEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(await screen.findByRole("heading", { name: "Connect the tools you use" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Finish setup/ }));

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
    expect(await screen.findByRole("heading", { name: "Bring your team with you" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    expect(await screen.findByRole("heading", { name: "Connect the tools you use" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Finish setup/ }));

    expect(await screen.findByRole("heading", { name: "Your workspace is ready, Katy." })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
