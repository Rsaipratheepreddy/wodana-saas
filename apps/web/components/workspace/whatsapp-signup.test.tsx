import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
