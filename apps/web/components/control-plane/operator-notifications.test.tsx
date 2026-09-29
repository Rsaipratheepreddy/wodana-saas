import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { OperatorNotification } from "@/lib/internal/notifications";
import { OperatorNotifications } from "./operator-notifications";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/internal" }));

const NOW = new Date().toISOString();
const notice = (overrides: Partial<OperatorNotification> = {}): OperatorNotification => ({
  id: "0f5a3c1e-2b4d-4e6f-8a9b-1c2d3e4f5a60", eventType: "sales_enquiry.received", title: "SE-0012 · Studio Nord", body: "Lena Fischer",
  link: "/internal/sales-enquiries?enquiry=6a1f0f3e-5b4e-4f0e-9c8a-1f2d3e4b5a60", sourceType: "sales_enquiry",
  sourceId: "6a1f0f3e-5b4e-4f0e-9c8a-1f2d3e4b5a60", readAt: null, createdAt: NOW, ...overrides,
});

function mount(state: { notifications: OperatorNotification[]; unread: number }) {
  const bodies: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { ids?: string[]; all?: boolean };
      bodies.push(body);
      state.notifications = state.notifications.map((item) => (body.all || body.ids?.includes(item.id) ? { ...item, readAt: NOW } : item));
      state.unread = state.notifications.filter((item) => !item.readAt).length;
    }
    return Response.json(state);
  }));
  render(<DesignSystemProvider><OperatorNotifications /></DesignSystemProvider>);
  return bodies;
}

afterEach(() => { vi.unstubAllGlobals(); router.push.mockReset(); });

describe("Wodana Control notifications", () => {
  it("shows how many notices are unread and names a new sales enquiry", async () => {
    mount({ notifications: [notice(), notice({ id: "1f5a3c1e-2b4d-4e6f-8a9b-1c2d3e4f5a61", title: "SE-0011 · Casa Verde", readAt: NOW })], unread: 1 });
    const bell = await screen.findByRole("button", { name: "Notifications, 1 unread" });
    await userEvent.click(bell);
    expect(await screen.findByRole("dialog", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getAllByText("New sales enquiry")).toHaveLength(2);
    expect(screen.getByText("SE-0012 · Studio Nord")).toBeInTheDocument();
  });

  it("opens the enquiry a notice is about and marks it read", async () => {
    const bodies = mount({ notifications: [notice()], unread: 1 });
    await userEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    await userEvent.click(await screen.findByRole("button", { name: /SE-0012 · Studio Nord/ }));
    expect(router.push).toHaveBeenCalledWith("/internal/sales-enquiries?enquiry=6a1f0f3e-5b4e-4f0e-9c8a-1f2d3e4b5a60");
    await waitFor(() => expect(bodies).toEqual([{ ids: [notice().id] }]));
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });

  it("marks every notice read at once", async () => {
    const bodies = mount({ notifications: [notice(), notice({ id: "1f5a3c1e-2b4d-4e6f-8a9b-1c2d3e4f5a61" })], unread: 2 });
    await userEvent.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));
    await userEvent.click(await screen.findByRole("button", { name: "Mark all as read" }));
    await waitFor(() => expect(bodies).toEqual([{ all: true }]));
    expect(screen.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
  });
});
