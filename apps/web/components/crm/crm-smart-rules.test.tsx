import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrmSmartRules, DELIVERY_RULES } from "./crm-smart-rules";

const data = {
  canView: true,
  id: "automations" as const,
  items: [
    { id: "enquiry_ownership", code: "enquiry_ownership", name: "New enquiry ownership", description: "Assign every new enquiry.", setupHref: "/workspace/crm/leads?section=assignment", availableChannels: ["in_app"], enabled: true, status: "active", version: 1, channels: ["in_app"], weekday: "friday" },
    { id: "approval_reminders", code: "approval_reminders", name: "Approval reminders", description: "Remind whoever decides.", setupHref: "/workspace/approvals", availableChannels: ["in_app", "email"], enabled: true, status: "active", version: 0, channels: ["in_app"], weekday: "friday", remindAfterHours: 24, escalateAfterHours: 48 },
    { id: "weekly_progress", code: "weekly_progress", name: "Weekly project progress", description: "Send the project team a summary.", setupHref: "/workspace/projects", availableChannels: ["in_app", "email"], enabled: false, status: "not_configured", version: 0, channels: ["in_app"], weekday: "friday" },
  ],
  nextCursor: null,
  referenceTime: "2026-09-18T10:00:00.000Z",
  supporting: {
    providers: [
      { channel: "in_app", connected: true, delivered: 2, failed: 0, lastDeliveredAt: null, pricing: "Included with Wodana", receiptState: "built_in" },
      { channel: "email", connected: true, delivered: 0, failed: 0, lastDeliveredAt: null, pricing: "Your email provider plan applies", receiptState: "awaiting_test_receipt" },
    ],
  },
  workspaceId: "d004d45c-7140-4b0c-a68d-e87d012c2390",
};

afterEach(() => vi.unstubAllGlobals());

describe("CRM smart rules", () => {
  it("shows only the Sales rules in Sales, and the delivery reminders in Settings", () => {
    const { unmount } = render(<CrmSmartRules initialData={data} />);
    expect(screen.getByRole("switch", { name: "Turn off New enquiry ownership" })).toBeChecked();
    expect(screen.queryByText("Weekly project progress")).not.toBeInTheDocument();
    unmount();
    render(<CrmSmartRules initialData={data} codes={DELIVERY_RULES} title="Reminders" />);
    expect(screen.getByText("Weekly project progress")).toBeInTheDocument();
    expect(screen.queryByText("New enquiry ownership")).not.toBeInTheDocument();
  });

  it("saves a weekly rule without exposing workflow internals", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "active" }) });
    vi.stubGlobal("fetch", fetcher);
    render(<CrmSmartRules initialData={data} codes={DELIVERY_RULES} />);

    await user.click(screen.getByRole("switch", { name: "Turn on Weekly project progress" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    const [url, request] = fetcher.mock.calls[0];
    expect(String(url)).toContain("automation-presets/weekly_progress");
    expect(request.method).toBe("PATCH");
    expect(JSON.parse(String(request.body))).toMatchObject({ enabled: true, channels: ["in_app"], weekday: "friday" });
    expect(screen.queryByText(/trigger|node|run history/i)).not.toBeInTheDocument();
  });

  it("sets when approvals are chased: the approver, then the owners (AU-3)", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "active" }) });
    vi.stubGlobal("fetch", fetcher);
    render(<CrmSmartRules initialData={data} codes={DELIVERY_RULES} />);
    await user.click(screen.getByRole("button", { name: /Remind after/ }));
    await user.click(await screen.findByRole("option", { name: "72 hours" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    const [url, request] = fetcher.mock.calls[0];
    expect(String(url)).toContain("automation-presets/approval_reminders");
    // The owners are never told before the approver is reminded.
    expect(JSON.parse(String(request.body))).toMatchObject({ enabled: true, remindAfterHours: 72, escalateAfterHours: 72 });
  });
});
