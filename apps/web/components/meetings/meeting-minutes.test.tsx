import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { MinutesState } from "@/lib/meetings/client";
import { MeetingMinutes } from "./meeting-minutes";

afterEach(() => vi.unstubAllGlobals());

const base: MinutesState = {
  meeting: { activityId: "a1", title: "Kick-off meeting", type: "meeting", status: "completed", startsAt: "2026-10-13T09:00:00.000Z", endsAt: "2026-10-13T10:00:00.000Z", clientName: "Maya" },
  minutes: null, revisions: [], comments: [], files: [], problem: null, canWrite: true, portal: { caseId: "c1", enabled: true, shown: true, contacts: 1 },
};
const written: MinutesState = { ...base,
  minutes: { id: "m1", title: "Kick-off", body: "Render sign-off agreed for 20 Oct.", fileIds: [], revision: 2, sharedAt: "2026-10-13T11:00:00.000Z", sharedRevision: 2, authorName: "Lina",
    createdAt: "2026-10-13T10:30:00.000Z", updatedAt: "2026-10-13T11:00:00.000Z", updatedByName: "Lina", version: 2 },
  revisions: [{ revision: 2, title: "Kick-off", body: "Render sign-off agreed for 20 Oct.", fileIds: [], shared: true, byName: "Lina", at: "2026-10-13T11:00:00.000Z" },
    { revision: 1, title: "Kick-off", body: "Draft", fileIds: [], shared: false, byName: "Lina", at: "2026-10-13T10:30:00.000Z" }],
  comments: [{ id: "k1", at: "2026-10-13T12:00:00.000Z", text: "Can we move it to 22 Oct?", fromClient: true, author: "Maya" }] };
const show = () => render(<DesignSystemProvider locale="en-GB" timeZone="UTC"><MeetingMinutes workspaceId="w1" activityId="a1" /></DesignSystemProvider>);

describe("PLM-153: the minutes of a client meeting", () => {
  it("are written on the meeting and shared with the client by default; the save goes with the version seen", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      return { ok: true, json: async () => (init?.method === "PUT" ? { ...written, told: { queued: 1, reason: null } } : base) };
    }));
    const user = userEvent.setup();
    show();
    expect(await screen.findByText("No minutes yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Write minutes" }));
    expect(screen.getByRole("textbox", { name: /Title/ })).toHaveValue("Kick-off meeting");
    expect(screen.getByRole("switch", { name: "Share with the client" })).toBeChecked();
    await user.type(screen.getByRole("textbox", { name: /^Minutes/ }), "Render sign-off agreed for 20 Oct.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    expect(calls.find((call) => call.method === "PUT")).toMatchObject({ url: expect.stringContaining("/api/meetings/a1/minutes?workspaceId=w1"),
      body: { minutesId: expect.any(String), version: 0, title: "Kick-off meeting", body: "Render sign-off agreed for 20 Oct.", fileIds: [], shared: true } });
    expect(await screen.findByText("Shared. The client was told by email.")).toBeInTheDocument();
    expect(screen.getByText("Shared with the client")).toBeInTheDocument();
    expect(screen.getByText("Can we move it to 22 Oct?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 earlier version" })).toBeInTheDocument();
  });

  it("answer the client's comment, and say when the client can't see them yet", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      return { ok: true, json: async () => ({ ...written, portal: { caseId: "c1", enabled: true, shown: true, contacts: 0 } }) };
    }));
    const user = userEvent.setup();
    show();
    expect(await screen.findByText("Nobody on the client's side has portal access yet. They'll see them once invited.")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Reply to the client" }), "Yes, 22 Oct works.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls.some((call) => call.url.includes("/minutes/replies"))).toBe(true));
    expect(calls.find((call) => call.url.includes("/minutes/replies"))!.body).toEqual({ commentId: expect.any(String), text: "Yes, 22 Oct works." });
  });

  it("can't be written on a cancelled meeting, nor by someone who only reads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...base, meeting: { ...base.meeting, status: "cancelled" }, problem: "This meeting was cancelled." }) })));
    const { unmount } = show();
    expect(await screen.findByText("This meeting was cancelled.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Write minutes" })).toBeNull();
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...written, canWrite: false }) })));
    show();
    expect(await screen.findByText("Render sign-off agreed for 20 Oct.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit minutes" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Reply to the client" })).toBeNull();
  });
});
