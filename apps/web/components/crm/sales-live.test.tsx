import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { leadsPageFixture, type CrmLeadListItem, type LeadsPageData } from "@/lib/crm/leads";
import { LeadsPage } from "./leads-page";
import { LogContactDialog } from "./log-contact-dialog";

vi.mock("next/font/google", () => ({ Caveat: () => ({ variable: "note-font" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const NOW = new Date("2026-10-03T06:00:00.000Z");
function lead(overrides: Partial<CrmLeadListItem>): CrmLeadListItem {
  return { ...structuredClone(leadsPageFixture.items[0]), status: "new", isConverted: false, ...overrides };
}
function page(items: CrmLeadListItem[]): LeadsPageData {
  return { ...structuredClone(leadsPageFixture), referenceTime: NOW.toISOString(), items, currentRoles: ["owner"], nextCursor: null };
}

describe("Sales in real time", () => {
  it("shows when to respond in the row, most urgent first, with attempts and review flags (S-6)", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const late = lead({ id: "62000000-0000-4000-8000-0000000000a1", partyName: "Late Lina", slaStatus: "breached", slaDueAt: "2026-10-03T05:30:00.000Z", slaWarningAt: "2026-10-03T05:00:00.000Z", ownerMembershipId: null, ownerName: null });
    const soon = lead({ id: "62000000-0000-4000-8000-0000000000a2", partyName: "Soon Sami", slaStatus: "active", slaDueAt: "2026-10-03T06:42:00.000Z", slaWarningAt: "2026-10-03T06:30:00.000Z", contactAttempts: 2, clientMatches: 1 });
    const calm = lead({ id: "62000000-0000-4000-8000-0000000000a3", partyName: "Calm Carla", slaStatus: null, slaDueAt: null, slaWarningAt: null });
    render(<LeadsPage initialData={page([calm, soon, late])} />);
    const lists = screen.getByRole("group", { name: "Enquiry lists" });
    act(() => { within(lists).getByRole("button", { name: /^New/ }).click(); });
    const rows = within(screen.getByRole("table", { name: "CRM enquiries" })).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining("Late Lina"), expect.stringContaining("Soon Sami"), expect.stringContaining("Calm Carla")]);
    // Under the "Respond by" column the chip shows the time left; the full deadline is its tooltip.
    expect(rows[0]).toHaveTextContent("30 min overdue");
    expect(rows[0].querySelector("[data-chip][title]")).toHaveAttribute("title", expect.stringMatching(/^Respond by .* 30 min overdue$/));
    expect(rows[1]).toHaveTextContent("42 min");
    expect(rows[1].querySelector("[data-chip][title]")).toHaveAttribute("title", expect.stringMatching(/^Respond by .* 42 min$/));
    expect(rows[1]).toHaveTextContent("Attempt 2");
    expect(rows[1]).toHaveTextContent("Confirm client");
    expect(within(lists).getByRole("button", { name: /Needs review/ })).toBeInTheDocument();
    // A manager sees the enquiries nobody owns (S-2).
    expect(screen.getByText("1 enquiry has no owner")).toBeVisible();
  });

  it("refreshes itself while on screen: rows change in place and new ones wait behind a button (S-5)", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    const first = lead({ id: "62000000-0000-4000-8000-0000000000b1", partyName: "Nadia", version: 1, ownerName: "Sara" });
    const moved = { ...first, version: 2, ownerName: "Zaid", ownerMembershipId: leadsPageFixture.members[0].id };
    const arrived = lead({ id: "62000000-0000-4000-8000-0000000000b2", partyName: "Walk-in Waleed", version: 1 });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: [arrived, moved], nextCursor: null }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LeadsPage initialData={page([first])} />);
    expect(screen.queryByText("Walk-in Waleed")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Zaid")).toBeInTheDocument();
    expect(screen.queryByText("Walk-in Waleed")).toBeNull();
    act(() => { screen.getByRole("button", { name: "1 new enquiry · Show" }).click(); });
    expect(screen.getByText("Walk-in Waleed")).toBeInTheDocument();
  });
});

describe("Log contact (S-16)", () => {
  const policies = [{ id: "sla", name: "First response", eventType: "first_response", warningAfterMinutes: 30, breachAfterMinutes: 60, calculationMode: "business" as const, status: "active", version: 1,
    schedule: { mode: "business", timezone: "Asia/Dubai", holidays: [], dateOverrides: {}, weeklyHours: Object.fromEntries(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map((day) => [day, [{ start: "09:00", end: "18:00" }]])) } }];

  it("logs a try that reached nobody in one tap, with the next working slot suggested", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-03T13:30:00.000Z"), toFake: ["Date"] }); // Sat 17:30 in Dubai
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ status: "attempting_contact", version: 4, nextActionAt: "2026-10-04T05:00:00.000Z", contactAttempts: 3 }) }));
    vi.stubGlobal("fetch", fetchMock);
    const onLogged = vi.fn();
    const user = userEvent.setup();
    render(<DesignSystemProvider timeZone="Asia/Dubai"><LogContactDialog workspaceId={leadsPageFixture.workspaceId} lead={{ id: "lead-1", version: 3, name: "Asha" }} slaPolicies={policies} onClose={vi.fn()} onLogged={onLogged} /></DesignSystemProvider>);
    await user.click(screen.getByRole("radio", { name: "No answer" }));
    expect(screen.getByRole("textbox", { name: /Note/ })).not.toBeRequired();
    // In 2 h would be after hours: the next working morning, which the Next working day chip already offers (m8).
    expect(screen.getByRole("button", { name: /Next working day · Sun 09:00/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /In 2 h/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /In 3 days/ }));
    await user.click(screen.getByRole("button", { name: "Log contact" }));
    await waitFor(() => expect(onLogged).toHaveBeenCalledWith(expect.objectContaining({ contactAttempts: 3 }), "no_answer"));
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ outcome: "no_answer", note: "", nextActionAt: "2026-10-06T05:00:00.000Z" });
  });

  it("offers In 2 h only when it really is two hours from now (m8)", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-03T07:00:00.000Z"), toFake: ["Date"] }); // Sat 11:00 in Dubai
    vi.stubGlobal("fetch", vi.fn());
    const user = userEvent.setup();
    render(<DesignSystemProvider timeZone="Asia/Dubai"><LogContactDialog workspaceId={leadsPageFixture.workspaceId} lead={{ id: "lead-1", version: 3, name: "Asha" }} slaPolicies={policies} onClose={vi.fn()} onLogged={vi.fn()} /></DesignSystemProvider>);
    await user.click(screen.getByRole("radio", { name: "No answer" }));
    expect(screen.getByRole("button", { name: /In 2 h · 13:00/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Next working day · Sun 09:00/ })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("still needs a note when the client was reached", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const user = userEvent.setup();
    render(<DesignSystemProvider timeZone="Asia/Dubai"><LogContactDialog workspaceId={leadsPageFixture.workspaceId} lead={{ id: "lead-1", version: 3, name: "Asha" }} onClose={vi.fn()} onLogged={vi.fn()} /></DesignSystemProvider>);
    await user.click(screen.getByRole("radio", { name: "Willing to talk" }));
    await user.click(screen.getByRole("button", { name: "Log contact" }));
    expect(await screen.findByText("Add a note about this contact.")).toBeVisible();
  });
});
