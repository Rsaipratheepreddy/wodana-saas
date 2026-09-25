import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrmAutomations } from "./crm-automations";

vi.mock("next/font/google", () => ({ Caveat: () => ({ variable: "note-font" }) }));
vi.mock("./crm-flow-canvas", () => ({ CrmFlowCanvas: () => null }));

const workspaceId = "d004d45c-7140-4b0c-a68d-e87d012c2390";
const data = {
  canView: true,
  id: "automations" as const,
  items: [],
  nextCursor: null,
  referenceTime: "2026-09-16T12:00:00.000Z",
  supporting: {},
  workspaceId,
};

afterEach(() => vi.unstubAllGlobals());

describe("CRM notification controls", () => {
  it("loads policy and template controls only when the notifications tab is opened", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetcher);

    render(<CrmAutomations initialData={data} />);
    expect(fetcher).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: "Notifications" }));

    expect(await screen.findByRole("button", { name: "New policy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Message templates" })).toBeInTheDocument();
    await waitFor(() => expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
      expect.stringContaining("notification-policies"),
      expect.stringContaining("notification-templates"),
    ])));
  });

  it("opens a concise policy form with explicit delivery channels", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<CrmAutomations initialData={data} />);

    await user.click(screen.getByRole("tab", { name: "Notifications" }));
    await user.click(await screen.findByRole("button", { name: "New policy" }));

    const dialog = await screen.findByRole("dialog", { name: "New notification policy" });
    expect(within(dialog).getByRole("textbox", { name: /Channels/ })).toHaveValue("in_app");
  });
});
