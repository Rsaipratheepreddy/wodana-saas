import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttendanceSession, HrmsBootstrap, WorkCalendar } from "@wodana/contracts";
import { DesignSystemProvider } from "@/design-system";
import { HomeAttendance } from "./home-attendance";

const device = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/hrms/pending", () => ({
  readPending: async (key: string) => device.get(key),
  writePending: async (pending: { key: string }) => { device.set(pending.key, pending); },
  clearPending: async (key: string) => { device.delete(key); },
}));

const calendar: WorkCalendar = { id: "cal1", name: "Studio", timezone: "UTC", workingDays: [1, 2, 3, 4, 5], holidays: [], dayStart: "09:00", halfDay: "13:00", dayEnd: "18:00" };
const boot = (tracked: boolean): HrmsBootstrap => ({
  membershipId: "m1", settings: null, calendars: [calendar], workspace: { name: "Palm Living", timezone: "UTC" },
  employee: tracked ? { membershipId: "m1", userId: "u1", name: "Dana", enabled: true, remoteAllowed: false, managerId: null, activeFrom: "2026-01-01", activeTo: null, calendar, version: 1 } : null,
  permissions: { self: true, team: false, manage: false, evidence: false, manageProjects: false },
});
const open: AttendanceSession = { id: "s1", startedAt: "2026-09-28T05:00:00Z", endedAt: null, calendar, version: 1, pendingReviewCount: 0, rejectedReviewCount: 0,
  segments: [{ id: "g1", mode: "office", locationId: "o1", projectId: null, caseId: null, context: { name: "General work", location: null }, startedAt: "2026-09-28T05:00:00Z", endedAt: null }] };
const mount = (bootstrap: HrmsBootstrap, current: AttendanceSession | null) => vi.stubGlobal("fetch", vi.fn(async (url: string) => {
  const path = new URL(url, "http://localhost").pathname;
  const value = path.endsWith("/bootstrap") ? bootstrap : path.endsWith("/attendance/current") ? current : [];
  return { ok: true, status: 200, json: async () => value };
}));
const home = () => render(<DesignSystemProvider locale="en-GB" timeZone="UTC"><HomeAttendance workspaceId="w" /></DesignSystemProvider>);

describe("Home attendance", () => {
  afterEach(() => { vi.unstubAllGlobals(); device.clear(); });

  it("says so, without a check-in, when attendance isn't on for the person", async () => {
    mount(boot(false), null);
    home();
    expect(await screen.findByText("Attendance isn't on for you.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check in" })).toBeNull();
    expect(screen.getByRole("link", { name: "My days" })).toHaveAttribute("href", "/workspace/hrms");
  });

  it("checks in from Home with the same capture as People", async () => {
    mount(boot(true), null);
    home();
    await waitFor(() => expect(screen.getByRole("button", { name: "Check in" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Check in" }));
    const dialog = await screen.findByRole("dialog", { name: "Check in" });
    expect(within(dialog).getByRole("radiogroup", { name: "Where" })).toBeInTheDocument();
  });

  it("offers check-out, with where and since when, while checked in", async () => {
    mount(boot(true), open);
    home();
    await waitFor(() => expect(screen.getByRole("button", { name: "Check out" })).toBeEnabled());
    expect(screen.getByText(/Office · since/)).toBeInTheDocument();
    expect(screen.getByText("Checked in")).toBeInTheDocument();
  });
});
