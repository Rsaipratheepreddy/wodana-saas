import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { SaveToProject } from "./save-to-project";

const WORKSPACE = "11111111-1111-4111-8111-111111111111", CHAT = "22222222-2222-4222-8222-222222222222", FILE = "33333333-3333-4333-8333-333333333333", CASE = "44444444-4444-4444-8444-444444444444";

afterEach(() => vi.unstubAllGlobals());

describe("Save to project (IN-18)", () => {
  it("files a client's photo into their only project", async () => {
    const fetcher = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (String(url).includes("save-targets") ? { items: [{ caseId: CASE, title: "Villa 12", projectReference: "P-12" }] } : { saved: true }) }));
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><SaveToProject workspaceId={WORKSPACE} conversationId={CHAT} attachmentId={FILE} name="site.jpg" /></DesignSystemProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Save to project" }));
    await screen.findByRole("dialog", { name: "Save site.jpg to a project" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved to the project")).toBeInTheDocument();
    const save = fetcher.mock.calls.find(([url]) => String(url).includes(`/attachments/${FILE}/save`)) as unknown as [string, RequestInit];
    expect(JSON.parse(String(save[1].body))).toMatchObject({ caseId: CASE, fileId: expect.any(String) });
  });
});
