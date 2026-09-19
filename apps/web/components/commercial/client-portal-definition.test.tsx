import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientPortal } from "./client-portal";
import type { PortalSettings } from "@/lib/commercial/types";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/commercial/client", async () => ({ ...await vi.importActual("@/lib/commercial/client"), jsonRequest: request }));
const settings = { slug: "local", brand: { name: "Studio", primaryColor: "#333333", accentColor: "#888888" }, testMode: true } as PortalSettings;
const definition = { id: "baseline", number: 2, status: "awaiting_confirmation", current: true, canDecide: true, decision: null,
  snapshot: { definition: { brief: { goals: "Refresh the living room" }, rooms: [], items: [{ id: "item", title: "Built-in cabinet", roomName: "Living room", scopeStatus: "included", quantity: 1, unit: "nos", specification: { refinedRequirement: "Soft-close doors", inclusions: "Installation", exclusions: "Appliances", materials: [] } }] } } };
const data = { name: "Client", phone: "+971555555555", cases: [{ id: "case", title: "Villa", role: "approver", quotes: [], requests: [], payments: [], designs: [], definitionBaseline: definition }] };
afterEach(() => request.mockReset());

describe("client scope confirmation", () => {
  it("shows the exact shared version and sends an OTP-bound decision", async () => {
    request.mockImplementation(async (url: string) => url.endsWith("/challenge") ? { challengeId: "otp", resendAfter: 60 } : url.endsWith("/action") ? { ok: true } : data);
    const user = userEvent.setup();
    render(<ClientPortal settings={settings} />);
    await user.click(await screen.findByRole("button", { name: /^Approvals/ }));
    await user.click(screen.getByRole("button", { name: "Review scope" }));
    expect(screen.getByRole("heading", { name: "Scope definition · V2" })).toBeVisible();
    expect(screen.getByText("Soft-close doors")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Confirm scope" }));
    await user.click(screen.getByRole("button", { name: "Continue to verification" }));
    await user.type(await screen.findByLabelText("Confirm with the six-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm acceptance" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/client-portal/local/action", "POST", expect.objectContaining({ action: "definition-decision", caseId: "case", baselineId: "baseline", decision: "accept", challengeId: "otp", code: "123456" })));
    expect(request).toHaveBeenCalledWith("/api/client-portal/local/challenge", "POST", { phone: data.phone, purpose: "definition-decision:case:baseline:accept" });
  });

  it("requires remarks for requested changes and never offers decisions to viewers", async () => {
    request.mockResolvedValue(data);
    const user = userEvent.setup();
    const view = render(<ClientPortal settings={settings} />);
    await user.click(await screen.findByRole("button", { name: /^Approvals/ }));
    await user.click(screen.getByRole("button", { name: "Review scope" }));
    await user.click(screen.getByRole("button", { name: "Request changes" }));
    expect(screen.getByRole("button", { name: "Continue to verification" })).toBeDisabled();
    await user.type(screen.getByLabelText("Remarks"), "Please replace the cabinet finish.");
    expect(screen.getByRole("button", { name: "Continue to verification" })).toBeEnabled();
    view.unmount();
    request.mockResolvedValue({ ...data, cases: [{ ...data.cases[0], role: "viewer", definitionBaseline: { ...definition, canDecide: false } }] });
    render(<ClientPortal settings={settings} />);
    await user.click(await screen.findByRole("button", { name: /^Approvals/ }));
    await user.click(screen.getByRole("button", { name: "View scope" }));
    expect(screen.queryByRole("button", { name: "Confirm scope" })).not.toBeInTheDocument();
  });
});
