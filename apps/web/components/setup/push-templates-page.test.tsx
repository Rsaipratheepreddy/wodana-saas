import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { PushTemplatesPage } from "./push-templates-page";

const workspaceId = "2ab00a25-4912-469a-9081-d8602f2b715a";
const moment = (patch: Record<string, unknown>) => ({ enabled: true, audience: "team", actions: ["open", "review"], ...patch });
const data = { version: "v1", templates: [
  moment({ key: "job_step", label: "A job moves to its next step", title: "{job}", body: "Now: {step} · {chapter} ({done} of {total})", action: "open", variables: ["job", "step", "chapter", "done", "total"],
    sample: { job: "Villa 12 · J-000038", step: "Mood boards", chapter: "Design", done: "14", total: "41" }, kit: { title: "{job}", body: "Now: {step} · {chapter} ({done} of {total})", action: "open" } }),
  moment({ key: "client_waiting", audience: "client", label: "Something waits for the client", title: "Waiting for you", body: "{step}. Tap to see it in your portal.", action: "review", actions: ["review", "open", "pay"],
    variables: ["brand", "step"], sample: { brand: "Studio", step: "Your quotation" }, kit: { title: "Waiting for you", body: "{step}. Tap to see it in your portal.", action: "review" } }),
] };
afterEach(() => vi.unstubAllGlobals());

describe("Settings → Push notifications (§0.3)", () => {
  it("shows each moment's push on a phone, rewords it with its facts, switches one off and saves with the version it read", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === "PUT" ? { version: "v2" } : data }));
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><PushTemplatesPage workspaceId={workspaceId} /></DesignSystemProvider>);
    const preview = await screen.findByRole("region", { name: "Preview" });
    expect(within(preview).getByText("Villa 12 · J-000038")).toBeInTheDocument();
    expect(within(preview).getByText("Now: Mood boards · Design (14 of 41)")).toBeInTheDocument();
    expect(within(preview).getByText("Open")).toBeInTheDocument();
    const title = screen.getByRole("textbox", { name: "Title" });
    await userEvent.clear(title);
    await userEvent.type(title, "{{job} moved on");
    expect(within(preview).getByText("Villa 12 · J-000038 moved on")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Something waits for the client/ }));
    // One moment open at a time: its own phone shows it.
    const client = screen.getByRole("region", { name: "Preview" });
    expect(within(client).getByText("Your quotation. Tap to see it in your portal.")).toBeInTheDocument();
    expect(within(client).getByText("Later")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Send Something waits for the client" }));
    expect(within(client).getByText("Not sent: switched off")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const sent = JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "PUT")![1]!.body));
    expect(sent.version).toBe("v1");
    expect(sent.templates).toEqual([
      { key: "job_step", title: "{job} moved on", body: "Now: {step} · {chapter} ({done} of {total})", action: "open", enabled: true },
      { key: "client_waiting", title: "Waiting for you", body: "{step}. Tap to see it in your portal.", action: "review", enabled: false }]);
  });

  it("says why a save was refused and keeps the edit", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => init?.method === "PUT"
      ? { ok: false, json: async () => ({ message: "\"A job moves to its next step\" can use {job}, {step}, {chapter}, {done}, {total}, not {client}." }) }
      : { ok: true, json: async () => data }));
    render(<DesignSystemProvider><PushTemplatesPage workspaceId={workspaceId} /></DesignSystemProvider>);
    await userEvent.type(await screen.findByRole("textbox", { name: "Title" }), " {{client}");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/not \{client\}/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("{job} {client}");
  });
});
