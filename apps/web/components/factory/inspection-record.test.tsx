import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { InspectionState } from "@/lib/factory/types";
import { InspectionRecord } from "./inspection-record";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/workspace/inspections/i1", useSearchParams: () => new URLSearchParams() }));

const inspection = (patch: Partial<InspectionState["row"]> = {}, extra: Partial<InspectionState> = {}): InspectionState => ({
  row: { id: "i1", workOrderId: "w1", projectId: "p1", stage: "final", round: 1, status: "due", dueOn: "2099-10-20", requestedAt: "2026-10-13T08:00:00Z", requestedByName: "Mo Maker",
    requestedByMe: false, inspectorMembershipId: "m1", inspectorName: "Dana Designer", inspectorRole: "designer", resultByName: null, resultAt: null, comments: "", version: 1, number: 7,
    title: "Wardrobe", specification: "Walnut veneer", quantity: "1.0000", unit: "nos", orderStatus: "ready", projectReference: "PRJ-0007", projectName: "Villa 12", projectStatus: "active", ...patch },
  photos: [], snags: [], rounds: [{ id: "i1", stage: "final", round: 1, status: "due", dueOn: "2099-10-20", resultAt: null, resultByName: null, comments: "", snags: 0 }],
  stages: [{ kind: "raw", label: "" }, { kind: "final", label: "" }], managers: ["Omar Manager"], canRecord: true, why: null, canSeeFactory: false, ...extra,
});

const mount = (respond: (url: string, init?: RequestInit) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const value = respond(url, init);
    return value instanceof Error ? { ok: false, status: 409, json: async () => ({ message: value.message }) } : { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const posts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST" && typeof init.body === "string")
  .map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init!.body)) }));
const page = () => render(<DesignSystemProvider><InspectionRecord workspaceId="w" inspectionId="i1" /></DesignSystemProvider>);

describe("design inspection record (PLM-150)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lets the designer take photos and fail it with the snag lines for the factory", async () => {
    let current = inspection();
    const fetcher = mount((url, init) => {
      if (init?.body instanceof FormData) { current = inspection({ version: 2 }, { photos: [{ id: "ph1", name: "door.jpg", byName: "Dana Designer", at: "2026-10-13T09:00:00Z" }] }); return current; }
      if (init?.method === "POST") { current = inspection({ status: "failed", version: 3, resultByName: "Dana Designer", resultAt: "2026-10-13T09:10:00Z", comments: "Veneer lifting" }, {
        snags: [{ id: "s1", number: 12, title: "Veneer lifting on the left door", severity: "major", status: "todo", dueDate: "2099-10-22", assigneeName: "Mo Maker", inspectionId: "i1" }] });
        return current; }
      return current;
    });
    page();
    expect(await screen.findByRole("heading", { level: 1, name: "Inspection 2 · Wardrobe" })).toBeInTheDocument();
    const step = screen.getByRole("status", { name: "Next step" });
    expect(step).toHaveTextContent("Inspect it by");
    expect(step).toHaveTextContent("Omar Manager may attend");
    expect(screen.getByRole("button", { name: "Pass" })).toBeInTheDocument();
    // Failing needs a photo first.
    await userEvent.click(within(step).getByRole("button", { name: "Fail" }));
    let dialog = await screen.findByRole("dialog", { name: "Fail Inspection 2" });
    expect(within(dialog).getByText("Add a photo of what's wrong first.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Fail" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    const file = new File(["x"], "door.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText("Add a photo"), file);
    await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => String(url).includes("/inspections/i1/photos/") && init?.body instanceof FormData)).toBe(true));
    expect(await screen.findByRole("link", { name: "Open door.jpg" })).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("status", { name: "Next step" })).getByRole("button", { name: "Fail" }));
    dialog = await screen.findByRole("dialog", { name: "Fail Inspection 2" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /What's wrong/ }), "Veneer lifting");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Snag 1" }), "Veneer lifting on the left door");
    await userEvent.click(within(dialog).getByRole("button", { name: "Fail" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "fail", version: 2, comments: "Veneer lifting",
      snags: [{ title: "Veneer lifting on the left door", severity: "major" }] }));
    expect(await screen.findByRole("link", { name: "#12 Veneer lifting on the left door" })).toHaveAttribute("href", "/workspace/projects/p1/plan?item=s1");
    expect(screen.getByRole("status", { name: "Next step" })).toHaveTextContent("1 snag for the factory to fix");
    expect(screen.queryByRole("button", { name: "Pass" })).toBeNull();
  });

  it("passes it with an optional comment", async () => {
    let current = inspection();
    const fetcher = mount((_url, init) => {
      if (init?.method === "POST") current = inspection({ status: "passed", version: 2, resultByName: "Dana Designer", resultAt: "2026-10-13T09:10:00Z" });
      return current;
    });
    page();
    await userEvent.click(await screen.findByRole("button", { name: "Pass" }));
    const dialog = await screen.findByRole("dialog", { name: "Pass Inspection 2" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Pass" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "pass", version: 1, comments: "" }));
    expect(await screen.findByText("It can go to site.")).toBeInTheDocument();
  });

  it("tells the factory person who marked it ready that the design team records it", async () => {
    mount(() => inspection({ requestedByMe: true }, { canRecord: false, why: "The factory marked it ready: someone in the design team records the inspection.", canSeeFactory: true }));
    page();
    expect(await screen.findByText("You marked it ready: someone in the design team records the inspection.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pass" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Fail" })).toBeNull();
    expect(screen.getByRole("link", { name: "WO-0007" })).toHaveAttribute("href", "/workspace/factory/orders?order=w1");
  });
});
