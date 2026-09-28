import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { WhatsAppSignup, isWhatsAppSetup } from "./whatsapp-signup";

afterEach(() => document.getElementById("wodana-meta-sdk")?.remove());
describe("WhatsApp tenant onboarding", () => {
  it("masks the optional registration PIN and does not accept malformed setup values", () => {
    const setup = { state: "a-state-value-longer-than-twenty-characters", appId: "123", configId: "456", version: "v23.0", connectionId: "connection" };
    render(<DesignSystemProvider><WhatsAppSignup setup={setup} workspaceId="workspace" onClose={() => {}} /></DesignSystemProvider>);
    expect(screen.getByLabelText("Registration PIN (only for a new Cloud API sender)")).toHaveAttribute("type", "password");
    expect(isWhatsAppSetup({ ...setup, mode: "embedded_signup" })).toBe(true);
    expect(isWhatsAppSetup({ ...setup, mode: "embedded_signup", appId: "not-an-app-id" })).toBe(false);
  });
  it("starts Meta's coexistence onboarding for a number already on the WhatsApp Business app", async () => {
    const setup = { state: "a-state-value-longer-than-twenty-characters", appId: "123", configId: "456", version: "v23.0", connectionId: "connection" };
    const login = vi.fn();
    window.FB = { init: vi.fn(), login } as never;
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, protocol: "https:" } });
    const user = userEvent.setup();
    render(<DesignSystemProvider><WhatsAppSignup setup={setup} workspaceId="workspace" onClose={() => {}} /></DesignSystemProvider>);
    await user.click(screen.getByRole("checkbox", { name: "I already use the WhatsApp Business app on this number" }));
    expect(screen.queryByLabelText("Registration PIN (only for a new Cloud API sender)")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue with Meta" }));
    expect(login.mock.calls[0][1]).toMatchObject({ extras: { featureType: "whatsapp_business_app_onboarding" } });
    Object.defineProperty(window, "location", { configurable: true, value: original });
    delete window.FB;
  });
});
