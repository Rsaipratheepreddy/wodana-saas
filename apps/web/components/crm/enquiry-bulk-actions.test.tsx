import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { leadsPageFixture } from "@/lib/crm/leads";
import { bulkRequest, EnquiryBulkDialog } from "./enquiry-bulk-actions";

afterEach(() => vi.unstubAllGlobals());

const data = structuredClone(leadsPageFixture);
const open = data.items.slice(0, 2).map((lead, index) => ({ ...lead, id: `lead-${index}`, partyName: `Client ${index}`, status: "new" as const, isConverted: false, version: 3 }));

describe("bulk actions on Enquiries (S-17)", () => {
  it("sends each enquiry its own command, with its own version", () => {
    expect(bulkRequest("assign", open[0], { owner: "m1" })).toEqual(["leads/lead-0/assign", { version: 3, ownerMembershipId: "m1", reason: "Reassigned in bulk" }]);
    expect(bulkRequest("close", open[0], { reason: "Spam" })).toEqual(["leads/lead-0/status", { version: 3, status: "disqualified", reason: "Spam" }]);
    expect(bulkRequest("follow_up", open[1], { title: "Call back", dueAt: "2026-10-01T06:00:00.000Z" })[1]).toMatchObject({ leadId: "lead-1", type: "task", title: "Call back", isNextAction: true });
  });

  it("closes the selected enquiries, tells which were refused and why, and keeps the rest done", async () => {
    const fetcher = vi.fn(async (url: string) => url.includes("lead-1")
      ? { ok: false, status: 403, json: async () => ({ message: "You can't change an enquiry you don't own." }) }
      : { ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetcher);
    const onDone = vi.fn(async () => undefined);
    render(<DesignSystemProvider><EnquiryBulkDialog mode="close" rows={open} initialData={data} onClose={vi.fn()} onDone={onDone} /></DesignSystemProvider>);
    expect(screen.getByRole("dialog", { name: "Close 2 enquiries" })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: /Why they're closed/ }), "Duplicate spam");
    await userEvent.click(screen.getByRole("button", { name: "Apply to 2" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("1 done · 1 not changed"));
    expect(screen.getByText(/Client 1/)).toBeInTheDocument();
    expect(screen.getByText(/you don't own/)).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reads one enquiry as one (m4)", () => {
    render(<DesignSystemProvider><EnquiryBulkDialog mode="follow_up" rows={open.slice(0, 1)} initialData={data} onClose={vi.fn()} onDone={vi.fn()} /></DesignSystemProvider>);
    expect(screen.getByRole("dialog", { name: "Add a follow-up to 1 enquiry" })).toBeInTheDocument();
  });
});
