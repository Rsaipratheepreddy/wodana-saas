import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { LedgerAttention, type LedgerAttentionApi, type LedgerIssue } from "./attention";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/workspace/ledger/attention", useSearchParams: () => new URLSearchParams() }));

const issue = (patch: Partial<LedgerIssue> = {}): LedgerIssue => ({
  id: "i1", legalEntityId: "e1", companyName: "Studio Interiors LLC", sourceType: "supplier_bill", sourceId: "b1", sourceEvent: "approved", sourceLabel: "Timber Co TC-101",
  sourceHref: "/workspace/finance/bills?bill=b1", eventDate: "2026-10-08", code: "unknown_tax", detail: "Delivery to site: tax of 10 has no tax code.", attempts: 3,
  firstSeenAt: "2026-10-08T08:00:00Z", lastSeenAt: "2026-10-08T09:00:00Z", ...patch,
});

describe("Ledger attention", () => {
  it("lists what couldn't post, links each record, and tries one again", async () => {
    const api: LedgerAttentionApi = {
      issues: vi.fn(async () => ({ issues: [issue()], canRetry: true })),
      retry: vi.fn(async () => ({ issues: [], canRetry: true })),
    };
    render(<DesignSystemProvider><LedgerAttention workspaceId="w1" api={api} /></DesignSystemProvider>);
    expect(await screen.findByRole("link", { name: "Timber Co TC-101" })).toHaveAttribute("href", "/workspace/finance/bills?bill=b1");
    expect(screen.getByText("Tax code missing")).toBeInTheDocument();
    expect(screen.getByText("Supplier invoice")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(api.retry).toHaveBeenCalledWith("i1");
    await waitFor(() => expect(screen.getByText("Everything is posted")).toBeInTheDocument());
  });

  it("offers no retry to people who only view the Ledger", async () => {
    const api: LedgerAttentionApi = { issues: vi.fn(async () => ({ issues: [issue({ code: "external_invoice" })], canRetry: false })), retry: vi.fn() };
    render(<DesignSystemProvider><LedgerAttention workspaceId="w1" api={api} /></DesignSystemProvider>);
    expect(await screen.findByText("Invoiced elsewhere")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
