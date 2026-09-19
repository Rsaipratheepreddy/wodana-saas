import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceNotifications } from "./workspace-notifications";

const workspaceId = "e56299c6-3da3-402a-a9ac-3995bb37b9d4";
const id = "565032bd-812d-4853-8afa-0e951144b628";

afterEach(() => vi.unstubAllGlobals());

it("shows the assigned enquiry alert and marks it read when opened", async () => {
  const fetcher = vi.fn(async (input: string, options?: RequestInit) => {
    if (options?.method === "POST") return { ok: true, json: async () => ({ id }) };
    return { ok: true, json: async () => [{ id, subject: "New enquiry assigned", body: "Please review this enquiry and record your next action.", deepLink: "/workspace/crm/leads?lead=lead", readAt: null, createdAt: "2026-09-17T08:00:00Z" }] };
  });
  vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceNotifications workspaceId={workspaceId} />);
  const trigger = await screen.findByRole("button", { name: "Notifications, 1 unread" });
  await userEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "Notifications" })).toBeInTheDocument();
  const link = screen.getByRole("link", { name: /New enquiry assigned/ });
  expect(link).toHaveAttribute("href", "/workspace/crm/leads?lead=lead");
  link.addEventListener("click", event => event.preventDefault());
  await userEvent.click(link);
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
    `/api/workspace/crm/data/notifications/${id}/read?workspaceId=${workspaceId}`,
    { method: "POST" },
  ));
  expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument();
});

it("never turns a notification destination into an external link", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [{ id, subject: "Update", body: "Review", deepLink: "https://example.com", readAt: null, createdAt: "2026-09-17T08:00:00Z" }] })));
  render(<WorkspaceNotifications workspaceId={workspaceId} />);
  await userEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
  expect(screen.queryByRole("link", { name: /Update/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Update/ })).toBeInTheDocument();
});
