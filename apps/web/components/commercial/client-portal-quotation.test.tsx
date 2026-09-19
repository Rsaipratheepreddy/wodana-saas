import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortalSettings } from "@/lib/commercial/types";
import { ClientPortal } from "./client-portal";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/commercial/client", async () => ({
  ...(await vi.importActual("@/lib/commercial/client")),
  jsonRequest: request,
}));

const settings = {
  slug: "test",
  brand: { name: "Studio", primaryColor: "#333333", accentColor: "#777777" },
  testMode: true,
} as PortalSettings;
const quote = {
  id: "quote",
  number: 3,
  kind: "quotation",
  status: "issued",
  title: "Villa quotation",
  currency: "AED",
  validUntil: "2099-01-01",
  discount: 0,
  taxRate: 5,
  terms: "Terms",
  exclusions: "Exclusions",
  lines: [
    { id: "base", room: "Living room", title: "Base works", specification: "", material: "", finish: "", quantity: 1, unit: "item", rate: 100 },
    { id: "option", room: "Living room", title: "Premium lighting", specification: "", material: "", finish: "", quantity: 1, unit: "item", rate: 50, optional: true },
  ],
  requestIds: [],
  paymentTerms: [],
  createdAt: "2026-09-18",
  issuedAt: "2026-09-18",
  hash: "0123456789abcdef",
  total: 105,
  canDecide: true,
  expired: false,
};
const portalData = {
  name: "Client",
  phone: "+971555555555",
  cases: [{ id: "case", title: "Villa", customerName: "Client", role: "approver", quotes: [quote], requests: [], payments: [], designs: [], materials: [] }],
};

afterEach(() => request.mockReset());

describe("client quotation acceptance", () => {
  it("binds selected options and the accepted amount to the verified decision", async () => {
    request.mockImplementation(async (url: string) =>
      url.endsWith("/challenge")
        ? { challengeId: "otp", resendAfter: 60 }
        : url.endsWith("/action")
          ? { ok: true }
          : portalData,
    );
    const user = userEvent.setup();
    render(<ClientPortal settings={settings} />);
    await user.click(await screen.findByRole("button", { name: /^Approvals/ }));
    await user.click(screen.getByRole("button", { name: "Review quotation" }));
    await user.click(screen.getByRole("button", { name: "Accept quotation" }));
    expect(screen.getAllByText("AED 105.00").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("checkbox", { name: /Premium lighting/ }));
    expect(screen.getByText("AED 157.50")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Continue to verification" }));
    await user.type(await screen.findByLabelText("Confirm with the six-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm acceptance" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/api/client-portal/test/action",
        "POST",
        expect.objectContaining({
          action: "decision",
          caseId: "case",
          quoteId: "quote",
          decision: "accept",
          selectedOptionLineIds: ["option"],
          challengeId: "otp",
          code: "123456",
        }),
      ),
    );
  });

  it("labels an expired issued quotation and keeps it read-only", async () => {
    request.mockResolvedValue({
      ...portalData,
      cases: [{ ...portalData.cases[0], quotes: [{ ...quote, canDecide: false, expired: true, validUntil: "2026-01-01" }] }],
    });
    const user = userEvent.setup();
    render(<ClientPortal settings={settings} />);
    await user.click(await screen.findByRole("button", { name: /^Approvals/ }));
    expect(screen.getByText("Expired")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "View quotation" }));
    expect(screen.getByText(/expired on 2026-01-01/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Accept quotation" })).not.toBeInTheDocument();
  });
});
