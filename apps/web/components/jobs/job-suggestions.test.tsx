import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { JobSuggestions } from "./job-suggestions";

const workspaceId = "2ab00a25-4912-469a-9081-d8602f2b715a";
const jobId = "11111111-1111-4111-8111-111111111111";
const nudge = { id: "22222222-2222-4222-8222-222222222222", kind: "nudge_owner", title: "Nudge Sam Sales", text: "Proposal 1 sent is 3 days past its date.", source: "The step's due date and owner",
  confidence: 0.9, version: 1, action: { type: "thread_message", body: "@Sam Sales …" } };
const reminder = { ...nudge, id: "33333333-3333-4333-8333-333333333333", kind: "client_reminder", title: "Remind the client", text: "A short reminder.", confidence: 0.6,
  action: { type: "copy", body: "Hi Layla, a quick reminder." } };

afterEach(() => vi.unstubAllGlobals());

describe("suggestions inside the step now (§0.3 P11)", () => {
  it("shows each suggestion with its source and how sure it is; Use acts in one click and Copy only copies", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => (init?.method === "POST" ? {} : { items: [nudge, reminder] }) }));
    vi.stubGlobal("fetch", fetcher);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<DesignSystemProvider><JobSuggestions workspaceId={workspaceId} jobId={jobId} /></DesignSystemProvider>);
    expect(await screen.findByText("Nudge Sam Sales")).toBeInTheDocument();
    expect(screen.getByText("90% sure")).toBeInTheDocument();
    expect(screen.getAllByText("Suggested")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Use" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sent to the job chat."));
    const post = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toContain(`/suggestions/${nudge.id}`);
    expect(JSON.parse(String(post[1]!.body))).toEqual({ action: "use", version: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Hi Layla, a quick reminder."));
    expect(screen.queryByText("Remind the client")).not.toBeInTheDocument();
  });

  it("shows nothing when there is nothing to suggest (or AI is off)", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) }));
    vi.stubGlobal("fetch", fetcher);
    const { container } = render(<DesignSystemProvider><JobSuggestions workspaceId={workspaceId} jobId={jobId} /></DesignSystemProvider>);
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(container.querySelector(".wd-job-suggestions")).toBeNull();
  });
});
