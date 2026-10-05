import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HrmsBootstrap, HrmsCalendar, WorkCalendar } from "@wodana/contracts";
import { DesignSystemProvider } from "@/design-system";
import type { HrmsSection } from "@/lib/hrms/sections";
import { AttendanceSettingsPage } from "./attendance-settings";
import { HrmsPage } from "./hrms-page";

const nav = vi.hoisted(() => ({ query: "", rerender: null as null | (() => void) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: (href: string) => { nav.query = href.split("?")[1] ?? ""; nav.rerender?.(); }, push: vi.fn() }),
  usePathname: () => "/workspace/hrms",
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock("@/lib/hrms/pending", () => ({ readPending: async () => undefined, writePending: async () => undefined, clearPending: async () => undefined }));

// §5c D.4: People forms are one column, label above field, titled sections, Save at the bottom end. FormRow stays only for
// a start and its end (issued–expires, from–to, a day's start and end) and an amount with its currency.
const sectionTitles = (dialog: HTMLElement) => [...dialog.querySelectorAll(".wd-form-section-title")].map((title) => title.textContent);
const rows = (dialog: HTMLElement) => dialog.querySelectorAll(".wd-form-row").length;
const saveAtTheEnd = (dialog: HTMLElement, name: string) => {
  const actions = dialog.querySelector(".wd-form-footer .wd-dialog-actions") ?? [...dialog.querySelectorAll(".wd-dialog-actions")].at(-1);
  expect(actions?.lastElementChild?.textContent).toBe(name);
};

const base: WorkCalendar = { id: "cal1", name: "Studio", timezone: "UTC", workingDays: [1, 2, 3, 4, 5], holidays: [], dayStart: "09:00", halfDay: "13:00", dayEnd: "18:00" };
const calendar: HrmsCalendar = { ...base, version: 2, holidayList: [], people: 4, isDefault: true };
const boot: HrmsBootstrap = {
  membershipId: "m1",
  employee: { membershipId: "m1", userId: "u1", name: "Dana Designer", enabled: true, remoteAllowed: false, managerId: null, activeFrom: "2026-01-01", activeTo: null, calendar: base, version: 1 },
  settings: { defaultCalendarId: "cal1", fallbackApproverId: null, maxGpsAccuracyM: 100, maxCaptureAgeSeconds: 120, mediaRetentionDays: 365, version: 1 },
  calendars: [base], workspace: { name: "Studio", timezone: "UTC" },
  permissions: { self: true, team: true, manage: true, evidence: true, manageProjects: false },
};

const mount = () => vi.stubGlobal("fetch", vi.fn(async (url: string) => {
  const parsed = new URL(url, "http://localhost");
  const path = parsed.pathname.replace(/^\/api\/workspace\/(hrms|projects)\/?/, "");
  const value = path === "bootstrap" ? boot : path === "calendars" ? [calendar] : path === "leave/types" ? []
    : path === "crews" ? { crews: [], workers: [], canManage: true }
    : path === "documents" ? { documents: [], siteDocuments: [], canManage: true }
    : path === "attendance/current" ? null
    : path === "attendance/history" ? { from: "", to: "", sessions: [], segments: [], events: [], reviews: [], days: [] }
    : parsed.pathname.startsWith("/api/purchasing/suppliers") ? { suppliers: [] }
    : parsed.pathname.startsWith("/api/") && !parsed.pathname.startsWith("/api/workspace/") ? { trades: [] } : [];
  return { ok: true, status: 200, json: async () => value };
}));
const hrms = (section: HrmsSection) => {
  const ui = () => <DesignSystemProvider locale="en-GB" timeZone="UTC" currency="AED"><HrmsPage workspaceId="w" section={section} /></DesignSystemProvider>;
  const view = render(ui());
  nav.rerender = () => view.rerender(ui());
};
const settings = (tab: string) => {
  nav.query = `tab=${tab}`;
  const ui = () => <DesignSystemProvider locale="en-GB" timeZone="UTC"><AttendanceSettingsPage workspaceId="w" /></DesignSystemProvider>;
  const view = render(ui());
  nav.rerender = () => view.rerender(ui());
};

describe("People form dialogs", () => {
  afterEach(() => { vi.unstubAllGlobals(); nav.query = ""; nav.rerender = null; });

  it("adds a worker in one column, contact and pay in their own sections, the day rate beside its currency", async () => {
    mount();
    hrms("crews");
    await userEvent.click(within(await screen.findByRole("group", { name: "Show" })).getByRole("button", { name: "Workers" }));
    await userEvent.click(await screen.findByRole("button", { name: "New worker" }));
    const sheet = await screen.findByRole("dialog", { name: "New worker" });
    expect(sectionTitles(sheet)).toEqual(["Contact", "Pay"]);
    expect(rows(sheet)).toBe(1);
    saveAtTheEnd(sheet, "Save");
  });

  it("files a document in one column, the issued and expiry dates side by side", async () => {
    mount();
    hrms("documents");
    await userEvent.click(await screen.findByRole("button", { name: "New document" }));
    const sheet = await screen.findByRole("dialog", { name: "New document" });
    expect(sectionTitles(sheet)).toEqual(["Validity", "File"]);
    expect(rows(sheet)).toBe(1);
    saveAtTheEnd(sheet, "Save");
  });

  it("sets up a leave type with its allowance in its own section", async () => {
    mount();
    settings("leave-types");
    await userEvent.click(await screen.findByRole("button", { name: "New leave type" }));
    const dialog = await screen.findByRole("dialog", { name: "New leave type" });
    expect(sectionTitles(dialog)).toEqual(["Allowance"]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Save");
  });

  it("adds a workplace in one column, where it is in its own section", async () => {
    mount();
    settings("workplaces");
    await userEvent.click(await screen.findByRole("button", { name: "New workplace" }));
    const sheet = await screen.findByRole("dialog", { name: "New workplace" });
    expect(sectionTitles(sheet)).toEqual(["Location"]);
    expect(rows(sheet)).toBe(0);
    saveAtTheEnd(sheet, "Save");
  });

  it("keeps two-column grids out of the People styles", () => {
    const twoColumns = /grid-template-columns:\s*(repeat\(2,|repeat\(auto-fit|1fr 1fr|minmax\(0, ?1fr\) minmax\(0, ?1fr\))/;
    // Nothing allowed: facts (label · value), a crew day's worker rows and the add-to-site-list row (a field and its button)
    // use fixed tracks, never two equal field columns; coupled pairs use the shared FormRow.
    for (const sheet of readdirSync(__dirname).filter((name) => name.endsWith(".module.css"))) {
      const offenders = readFileSync(join(__dirname, sheet), "utf8").split("\n").filter((line) => twoColumns.test(line));
      expect(offenders, sheet).toEqual([]);
    }
  });
});
