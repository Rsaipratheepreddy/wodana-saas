import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { dayGroup, moduleEnabled, notificationModule } from "@/lib/workspace/notification-modules";
import { NotificationSettingsPage } from "./notification-settings-page";
import { NotificationsPage } from "./notifications-page";

const workspaceId = "e56299c6-3da3-402a-a9ac-3995bb37b9d4";
const userId = "0f7e3f3c-3d9e-4c1b-9d0f-3c1b2d4e5f60";

afterEach(() => vi.unstubAllGlobals());

describe("notification groups (FD-7)", () => {
  it("names each event's module and day", () => {
    expect(notificationModule("crm.lead.assigned")).toBe("sales");
    expect(notificationModule("site.report_missing")).toBe("projects");
    expect(notificationModule("purchasing.approval_needed")).toBe("operations");
    expect(notificationModule("petty_cash.submitted")).toBe("finance");
    expect(notificationModule("hrms.leave_requested")).toBe("people");
    expect(notificationModule("quotation.review_requested")).toBe("planning");
    expect(notificationModule(undefined)).toBe("workspace");
    const now = new Date("2026-09-28T10:00:00Z");
    expect(dayGroup("2026-09-28T01:00:00Z", "UTC", now)).toBe("today");
    expect(dayGroup("2026-09-23T01:00:00Z", "UTC", now)).toBe("week");
    expect(dayGroup("2026-09-10T01:00:00Z", "UTC", now)).toBe("earlier");
    expect(moduleEnabled([{ eventType: "crm.*", channel: "email", enabled: false, quietHours: {}, version: 1 }], "sales", "email")).toBe(false);
    expect(moduleEnabled([], "sales", "email")).toBe(true);
  });
});

