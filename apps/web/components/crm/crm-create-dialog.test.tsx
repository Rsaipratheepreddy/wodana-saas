import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider, WorkspaceRegionProvider } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { CrmCreateDialog } from "./crm-record-workbench";

vi.mock("@/lib/crm/client", async (original) => ({ ...await original<object>(), crmRequest: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/font/google", () => ({ Caveat: () => ({ variable: "note-font" }) }));

const workspaceId = "11111111-1111-4111-8111-111111111111";
const view = (workspace = workspaceId) => render(<WorkspaceRegionProvider currency="AED" locale="en-AE" timeZone="Asia/Dubai"><DesignSystemProvider>
  <CrmCreateDialog id="customers" workspaceId={workspace} onClose={vi.fn()} onSaved={vi.fn()} />
</DesignSystemProvider></WorkspaceRegionProvider>);

afterEach(() => { vi.mocked(crmRequest).mockReset(); vi.unstubAllGlobals(); });

describe("new client", () => {
  it("warns under the phone when someone is already a client, without blocking the save", async () => {
    vi.mocked(crmRequest).mockImplementation(async (_workspace, path) => String(path).startsWith("leads/contact-match")
      ? { valid: true, message: null, matches: [{ partyId: "p1", name: "Sara Khan", mobile: "+971501234567", email: null, leadId: null, reference: null, status: null, receivedAt: null, open: false, ownerName: null }] }
      : { id: "new" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ enabled: false, available: false }) })));
    const user = userEvent.setup();
    view();
    const dialog = await screen.findByRole("dialog", { name: "Add client" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Sara K");
    await user.type(within(dialog).getByRole("textbox", { name: "Phone" }), "050 123 4567");
    const notice = await within(dialog).findByRole("status");
    expect(notice).toHaveTextContent("Already a client: Sara Khan");
    expect(within(notice).getByRole("link", { name: "Sara Khan" })).toHaveAttribute("href", "/workspace/crm/customers?record=p1");
    expect(crmRequest).toHaveBeenCalledWith(workspaceId, expect.stringContaining("mobile=%2B971501234567"), "GET", undefined, expect.anything());
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(crmRequest).toHaveBeenCalledWith(workspaceId, "parties", "POST", expect.objectContaining({ displayName: "Sara K", contacts: [{ type: "phone", value: "+971501234567", isPrimary: true }] })));
  });

  it("offers Fill with Woddy only while AI is on for the workspace", async () => {
    vi.mocked(crmRequest).mockResolvedValue({ valid: true, message: null, matches: [] });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ enabled: true, available: true, version: 1 }) })));
    // Another workspace: whether AI is on is remembered per workspace for a minute.
    view("22222222-2222-4222-8222-222222222222");
    expect(await screen.findByRole("button", { name: "Fill with Woddy" })).toBeInTheDocument();
  });
});
