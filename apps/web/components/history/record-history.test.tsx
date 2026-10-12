import { fireEvent, render, screen, within } from "@testing-library/react";
import type { HistoryItem, HistoryPage } from "@wodana/contracts/history";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { RecordHistory } from "./record-history";

const person = (name: string, id: string) => ({ id, name, roles: ["sales"], preset: null, kind: "person" as const });
const item = (over: Partial<HistoryItem>): HistoryItem => ({
  id: crypto.randomUUID(), occurredAt: new Date().toISOString(), verb: "sent", category: "change", subject: "quotation", reference: "Q-0012 V2",
  actor: person("Sara", "u1"), amount: null, note: null, to: null, changes: [], links: [], ...over,
});
const day = 86_400_000;

describe("the shared History of a record", () => {
  it("groups by day, names who did what, shows changes, notes and related links, and filters", async () => {
    const pages: Record<string, HistoryPage> = {
      all: { timeZone: "Asia/Dubai", next: "2026-10-01T00:00:00.000Z|00000000-0000-4000-8000-000000000000", items: [
        item({ to: "Aisha Rahman" }),
        item({ verb: "advanced", subject: "opportunity", reference: "O-0009", changes: [{ field: "probability", before: "35.00", after: "50.00" }],
          links: [{ type: "project", id: "11111111-1111-4111-8111-111111111111" }] }),
        item({ verb: "verified", subject: "payment", reference: null, category: "approval", occurredAt: new Date(Date.now() - 3 * day).toISOString(), actor: person("Layla", "u2"),
          amount: { value: "15000.00", currency: "AED" }, note: "Bank transfer TRX-104857" }),
      ] },
      approvals: { timeZone: "Asia/Dubai", next: null, items: [item({ verb: "approved", category: "approval", subject: "purchase_order", reference: "PO-2026-00011" })] },
      older: { timeZone: "Asia/Dubai", next: null, items: [item({ verb: "created", subject: "opportunity", reference: "O-0009", occurredAt: "2026-09-01T08:00:00.000Z" })] },
    };
    const load = vi.fn(async (_w: string, _type: string, _id: string, filter: string, before: string | null) => pages[before ? "older" : filter] ?? { timeZone: "UTC", next: null, items: [] });
    render(<DesignSystemProvider locale="en-GB"><RecordHistory load={load as never} recordId="22222222-2222-4222-8222-222222222222" recordType="opportunity" workspaceId="w" /></DesignSystemProvider>);

    const history = await screen.findByRole("region", { name: "History" });
    const today = within(history).getByRole("region", { name: "Today" });
    expect(within(today).getByText("Sara sent quotation Q-0012 V2 to Aisha Rahman")).toBeInTheDocument();
    expect(within(today).getByText("Sara moved opportunity O-0009 forward")).toBeInTheDocument();
    expect(within(today).getByText("Probability")).toBeInTheDocument();
    expect(within(today).getByRole("link", { name: "Open the project" })).toHaveAttribute("href", "/workspace/projects/11111111-1111-4111-8111-111111111111/overview");
    expect(within(history).getByText(/Layla verified the payment of AED\s?15,000\.00/)).toBeInTheDocument();
    expect(within(history).getByText("Bank transfer TRX-104857")).toBeInTheDocument();
    // Relative and exact time, in the workspace's zone.
    expect(history.querySelectorAll("time")).toHaveLength(3);
    expect(history.querySelector("time")?.getAttribute("title")).toMatch(/2026|20\d\d/);
    // No codes or ids on screen.
    expect(history.textContent).not.toMatch(/_|\.v1|22222222/);

    fireEvent.click(within(history).getByRole("button", { name: "Show older" }));
    expect(await within(history).findByText("Sara created opportunity O-0009")).toBeInTheDocument();

    fireEvent.click(within(history).getByRole("radio", { name: "Approvals" }));
    expect(await within(history).findByText("Sara approved purchase order PO-2026-00011")).toBeInTheDocument();
    expect(load).toHaveBeenLastCalledWith("w", "opportunity", "22222222-2222-4222-8222-222222222222", "approvals", null, expect.any(Function));
  });

  it("says when there is no history yet, and offers a retry when it fails", async () => {
    const empty = vi.fn(async () => ({ timeZone: "UTC", next: null, items: [] }));
    const { unmount } = render(<DesignSystemProvider><RecordHistory load={empty} recordId="r" recordType="project" workspaceId="w" /></DesignSystemProvider>);
    expect(await screen.findByText("No history yet")).toBeInTheDocument();
    unmount();
    const failing = vi.fn().mockRejectedValueOnce(new Error("The history didn't load.")).mockResolvedValue({ timeZone: "UTC", next: null, items: [item({})] });
    render(<DesignSystemProvider><RecordHistory load={failing} recordId="r" recordType="project" workspaceId="w" /></DesignSystemProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /Try again|Retry/ }));
    expect(await screen.findByText("Sara sent quotation Q-0012 V2")).toBeInTheDocument();
  });

  it("works right to left", async () => {
    const load = vi.fn(async () => ({ timeZone: "UTC", next: null, items: [item({ note: "تم إرسال العرض", changes: [{ field: "status", before: "draft", after: "issued" }] })] }));
    render(<div dir="rtl"><DesignSystemProvider><RecordHistory load={load} recordId="r" recordType="quotation" workspaceId="w" /></DesignSystemProvider></div>);
    const note = await screen.findByText("تم إرسال العرض");
    expect(note).toHaveAttribute("dir", "auto");
    expect(screen.getByText("Draft").tagName).toBe("BDI");
  });
});
