import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReceivablesApi } from "@/lib/receivables/client";
import type { ReceivablesState } from "@/lib/receivables/types";
import { ClientInvoices } from "./client-invoices";

const CASE = "11111111-1111-4111-8111-111111111111";

function state(): ReceivablesState {
  return {
    canManage: true,
    toInvoice: [{ projectId: "p", projectReference: "PRJ-1", projectName: "Villa", caseId: CASE, paymentId: "p2", title: "Before production", amount: "3925.0000", currency: "USD", dueDate: "2026-09-20", clientName: "Maya", paid: "0.0000", lastReminder: { on: "2026-09-25", channel: "whatsapp" } }],
    invoices: [],
  };
}

describe("client invoices: payment reminders", () => {
  it("shows when the client was last reminded and sends a reminder for what's still owed", async () => {
    const user = userEvent.setup();
    const remind = vi.fn(async () => ({ sent: true, already: false, channel: "email" as const, sentOn: "2026-09-28" }));
    const api = { state: vi.fn(async () => state()), remind } as unknown as ReceivablesApi;
    render(<ClientInvoices api={api} openId={null} onOpen={() => undefined} />);
    const row = (await screen.findByText("Before production")).closest("tr, [role='row']") as HTMLElement;
    expect(within(row).getByText("WhatsApp")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Send reminder" }));
    await waitFor(() => expect(remind).toHaveBeenCalledWith(CASE, "p2"));
    expect(await screen.findByText("Reminder sent by email.")).toBeInTheDocument();
  });
});
