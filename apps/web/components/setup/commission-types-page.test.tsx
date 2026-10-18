import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { CommissionTypesPage } from "./commission-types-page";

const workspaceId = "2ab00a25-4912-469a-9081-d8602f2b715a";
const kit = { types: [{ code: "sales", label: "Sales" }, { code: "designer", label: "Designer fee" }, { code: "referral", label: "Referral" }], version: "v1", fromKit: true };
afterEach(() => vi.unstubAllGlobals());

describe("Settings → Commissions (§0.3 P3)", () => {
  it("starts from the kit's three, renames, adds and removes a type, and saves with the version it read", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === "PUT"
      ? { types: [{ code: "sales", label: "Sales" }, { code: "designer", label: "Design fee" }, { code: "project_management_fee", label: "Project management fee" }], version: "v2", fromKit: false }
      : kit }));
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><CommissionTypesPage workspaceId={workspaceId} /></DesignSystemProvider>);
    const second = await screen.findByRole("textbox", { name: "Commission type 2" });
    await userEvent.clear(second);
    await userEvent.type(second, "Design fee");
    await userEvent.click(screen.getByRole("button", { name: "Remove Referral" }));
    await userEvent.click(screen.getByRole("button", { name: "Add a type" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Commission type 3" }), "Project management fee");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const put = fetcher.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({ version: "v1", types: [{ code: "sales", label: "Sales" }, { code: "designer", label: "Design fee" }, { label: "Project management fee" }] });
  });

  it("says why a save was refused (someone changed the list) and keeps the edit", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "PUT"
      ? { ok: false, json: async () => ({ message: "The commission types changed in another window. Reload and try again." }) }
      : { ok: true, json: async () => kit });
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><CommissionTypesPage workspaceId={workspaceId} /></DesignSystemProvider>);
    await userEvent.type(await screen.findByRole("textbox", { name: "Commission type 1" }), " team");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The commission types changed in another window. Reload and try again.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Commission type 1" })).toHaveValue("Sales team");
  });
});
