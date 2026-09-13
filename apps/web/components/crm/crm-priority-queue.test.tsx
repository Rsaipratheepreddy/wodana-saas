import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { RecordData } from "@/lib/crm/client";
import { CrmPriorityQueue } from "./crm-priority-queue";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const recordId = "78000000-0000-4000-8000-000000000001";
const partyId = "71000000-0000-4000-8000-000000000001";
const kinds = ["overdue_activity", "customer_reply", "sla_breach", "due_today", "meeting_preparation", "stale_lead", "stale_opportunity"];
const items: RecordData[] = kinds.map((kind, index) => ({ id: `${kind}-${index}`, recordId, kind, title: `Follow-up ${index + 1}`, reason: `Reason ${index + 1}`, partyName: `Client ${index + 1}`, partyLifecycle: "customer", resolvedPartyId: partyId, canViewParty: true, dueAt: "2026-09-06T10:00:00Z", deepLink: `/crm/activities/${recordId}` }));
function queue(data = items, total = data.length) { render(<DesignSystemProvider><CrmPriorityQueue items={data} total={total} /></DesignSystemProvider>); }
beforeEach(() => push.mockReset());

describe("CRM priority queue", () => {
  it("shows a compact five-row preview and expands the actual filtered queue", async () => {
    const user = userEvent.setup(); queue();
    expect(within(screen.getByRole("table", { name: "Client priorities" })).getAllByRole("row")).toHaveLength(6);
    expect(screen.getByRole("img", { name: "Client 1" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "View all (7)" }));
    expect(screen.getAllByRole("row")).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("tab", { name: "Replies (1)" }));
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("Reply needed")).toBeVisible();
    expect(screen.getByText("Received")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Today & meetings (2)" }));
    expect(screen.getByText("Due today")).toBeVisible();
    expect(screen.getByText("Upcoming")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Needs attention (4)" }));
    expect(screen.getAllByRole("row")).toHaveLength(5);
  });

  it("opens the linked record and permitted client profile from real menu actions", async () => {
    const user = userEvent.setup(); queue([items[0]]);
    await user.click(screen.getByRole("button", { name: /Actions for Client 1/ }));
    await user.click(screen.getByRole("menuitem", { name: "Open follow-up" }));
    expect(push).toHaveBeenLastCalledWith(`/workspace/crm/follow-ups?record=${recordId}`);
    await user.click(screen.getByRole("button", { name: /Actions for Client 1/ }));
    await user.click(screen.getByRole("menuitem", { name: "View client profile" }));
    expect(push).toHaveBeenLastCalledWith(`/workspace/crm/customers?record=${partyId}`);
  });

  it("does not invent clients, dates, or access for incomplete records", async () => {
    const user = userEvent.setup(); queue([{ ...items[0], partyName: null, canViewParty: false, dueAt: "invalid" }], 250);
    expect(screen.getByText("Client not linked")).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Not scheduled")).toBeVisible();
    expect(screen.getByText(/highest-priority items of 250/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Actions for Client not linked/ }));
    expect(screen.queryByRole("menuitem", { name: "View client profile" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("tab", { name: "Replies (0)" }));
    expect(screen.getByRole("heading", { name: "You’re caught up in this view" })).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
