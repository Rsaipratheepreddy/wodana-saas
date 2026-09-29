import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translatorFor } from "@/lib/i18n/keys";
import { channelState, failureReason, nextStep, type ChannelHealth, type DeliveryHealth } from "@/lib/workspace/delivery-health";
import { DeliveryAttention } from "./delivery-attention";
import { DeliveryHealthPage } from "./delivery-health-page";
import { WorkspaceNotifications } from "./workspace-notifications";

const workspaceId = "e56299c6-3da3-402a-a9ac-3995bb37b9d4";
const t = translatorFor({});
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const channel = (overrides: Partial<ChannelHealth>): ChannelHealth => ({
  channel: "email", configured: true, teamEmail: true, clientEmail: true, lastSuccessAt: minutesAgo(5), lastFailure: null,
  queued24h: 0, failed24h: 0, waiting: 0, oldestWaitingAt: null, ...overrides,
});
const health = (overrides: Partial<DeliveryHealth> = {}): DeliveryHealth => ({
  generatedAt: new Date().toISOString(),
  worker: { status: "ok", lastSeenAt: minutesAgo(0), delivery: "live" },
  allowlist: false,
  channels: [
    channel({ lastFailure: { at: minutesAgo(1), code: "MAILGUN_HTTP_401", message: null }, failed24h: 2 }),
    channel({ channel: "whatsapp", configured: false, connection: null, lastSuccessAt: null }),
    channel({ channel: "push", configured: true, devices: 3 }),
  ],
  attention: { reason: null, since: null },
  ...overrides,
});

afterEach(() => vi.unstubAllGlobals());

describe("delivery health rules", () => {
  it("names each channel's state and the owner's next step", () => {
    const ok = { worker: { status: "ok" as const, lastSeenAt: null, delivery: "live" } };
    expect(channelState(channel({}), ok)).toBe("working");
    expect(channelState(channel({ configured: false }), ok)).toBe("not-set-up");
    expect(channelState(channel({ lastFailure: { at: minutesAgo(1), code: "x", message: null } }), ok)).toBe("failing");
    expect(channelState(channel({ waiting: 4, oldestWaitingAt: minutesAgo(30) }), ok)).toBe("waiting");
    expect(channelState(channel({ waiting: 1 }), { worker: { status: "not-reporting", lastSeenAt: null, delivery: null } })).toBe("failing");
    expect(nextStep(t, channel({ teamEmail: false, configured: false }), "not-set-up")?.text).toBe("Email isn't set up. Ask support to turn on email sending.");
    expect(nextStep(t, channel({ channel: "whatsapp", configured: false, connection: null }), "not-set-up")).toEqual({ text: "Connect WhatsApp in Connections.", href: "/workspace/integrations" });
    expect(nextStep(t, channel({}), "working")).toBeNull();
    expect(failureReason(t, { at: "", code: "MAILGUN_HTTP_401", message: null })).toBe("The email service refused the sending credentials");
    expect(failureReason(t, { at: "", code: "destination_missing", message: null })).toBe("No address or phone on file");
    expect(failureReason(t, { at: "", code: "SOMETHING", message: "Provider said no" })).toBe("Provider said no");
  });
});

describe("Settings → Delivery", () => {
  it("shows each channel with its state, facts and next step, and sends the owner a test", async () => {
    const fetcher = vi.fn(async (_input: string, options?: RequestInit) => options?.method === "POST"
      ? { ok: true, json: async () => ({ email: "queued", push: "queued" }) }
      : { ok: true, json: async () => health() });
    vi.stubGlobal("fetch", fetcher);
    render(<DeliveryHealthPage workspaceId={workspaceId} />);
    expect(await screen.findByRole("heading", { name: "Delivery" })).toBeInTheDocument();
    expect(screen.getByText("Not delivering")).toBeInTheDocument();
    expect(screen.getByText(/Last failed .*: The email service refused the sending credentials/)).toBeInTheDocument();
    expect(screen.getByText(/2 not delivered in 24 hours/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect WhatsApp in Connections." })).toHaveAttribute("href", "/workspace/integrations");
    expect(screen.getByText(/3 phones/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send me a test" }));
    await waitFor(() => expect(screen.getByText("Test sent to your email and phone.")).toBeInTheDocument());
    const post = fetcher.mock.calls.find(([, options]) => options?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toHaveProperty("requestId");
  });

  it("says plainly when messages aren't going out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => health({ worker: { status: "stale", lastSeenAt: minutesAgo(30), delivery: "live" } }) })));
    render(<DeliveryHealthPage workspaceId={workspaceId} />);
    expect(await screen.findByText("Messages aren't going out")).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been sent since/)).toBeInTheDocument();
  });
});

describe("the bell", () => {
  it("tells the people who run delivery which notices aren't going out, and since when", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => ({ ok: true, json: async () => String(input).includes("delivery-health") ? health() : [] })));
    render(<WorkspaceNotifications workspaceId={workspaceId} />);
    await userEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(await screen.findByText(/Email notices not delivered since/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open delivery" })).toHaveAttribute("href", "/workspace/settings/delivery");
  });

  it("shows nothing about delivery to people without access to it", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => String(input).includes("delivery-health") ? { ok: false, json: async () => ({ message: "Forbidden" }) } : { ok: true, json: async () => [] }));
    render(<WorkspaceNotifications workspaceId={workspaceId} />);
    await userEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    await screen.findByText("No notifications yet");
    expect(screen.queryByText(/not delivered/)).not.toBeInTheDocument();
  });
});

describe("the owner's Home banner", () => {
  it("appears only when delivery needs attention", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => health({ attention: { reason: "worker", since: minutesAgo(10) } }) })));
    const { unmount } = render(<DeliveryAttention workspaceId={workspaceId} />);
    expect(await screen.findByText("Messages aren't going out")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open delivery" })).toHaveAttribute("href", "/workspace/settings/delivery");
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ message: "Forbidden" }) })));
    const { container } = render(<DeliveryAttention workspaceId={workspaceId} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
