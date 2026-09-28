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
  it("switches a module's channel off for every event it covers, and sets quiet hours for the phone", async () => {
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string, options?: RequestInit) => {
      if (options?.method === "POST") { posts.push(JSON.parse(String(options.body))); return { ok: true, json: async () => ({}) }; }
      return { ok: true, json: async () => [] };
    }));
    render(<NotificationSettingsPage workspaceId={workspaceId} userId={userId} />);
    await userEvent.click(await screen.findByRole("switch", { name: "Projects: Email" }));
    await waitFor(() => expect(posts).toHaveLength(6));
    expect(posts).toContainEqual({ recipientType: "user", recipientId: userId, eventType: "site.*", channel: "email", enabled: false });
    posts.length = 0;
    await userEvent.click(screen.getByRole("switch", { name: "Hold phone notifications" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ eventType: "*", channel: "push", enabled: true, quietHours: { start: "22:00", end: "07:00" } });
  });
});

describe("Home › Notifications", () => {
  it("lists every notice and mutes a kind of notice on every channel", async () => {
    const posts: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string, options?: RequestInit) => {
      if (options?.method === "POST") { posts.push(JSON.parse(String(options.body))); return { ok: true, json: async () => ({}) }; }
      return { ok: true, json: async () => [{ id: "n1", eventType: "work.due_soon", subject: "Task due tomorrow", body: "Fit wardrobe", deepLink: "/workspace/projects/p", readAt: null, createdAt: new Date().toISOString() }] };
    }));
    render(<NotificationsPage workspaceId={workspaceId} userId={userId} />);
    expect(await screen.findByRole("link", { name: /Task due tomorrow/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "More for Task due tomorrow" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Mute notices like this" }));
    await waitFor(() => expect(posts.map((post) => post.channel)).toEqual(["in_app", "email", "push"]));
    expect(posts[0]).toMatchObject({ recipientId: userId, eventType: "work.due_soon", enabled: false });
    expect(await screen.findByText("Muted. Turn it back on in Notification settings.")).toBeInTheDocument();
  });
});
