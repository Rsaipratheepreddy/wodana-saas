import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crmRequest } from "@/lib/crm/client";
import { CrmCalendar } from "./crm-calendar";

vi.mock("@/lib/crm/client", async (original) => ({ ...await original<object>(), crmRequest: vi.fn() }));
const workspaceId = "00000000-0000-4000-8000-000000000001";
const partyId = "00000000-0000-4000-8000-000000000002";
const managerId = "00000000-0000-4000-8000-000000000003";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  vi.mocked(crmRequest).mockImplementation(async (_workspace, path, method) => {
    if (method === "POST") return { id: "created-meeting" };
    if (path.startsWith("parties")) return { data: [{ id: partyId, displayName: "Calendar customer" }] };
    if (path === "members") return [{ id: managerId, displayName: "Iglo Manager", status: "active" }];
    return { data: [
      { id: "pending", title: "Design consultation", dueAt: new Date().toISOString(), status: "pending" },
      { id: "cancelled", title: "Cancelled consultation", dueAt: new Date().toISOString(), status: "cancelled" },
    ], nextCursor: null };
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("CRM calendar", () => {
  it("does not serialize server-local dates into the user's calendar", () => {
    const html = renderToString(<CrmCalendar workspaceId={workspaceId} />);
    expect(html).toContain("Loading your local calendar");
    expect(html).not.toContain("Schedule on");
  });

  it("keeps search and a compact date navigator alongside the time grid", async () => {
    render(<CrmCalendar workspaceId={workspaceId} />);
    expect(await screen.findByRole("textbox", { name: "Search calendar" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Date navigator" })).toBeInTheDocument();
    expect(screen.queryByText("My calendars")).not.toBeInTheDocument();
    expect(screen.queryByText("CRM commitments")).not.toBeInTheDocument();
    expect(screen.queryByText("Manage connections")).not.toBeInTheDocument();
  });

  it("shows real activities, excludes cancellations and supports the day/search view", async () => {
    const user = userEvent.setup(); render(<CrmCalendar workspaceId={workspaceId} />);
    expect(await screen.findByRole("button", { name: /CRM Design consultation/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancelled consultation/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Day" }));
    expect(screen.getByRole("group", { name: "Day calendar" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Search calendar" }), "No match");
    expect(screen.queryByRole("button", { name: /CRM Design consultation/ })).not.toBeInTheDocument();
  });

  it("saves the activity and appointment through one atomic command, not a Google send", async () => {
    const user = userEvent.setup(); render(<CrmCalendar workspaceId={workspaceId} />);
    await user.click(screen.getByRole("button", { name: "Schedule meeting" }));
    const dialog = await screen.findByRole("dialog", { name: "Schedule CRM meeting" });
    await user.type(within(dialog).getByRole("textbox", { name: /Meeting title/ }), "Site visit");
    await user.click(within(dialog).getByRole("button", { name: /Customer/ }));
    await user.click(await screen.findByRole("option", { name: "Calendar customer" }));
    await user.click(within(dialog).getByRole("button", { name: /Lead manager/ }));
    await user.click(await screen.findByRole("option", { name: "Iglo Manager" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(vi.mocked(crmRequest).mock.calls.filter((call) => call[2] === "POST")).toHaveLength(1));
    const call = vi.mocked(crmRequest).mock.calls.find((item) => item[2] === "POST")!;
    expect(call.slice(0, 3)).toEqual([workspaceId, "activities", "POST"]);
    expect(call[3]).toMatchObject({ title: "Site visit", type: "meeting", partyId, ownerMembershipId: managerId, appointment: { timezone: expect.any(String) } });
    const body = call[3] as { dueAt: string; appointment: { startsAt: string; endsAt: string } };
    expect(body.dueAt).toBe(body.appointment.startsAt);
    expect(Date.parse(body.appointment.endsAt) - Date.parse(body.appointment.startsAt)).toBe(3600000);
    expect(vi.mocked(fetch).mock.calls.every((item) => String(item[0]).startsWith("/api/workspace/integration-connections?"))).toBe(true);
  });

  it("shows a fetch error instead of presenting it as an empty calendar", async () => {
    vi.mocked(crmRequest).mockRejectedValue(new Error("Access denied"));
    render(<CrmCalendar workspaceId={workspaceId} />);
    expect(await screen.findByText("Calendar could not load")).toBeInTheDocument();
    expect(screen.getByText("Access denied")).toBeInTheDocument();
  });

  it("opens notes and reschedules a follow-up even without a meeting appointment", async () => {
    const record = { id: "pending", title: "Call Maya", type: "call", status: "pending", dueAt: new Date().toISOString(), description: "Discuss the quote", version: 2 };
    vi.mocked(crmRequest).mockImplementation(async (_workspace, path, method, body) => {
      if (method === "PATCH") return { ...record, ...body as object, version: 3 };
      if (path === "activities/pending") return record;
      return { data: [record], nextCursor: null };
    });
    const user = userEvent.setup(); render(<CrmCalendar workspaceId={workspaceId} />);
    await user.click(await screen.findByRole("button", { name: /CRM Call Maya/ }));
    const notes = await screen.findByRole("textbox", { name: "Notes" });
    expect(notes).toHaveValue("Discuss the quote");
    await user.type(notes, ". Call tomorrow.");
    fireEvent.change(screen.getByLabelText("Reminder date"), { target: { value: "2026-09-09" } });
    fireEvent.change(screen.getByLabelText("Reminder time"), { target: { value: "11:00" } });
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved. Your reminder is updated in Overview and Calendar.");
    expect(vi.mocked(crmRequest)).toHaveBeenCalledWith(workspaceId, "activities/pending", "PATCH", expect.objectContaining({ version: 2, description: "Discuss the quote. Call tomorrow.", dueAt: new Date("2026-09-09T11:00").toISOString() }));
  });
});
