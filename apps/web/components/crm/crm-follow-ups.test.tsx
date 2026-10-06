import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crmScreenFixture } from "@/lib/crm/screens";
import { crmRequest, CrmRequestError, type RecordData } from "@/lib/crm/client";
import { CrmFollowUps, followUpGroup } from "./crm-follow-ups";
import { FollowUpSheet, NewFollowUpDialog, reminderTimestamp } from "./follow-up-editor";

vi.mock("@/lib/crm/client", async (original) => ({ ...await original<object>(), crmRequest: vi.fn() }));
const workspaceId = "workspace";
const initial: RecordData = { id: "reminder", title: "Discuss quotation", partyName: "Maya Nair", leadId: "lead-1", type: "call", status: "pending", dueAt: "2026-09-06T10:00:00.000Z", description: "Client wants a revised quote.", version: 3 };
const lead = { id: "lead-1", partyName: "Maya Nair", title: "Clinic design", status: "connected" };
const api = vi.mocked(crmRequest);
beforeEach(() => {
  vi.clearAllMocks();
  api.mockImplementation(async (_workspace, path, method, body) => {
    if (method === "PATCH") return { ...initial, ...body as object, version: 4 };
    if (path.endsWith("/complete")) return { ...initial, ...body as object, status: "completed", version: 5 };
    if (method === "POST") return { ...body as object, id: "new-follow-up", status: "pending", version: 1 };
    if (path.startsWith("leads?")) return { data: [lead], nextCursor: null };
    if (path.startsWith("parties?")) return { data: [], nextCursor: null };
    if (path === "members") return [];
    if (path === "activities/reminder") return initial;
    return { data: [initial], nextCursor: null };
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function fixture(items = [initial]) { return { ...structuredClone(crmScreenFixture("follow-ups")), workspaceId, items }; }
function sheet() { const onSaved = vi.fn(), onClose = vi.fn(); render(<FollowUpSheet workspaceId={workspaceId} recordId={initial.id} summary={initial} onSaved={onSaved} onClose={onClose} />); return { onSaved, onClose }; }

async function setReminderDate(user: ReturnType<typeof userEvent.setup>) {
  for (const [segment, value] of [["year", "2026"], ["month", "9"], ["day", "8"]]) {
    await user.click(screen.getByRole("spinbutton", { name: new RegExp(`${segment},.*Reminder date`, "i") }));
    await user.keyboard(value);
  }
}

describe("Follow-up list", () => {
  it("shows overdue and unscheduled reminders by default without mixing in completed records", () => {
    render(<CrmFollowUps initialLayout="list" initialData={fixture([initial, { ...initial, id: "no-date", title: "Choose next step", dueAt: null }, { ...initial, id: "done", title: "Already finished", status: "completed" }])} />);
    expect(screen.getByRole("table", { name: "Follow-ups" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Discuss quotation/ })).toHaveTextContent("Overdue");
    expect(screen.getByRole("button", { name: /Choose next step/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Already finished/ })).not.toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });

  it("searches notes and clients, and separates completed reminders", async () => {
    const user = userEvent.setup();
    render(<CrmFollowUps initialLayout="list" initialData={fixture([initial, { ...initial, id: "done", status: "completed", title: "Already finished" }])} />);
    const search = screen.getByRole("searchbox", { name: "Search follow-ups" });
    await user.type(search, "revised quote");
    expect(screen.getByRole("button", { name: /Discuss quotation/ })).toBeInTheDocument();
    await user.clear(search); await user.type(search, "no match");
    expect(screen.getByText("No matches")).toBeInTheDocument();
    await user.clear(search); await user.click(screen.getByRole("button", { name: "Completed" }));
    expect(screen.getByRole("button", { name: /Already finished/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Discuss quotation/ })).not.toBeInTheDocument();
  });

  it("opens the dedicated editor when any part of a reminder is clicked", async () => {
    const user = userEvent.setup(); render(<CrmFollowUps initialLayout="list" initialData={fixture()} />);
    await user.click(screen.getByRole("button", { name: /Discuss quotation/ }));
    expect(await screen.findByRole("textbox", { name: "Notes" })).toHaveValue(String(initial.description));
    expect(api).toHaveBeenCalledWith(workspaceId, "activities/reminder", "GET", undefined, expect.any(AbortSignal));
  });

  it("supports opening reminders by keyboard and links to the correct calendar route", async () => {
    const user = userEvent.setup(); render(<CrmFollowUps initialLayout="list" initialData={fixture()} />);
    expect(screen.getByRole("link", { name: "Open calendar" })).toHaveAttribute("href", "/workspace/crm/follow-ups?view=schedule");
    screen.getByRole("button", { name: /Discuss quotation/ }).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("textbox", { name: "Notes" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("loads older follow-ups, preserves the first page, and removes the exhausted cursor", async () => {
    api.mockResolvedValueOnce({ data: [initial, { ...initial, id: "older", title: "Older reminder" }], nextCursor: null });
    const user = userEvent.setup(); render(<CrmFollowUps initialLayout="list" initialData={{ ...fixture(), nextCursor: "older-page" }} />);
    await user.click(screen.getByRole("button", { name: "Load more follow-ups" }));
    expect(await screen.findByRole("button", { name: /Older reminder/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Discuss quotation/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load more follow-ups" })).not.toBeInTheDocument();
    expect(api.mock.calls[0][1]).toContain("cursor=older-page");
  });

  it("defines Today by the viewer's calendar day, not the next 24 hours", () => {
    const now = Date.parse("2026-09-07T17:00:00Z");
    expect(followUpGroup({ ...initial, dueAt: "2026-09-07T18:00:00Z" }, now, "Asia/Kolkata")).toBe("Today");
    expect(followUpGroup({ ...initial, dueAt: "2026-09-07T19:00:00Z" }, now, "Asia/Kolkata")).toBe("Upcoming");
    expect(followUpGroup({ ...initial, dueAt: null }, now, "Asia/Kolkata")).toBe("In progress");
  });
});

it("filters Sales Kanban by the first five owners and searches the rest beside Filter", async () => {
  const user = userEvent.setup();
  const tasks = Array.from({ length: 6 }, (_, index) => ({ ...initial, id: `task-${index + 1}`, title: `Sales task ${index + 1}`, type: "task", ownerMembershipId: `owner-${index + 1}`, ownerName: `Owner ${index + 1}` }));
  render(<CrmFollowUps initialLayout="kanban" tasksOnly initialData={fixture(tasks)} />);
  const owners = screen.getByRole("group", { name: "Filter sales tasks by assignee" });
  expect(owners.querySelectorAll("button")).toHaveLength(5);
  await user.click(screen.getByRole("button", { name: "Show tasks assigned to Owner 1" }));
  expect(screen.getByText("Sales task 1")).toBeInTheDocument();
  expect(screen.queryByText("Sales task 2")).not.toBeInTheDocument();
  await user.click(screen.getByLabelText("Choose sales assignee"));
  await user.type(screen.getByRole("searchbox", { name: "Search sales assignees" }), "Owner 6");
  await user.click(screen.getByRole("button", { name: "Owner 6" }));
  expect(screen.getByText("Sales task 6")).toBeInTheDocument();
  expect(screen.queryByText("Sales task 1")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Approvals" })).not.toBeInTheDocument();
});

describe("Notes and rescheduling", () => {
  it("saves notes and the new reminder time together with the current version", async () => {
    const user = userEvent.setup(); const { onSaved } = sheet();
    const notes = await screen.findByRole("textbox", { name: "Notes" });
    await user.clear(notes); await user.type(notes, "Client asked me to call tomorrow.");
    await setReminderDate(user);
    await user.click(screen.getByRole("spinbutton", { name: "hour, Reminder time" })); await user.keyboard("10");
    await user.click(screen.getByRole("spinbutton", { name: "minute, Reminder time" })); await user.keyboard("30");
    await user.click(screen.getByRole("spinbutton", { name: /am\/pm, Reminder time/i })); await user.keyboard("a");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved. Your reminder is updated in Today and Calendar.");
    expect(api).toHaveBeenCalledWith(workspaceId, "activities/reminder", "PATCH", { version: 3, title: initial.title, description: "Client asked me to call tomorrow.", dueAt: "2026-09-08T10:30:00.000Z" });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ version: 4 }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("keeps the draft after a failed save, then retries safely", async () => {
    const user = userEvent.setup(); sheet();
    await user.type(await screen.findByRole("textbox", { name: "Notes" }), " Extra detail.");
    api.mockRejectedValueOnce(new Error("Connection lost"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Connection lost")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue("Client wants a revised quote. Extra detail.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Saved. Your reminder is updated in Today and Calendar.")).toBeInTheDocument();
  });

  it("saves edited notes before completion and uses the new version", async () => {
    const user = userEvent.setup(); sheet();
    await user.type(await screen.findByRole("textbox", { name: "Notes" }), " Called client.");
    await user.click(screen.getByRole("button", { name: "Save & complete" }));
    expect(await screen.findByText("Follow-up completed. Your notes are saved.")).toBeInTheDocument();
    const writes = api.mock.calls.filter((item) => item[2] !== "GET");
    expect(writes.map((item) => item[2])).toEqual(["PATCH", "POST"]);
    expect(writes[1][3]).toEqual({ version: 4 });
    expect(screen.queryByRole("button", { name: "Mark complete" })).not.toBeInTheDocument();
  });

  it("does not repeat the note save if completion fails after saving", async () => {
    const user = userEvent.setup(); sheet();
    await user.type(await screen.findByRole("textbox", { name: "Notes" }), " Done.");
    api.mockResolvedValueOnce({ ...initial, description: "Client wants a revised quote. Done.", version: 4 }).mockRejectedValueOnce(new Error("Try again"));
    await user.click(screen.getByRole("button", { name: "Save & complete" }));
    await screen.findByText(/Notes and schedule were saved, but completion failed/);
    await user.click(screen.getByRole("button", { name: "Mark complete" }));
    await screen.findByText("Follow-up completed. Your notes are saved.");
    expect(api.mock.calls.filter((item) => item[2] === "PATCH")).toHaveLength(1);
    expect(api.mock.calls.filter((item) => item[1].endsWith("/complete"))[1][3]).toEqual({ version: 4 });
  });

  it("prevents overwriting a newer record and offers an explicit reload", async () => {
    const user = userEvent.setup(); sheet();
    await user.type(await screen.findByRole("textbox", { name: "Notes" }), " My note.");
    api.mockRejectedValueOnce(new CrmRequestError("Changed by another user", 409));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("button", { name: "Reload latest" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue("Client wants a revised quote. My note.");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("asks before discarding notes when the editor is closed", async () => {
    const user = userEvent.setup(); const { onClose } = sheet();
    await user.type(await screen.findByRole("textbox", { name: "Notes" }), " Keep this.");
    await user.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Discard unsaved follow-up changes?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("rejects an incomplete or invalid schedule without changing the record", () => {
    expect(() => reminderTimestamp("2026-09-08", "")).toThrow("both");
    expect(() => reminderTimestamp("2026-02-30", "10:00")).toThrow("valid");
    expect(reminderTimestamp("", "")).toBeNull();
  });
});

describe("Create a follow-up", () => {
  it.each(["connected", "qualified", "paused"])("creates a note and reminder for a %s lead without reopening it", async (status) => {
    api.mockImplementation(async (_workspace, path, method, body) => {
      if (method === "POST") return { ...body as object, id: "new", status: "pending", version: 1 };
      if (path.startsWith("leads?")) return { data: [{ ...lead, status }], nextCursor: null };
      return { data: [], nextCursor: null };
    });
    const user = userEvent.setup(); render(<CrmFollowUps initialLayout="list" initialData={fixture()} />);
    await user.click(screen.getByRole("button", { name: "Add follow-up" }));
    const dialog = await screen.findByRole("dialog", { name: "Add follow-up" });
    const combo = within(dialog).getByRole("combobox", { name: /Enquiry or customer/ });
    await waitFor(() => expect(combo).toBeEnabled());
    await user.type(combo, "Maya");
    await user.click(await screen.findByRole("option", { name: "Maya Nair · Clinic design" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Notes" }), "Client asked me to call tomorrow.");
    await setReminderDate(user);
    await user.click(screen.getByRole("spinbutton", { name: "hour, Reminder time" })); await user.keyboard("10");
    await user.click(screen.getByRole("spinbutton", { name: "minute, Reminder time" })); await user.keyboard("30");
    await user.click(screen.getByRole("spinbutton", { name: /am\/pm, Reminder time/i })); await user.keyboard("a");
    await user.click(within(dialog).getByRole("button", { name: "Save reminder" }));
    await waitFor(() => expect(api.mock.calls.some((item) => item[2] === "POST")).toBe(true));
    expect(api.mock.calls.find((item) => item[2] === "POST")?.[3]).toMatchObject({ leadId: lead.id, type: "call", title: "Call follow-up · Maya Nair", description: "Client asked me to call tomorrow.", isNextAction: status === "connected", customerVisible: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

it("uses the shared reminder editor with a preselected enquiry and keeps a saved reminder after refresh failure", async () => {
  const onCreated = vi.fn().mockRejectedValue(new Error("Refresh failed"));
  render(<NewFollowUpDialog workspaceId={workspaceId} initialLead={{ ...lead, ownerMembershipId: "owner-1" }} initialSchedule={{ date: "2026-09-23", time: "09:30" }} onClose={vi.fn()} onCreated={onCreated} />);
  const user = userEvent.setup();
  expect(screen.getByRole("combobox", { name: /Enquiry or customer/ })).toHaveValue("Maya Nair · Clinic design");
  await user.click(screen.getByRole("button", { name: "Save reminder" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
  const post = api.mock.calls.find(call => call[2] === "POST");
  expect(post?.[3]).toMatchObject({ leadId: "lead-1", ownerMembershipId: "owner-1", type: "call", durationMinutes: 30, isNextAction: true, dueAt: "2026-09-23T09:30:00.000Z" });
  expect(await screen.findByText("Follow-up saved. Close and refresh to see it. Do not create it again.")).toBeInTheDocument();
  // Saved once: only Close is left, so it can't be created twice.
  expect(screen.queryByRole("button", { name: "Save reminder" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
});

it("has one title, the lists under it and the owner as a removable filter chip", async () => {
  const user = userEvent.setup();
  render(<CrmFollowUps initialLayout="list" initialData={fixture([initial, { ...initial, id: "other", title: "Other call", ownerMembershipId: "owner-2", ownerName: "Owner Two" }])} />);
  expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["Follow-ups"]);
  expect(screen.getAllByRole("button", { name: "Add follow-up" })).toHaveLength(1);
  expect(within(screen.getByRole("group", { name: "Follow-up lists" })).getByRole("button", { name: /^To do/ })).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Filter" }));
  await user.click(screen.getByRole("button", { name: /Filter by owner/ }));
  await user.click(screen.getByRole("option", { name: "Owner Two" }));
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(within(screen.getByRole("group", { name: "Filters in use" })).getByText("Owner Two")).toBeVisible();
  expect(screen.getByRole("button", { name: /Other call/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Discuss quotation/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Remove filter Owner" }));
  expect(screen.getByRole("button", { name: /Discuss quotation/ })).toBeInTheDocument();
});
