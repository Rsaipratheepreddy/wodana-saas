import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { crmRequest } from "@/lib/crm/client";
import { crmScreenFixture } from "@/lib/crm/screens";
import { FollowUpTimeline, followUpDayRange } from "./follow-up-timeline";
import { FollowUpSheet, suggestedFollowUpTime } from "./follow-up-editor";
import { CrmFollowUps } from "./crm-follow-ups";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/crm/client", async original => ({ ...await original<object>(), crmRequest: vi.fn() }));
const api = vi.mocked(crmRequest);
const day = "2026-09-22";
const record = { id: "one", type: "call", title: "Discuss quote", status: "pending", dueAt: `${day}T18:00:00.000Z`, description: "Check oak finish", partyName: "Amira", version: 1 };
beforeEach(() => { vi.clearAllMocks(); });
describe("Follow-up timeline", () => {
  it("loads every page for the selected local day and opens a scheduled record", async () => {
    api.mockResolvedValueOnce({ data: [record], nextCursor: "page2" }).mockResolvedValueOnce({ data: [{ ...record, id: "two", title: "Second call" }], nextCursor: null });
    const open = vi.fn(); const create = vi.fn();
    render(<FollowUpTimeline workspaceId="ws" day={day} onDayChange={vi.fn()} now={Date.parse(record.dueAt)} revision={0} onCreate={create} onOpen={open} />);
    expect(screen.queryByRole("heading", { name: "Follow-ups" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview sample" })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /Discuss quote/ }));
    expect(open).toHaveBeenCalledWith(record);
    expect(screen.getByRole("button", { name: /Second call/ })).toBeInTheDocument();
    expect(api.mock.calls[0][1]).toContain(encodeURIComponent(followUpDayRange(day, "UTC").from));
    expect(api.mock.calls[1][1]).toContain("cursor=page2");
    await userEvent.click(screen.getByRole("button", { name: "Add follow-up at 18:00" }));
    expect(create).toHaveBeenCalledWith("18:00");
  });
  it("does not present a failed load as an empty schedule", async () => {
    api.mockRejectedValueOnce(new Error("Offline"));
    render(<FollowUpTimeline workspaceId="ws" day={day} onDayChange={vi.fn()} now={Date.now()} revision={0} onCreate={vi.fn()} onOpen={vi.fn()} />);
    expect(await screen.findByText("Offline")).toBeInTheDocument();
    expect(screen.queryByText("A little room for your next conversation")).not.toBeInTheDocument();
  });
  it("saves a time-slot follow-up and returns to its day with notes intact", async () => {
    let saved: object | undefined;
    api.mockImplementation(async (_ws, path, method, body) => {
      if (method === "POST") { saved = body as object; return { ...body as object, id: "created", status: "pending", version: 1 }; }
      if (path.startsWith("leads?")) return { data: [{ id: "lead1", partyName: "Amira", title: "Palm residence", status: "connected" }], nextCursor: null };
      if (path.startsWith("activities?")) return { data: saved ? [{ ...saved, id: "created", status: "pending" }] : [], nextCursor: null };
      return { data: [], nextCursor: null };
    });
    render(<CrmFollowUps initialData={{ ...crmScreenFixture("follow-ups"), workspaceId: "ws", items: [], referenceTime: `${day}T12:00:00.000Z` }} />);
    await userEvent.click(screen.getByRole("button", { name: "Add follow-up at 18:00" }));
    expect(screen.getByRole("spinbutton", { name: /hour,.*Reminder time/i })).toHaveAttribute("aria-valuenow", "6");
    const combo = screen.getByRole("combobox", { name: /Enquiry or customer/ });
    await waitFor(() => expect(combo).toBeEnabled());
    await userEvent.type(combo, "Amira");
    await userEvent.click(await screen.findByRole("option", { name: "Amira · Palm residence" }));
    expect(combo).toHaveValue("Amira · Palm residence");
    await userEvent.type(screen.getByRole("textbox", { name: "Follow-up title" }), "Call at 7 pm");
    await userEvent.click(screen.getByRole("button", { name: "Apply time" }));
    expect(screen.getByRole("spinbutton", { name: /hour,.*Reminder time/i })).toHaveAttribute("aria-valuenow", "7");
    expect(screen.getByRole("spinbutton", { name: /day,.*Reminder date/i })).toHaveAttribute("aria-valuenow", "22");
    await userEvent.type(screen.getByRole("textbox", { name: "Notes" }), "Discuss oak finish");
    await userEvent.click(screen.getByRole("button", { name: "Save reminder" }));
    expect(await screen.findByRole("button", { name: /Call at 7 pm/ })).toBeInTheDocument();
    expect(saved).toMatchObject({ dueAt: `${day}T19:00:00.000Z`, description: "Discuss oak finish", customerVisible: false });
  });
  it("keeps sample edits local, including completion in RTL", async () => {
    const saved = vi.fn(); const close = vi.fn();
    render(<div dir="rtl"><FollowUpSheet inline sample workspaceId="ws" recordId="one" summary={record} onSaved={saved} onClose={close} /></div>);
    await userEvent.type(screen.getByRole("textbox", { name: "Notes" }), " Call at 6 pm.");
    await userEvent.click(screen.getByRole("button", { name: "Save & complete" }));
    expect(saved).toHaveBeenLastCalledWith(expect.objectContaining({ status: "completed", description: "Check oak finish Call at 6 pm." }));
    expect(api).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
  it("requires explicit AM/PM and rejects invalid title times", () => {
    expect(suggestedFollowUpTime("I will talk at 6")).toBeNull();
    expect(suggestedFollowUpTime("Call at 6 pm")).toBe("18:00");
    expect(suggestedFollowUpTime("Call at 12 am")).toBe("00:00");
    expect(suggestedFollowUpTime("Call at 12:30 pm")).toBe("12:30");
    expect(suggestedFollowUpTime("Call at 19 pm")).toBeNull();
  });
});
