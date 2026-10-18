import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { choiceEnabled, dayGroup, notificationModule } from "@/lib/workspace/notification-modules";
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
    expect(choiceEnabled([{ group: "sales", channel: "email", enabled: false }], "sales", "email")).toBe(false);
    expect(choiceEnabled([], "sales", "email")).toBe(true);
  });
});

describe("Settings → Notifications", () => {
  const groups = ["sales", "planning", "projects", "operations", "finance", "ledger", "people", "workspace"];
  const view = (channels: string[] = ["in_app", "email", "push"]) => ({
    groups, channels, choices: groups.flatMap((group) => channels.map((channel) => ({ group, channel, enabled: !(group === "finance" && channel === "push") }))),
    quietHours: null, digestEnabled: true, digestTime: null, timeZone: null, version: 3,
    firm: { quietStart: "20:00", quietEnd: "08:00", digestTime: "08:00" }, effectiveTimeZone: "Europe/Lisbon", workspaceTimeZone: "Europe/Lisbon",
  });
  function api({ putStatus = 200, channels }: { putStatus?: number; channels?: string[] } = {}) {
    const puts: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string, options?: RequestInit) => {
      if (options?.method === "PUT") {
        const body = JSON.parse(String(options.body));
        puts.push(body);
        return putStatus >= 400 ? { ok: false, status: putStatus, json: async () => ({ message: "Changed" }) } : { ok: true, status: 200, json: async () => ({ ...view(channels), ...body, version: body.version + 1 }) };
      }
      return { ok: true, status: 200, json: async () => view(channels) };
    }));
    return { puts };
  }
  const cell = (body: Record<string, unknown>, group: string, channel: string) => (body.choices as Array<{ group: string; channel: string; enabled: boolean }>).find((item) => item.group === group && item.channel === channel);

  it("shows a switch per group for each channel the workspace has turned on, with the alert row locked on", async () => {
    api();
    render(<NotificationSettingsPage workspaceId={workspaceId} />);
    expect(await screen.findByRole("switch", { name: "Projects: Email" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Finance: Phone" })).not.toBeChecked();
    expect(screen.queryByRole("switch", { name: "Sales: WhatsApp" })).not.toBeInTheDocument();
    for (const channel of ["In the app", "Email", "Phone"]) {
      const locked = screen.getByRole("switch", { name: `Alerts: ${channel}` });
      expect(locked).toBeChecked();
      expect(locked).toBeDisabled();
    }
    expect(screen.getByText("Always on: in the app and your fastest channel")).toBeInTheDocument();
    // Nothing changed yet: no save bar.
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument();
  });

  it("adds WhatsApp when the workspace has it", async () => {
    api({ channels: ["in_app", "email", "whatsapp"] });
    render(<NotificationSettingsPage workspaceId={workspaceId} />);
    expect(await screen.findByRole("switch", { name: "Sales: WhatsApp" })).toBeChecked();
    expect(screen.queryByRole("switch", { name: "Sales: Phone" })).not.toBeInTheDocument();
  });

  it("saves the grid, quiet hours and the digest together with their version, bottom-end", async () => {
    const { puts } = api();
    render(<NotificationSettingsPage workspaceId={workspaceId} />);
    await userEvent.click(await screen.findByRole("switch", { name: "Projects: Email" }));
    expect(await screen.findByText("Workspace hours 20:00–08:00")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "My own quiet hours" }));
    await userEvent.click(screen.getByRole("switch", { name: "Send me a daily digest" }));
    const bar = screen.getByRole("region", { name: "Unsaved changes" });
    await userEvent.click(within(bar).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ quietHours: { start: "20:00", end: "08:00" }, digestEnabled: false, digestTime: null, timeZone: null, version: 3 });
    expect(cell(puts[0], "projects", "email")).toEqual({ group: "projects", channel: "email", enabled: false });
    expect(cell(puts[0], "finance", "push")).toEqual({ group: "finance", channel: "push", enabled: false });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  });

  it("puts the switches back on Discard", async () => {
    api();
    render(<NotificationSettingsPage workspaceId={workspaceId} />);
    await userEvent.click(await screen.findByRole("switch", { name: "Sales: In the app" }));
    expect(screen.getByRole("switch", { name: "Sales: In the app" })).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("switch", { name: "Sales: In the app" })).toBeChecked();
  });

  it("says when someone else changed the settings first", async () => {
    api({ putStatus: 409 });
    render(<NotificationSettingsPage workspaceId={workspaceId} />);
    await userEvent.click(await screen.findByRole("switch", { name: "My own quiet hours" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
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