describe("Settings → Notifications", () => {
  const person = { digestEnabled: true, digestTime: null, quietHours: null, timeZone: null, version: 3, firm: { quietStart: "20:00", quietEnd: "08:00", digestTime: "08:00" },
    effectiveTimeZone: "Europe/Lisbon", workspaceTimeZone: "UTC", criticalEventTypes: ["approvals.waiting", "receivables.overdue"] };
  function api({ putStatus = 200 } = {}) {
    const posts: unknown[] = [];
    const puts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, options?: RequestInit) => {
      if (options?.method === "POST") { posts.push(JSON.parse(String(options.body))); return { ok: true, json: async () => ({}) }; }
      if (options?.method === "PUT") {
        const body = JSON.parse(String(options.body));
        puts.push(body);
        return putStatus >= 400 ? { ok: false, status: putStatus, json: async () => ({ message: "Changed" }) } : { ok: true, status: 200, json: async () => ({ ...body, version: body.version + 1 }) };
      }
      return { ok: true, json: async () => (String(input).includes("notification-person-settings") ? person : []) };
    }));
    return { posts, puts };
  }

  it("switches a module's channel off for every event it covers", async () => {
    const { posts } = api();
    render(<NotificationSettingsPage workspaceId={workspaceId} userId={userId} />);
    await userEvent.click(await screen.findByRole("switch", { name: "Projects: Email" }));
    await waitFor(() => expect(posts).toHaveLength(6));
    expect(posts).toContainEqual({ recipientType: "user", recipientId: userId, eventType: "site.*", channel: "email", enabled: false });
  });

  it("keeps critical notices always on, and saves the digest, quiet hours for every channel and the time zone with their version", async () => {
    const { puts } = api();
    render(<NotificationSettingsPage workspaceId={workspaceId} userId={userId} />);
    const locked = await screen.findByRole("switch", { name: "Approvals waiting: always on" });
    expect(locked).toBeChecked();
    expect(locked).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Invoice overdue: always on" })).toBeDisabled();
    expect(await screen.findByText("Workspace hours 20:00–08:00")).toBeInTheDocument();
    expect(screen.getByText("Workspace time 08:00")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "My own quiet hours" }));
    await waitFor(() => expect(puts).toEqual([{ digestEnabled: true, digestTime: null, quietHours: { start: "20:00", end: "08:00" }, timeZone: null, version: 3 }]));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Send me a daily digest" })).not.toBeDisabled());
    await userEvent.click(screen.getByRole("switch", { name: "Send me a daily digest" }));
    await waitFor(() => expect(puts[1]).toEqual({ digestEnabled: false, digestTime: null, quietHours: { start: "20:00", end: "08:00" }, timeZone: null, version: 4 }));
  });

  it("says when someone else changed the settings first", async () => {
    api({ putStatus: 409 });
    render(<NotificationSettingsPage workspaceId={workspaceId} userId={userId} />);
    await userEvent.click(await screen.findByRole("switch", { name: "My own quiet hours" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Changed by someone else");
  });
});

describe("Home › Notifications", () => {
  it("lists every notice and mutes a kind of notice on every channel", async () => {
    const posts: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string, options?: RequestInit) => {
      if (options?.method === "POST") { posts.push(JSON.parse(String(options.body))); return { ok: true, json: async () => ({}) }; }
      return { ok: true, json: async () => [
        { id: "n1", eventType: "work.due_soon", subject: "Task due tomorrow", body: "Fit wardrobe", deepLink: "/workspace/projects/p", readAt: null, createdAt: new Date().toISOString() },
        { id: "n2", eventType: "approvals.waiting", subject: "Order waiting for you", body: "PO-17", deepLink: "/workspace/approvals", readAt: null, createdAt: new Date().toISOString() },
      ] };
    }));
    render(<NotificationsPage workspaceId={workspaceId} userId={userId} />);
    expect(await screen.findByRole("link", { name: /Task due tomorrow/ })).toBeInTheDocument();
    // A critical notice can't be muted (R13).
    expect(screen.queryByRole("button", { name: "More for Order waiting for you" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "More for Task due tomorrow" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Mute notices like this" }));
    await waitFor(() => expect(posts.map((post) => post.channel)).toEqual(["in_app", "email", "push"]));
    expect(posts[0]).toMatchObject({ recipientId: userId, eventType: "work.due_soon", enabled: false });
    expect(await screen.findByText("Muted. Turn it back on in Notification settings.")).toBeInTheDocument();
  });

  it("keeps two tabs however many modules notify, with the module as a filter beside them, and no tab warning", async () => {
    const tooMany = vi.spyOn(console, "error");
    const at = new Date().toISOString();
    const notice = (id: string, eventType: string, subject: string, readAt: string | null = null) => ({ id, eventType, subject, body: "", deepLink: null, readAt, createdAt: at });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [
      notice("n1", "crm.lead.assigned", "New enquiry"), notice("n2", "design.review_requested", "Review the concept"), notice("n3", "work.due_soon", "Task due tomorrow", at),
      notice("n4", "factory.inspection_ready", "Wardrobe ready"), notice("n5", "payables.approval_needed", "Bill to approve"), notice("n6", "books.lock_moved", "Lock date moved"),
      notice("n7", "hrms.leave_requested", "Leave request"),
    ] })));
    render(<NotificationsPage workspaceId={workspaceId} userId={userId} />);
    expect(await screen.findByText("Leave request")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Filter notifications" }).querySelectorAll("button")).toHaveLength(2);
    expect(tooMany.mock.calls.some((call) => String(call[0]).includes("tabs; at most"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: /Module/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Operations" }));
    await waitFor(() => expect(screen.queryByText("Leave request")).not.toBeInTheDocument());
    expect(screen.getByText("Wardrobe ready")).toBeInTheDocument();
    // Unread within the module: the factory notice is unread, so it stays; the read task (another module) stays hidden.
    await userEvent.click(screen.getByRole("button", { name: /^Unread/ }));
    expect(screen.getByText("Wardrobe ready")).toBeInTheDocument();
    expect(screen.queryByText("Task due tomorrow")).not.toBeInTheDocument();
    tooMany.mockRestore();
  });
});
