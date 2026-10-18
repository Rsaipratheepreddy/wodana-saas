import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { HandoverPack, HandoverState } from "@/lib/site/types";
import { ProjectHandover } from "./project-handover";

const PID = "0c6b0c7e-4c4d-4a9e-9d64-3b6f0f2d7a11";
const pack = (patch: Partial<HandoverPack> = {}): HandoverPack => ({
  id: "k1", revision: 1, title: "Kitchen handover", areaIds: ["a1"], status: "draft", replacesId: null, contentHash: null, issuedAt: null, issuedByName: null, decidedOn: null, decidedByName: null,
  decisionMethod: null, decisionNote: "", version: 2, documents: [{ id: "d1", kind: "warranty", title: "Hinge warranty", name: "warranty.pdf", size: 120, sha256: "a".repeat(64) }], ...patch,
});
const state = (patch: Partial<HandoverState> = {}): HandoverState => ({ packs: [pack()], areas: [{ id: "a1", name: "Kitchen" }, { id: "a2", name: "Bedroom" }], covered: false, canManage: true, open: { stages: [], snags: [] }, ...patch });
const mount = (respond: (url: string, init?: RequestInit) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, status: 200, json: async () => respond(url, init) }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const posts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST" && typeof init.body === "string").map(([, init]) => JSON.parse(String(init!.body)));
const uploads = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST" && init.body instanceof FormData).map(([url]) => String(url));
const handover = () => render(<DesignSystemProvider><ProjectHandover workspaceId="w" projectId={PID} /></DesignSystemProvider>);

describe("handover", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("gathers documents in a draft pack and issues it", async () => {
    const fetcher = mount(() => state({ checklists: { k1: { purpose: "handover", version: 1, answeredAt: null, answeredBy: null, answers: { meter_readings: null },
      questions: [{ key: "meter_readings", label: "Meter readings at handover", kind: "text", required: true }] } } }));
    handover();
    const packs = await screen.findByRole("list", { name: "Handover packs" });
    expect(within(packs).getByText("R1 · Kitchen handover")).toBeInTheDocument();
    expect(within(packs).getByRole("link", { name: "Hinge warranty" })).toHaveAttribute("href", expect.stringContaining("/handover/documents/d1"));
    await userEvent.type(within(packs).getByRole("textbox", { name: "Title" }), "Oven manual");
    await userEvent.upload(within(packs).getByLabelText("Add a document"), new File(["%PDF"], "oven.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(uploads(fetcher)).toEqual([expect.stringMatching(/\/handover\/k1\/documents\/[0-9a-f-]+\?workspaceId=w&kind=warranty&title=Oven\+manual$/)]));
    await userEvent.click(within(packs).getByRole("button", { name: "Issue" }));
    // §0.3 P3: issuing opens a dialog with the firm's handover checklist; a required question must be answered first.
    const dialog = await screen.findByRole("dialog", { name: "Issue" });
    expect(within(dialog).getByRole("button", { name: "Issue" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Meter readings/ }), "E 10432");
    await userEvent.click(within(dialog).getByRole("button", { name: "Issue" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toEqual({ action: "issue", packId: "k1", version: 2, answers: { meter_readings: "E 10432" } }));
  });

  it("issues a pack with stages or snags still open only after listing them and asking why", async () => {
    const fetcher = mount(() => state({ open: { stages: ["4. Production", "5. Installation"], snags: ["#7 Scratched door (major)"] } }));
    handover();
    const packs = await screen.findByRole("list", { name: "Handover packs" });
    await userEvent.click(within(packs).getByRole("button", { name: "Issue" }));
    const dialog = await screen.findByRole("dialog", { name: "Issue with work still open" });
    expect(dialog).toHaveTextContent("Stages not finished: 4. Production, 5. Installation");
    expect(dialog).toHaveTextContent("Snags open: #7 Scratched door (major)");
    expect(within(dialog).getByRole("button", { name: "Issue anyway" })).toBeDisabled();
    expect(posts(fetcher).some((body) => body.action === "issue")).toBe(false);
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Why hand over with work still open" }), "Client moves in Monday; snag fixed under warranty");
    await userEvent.click(within(dialog).getByRole("button", { name: "Issue anyway" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toEqual({ action: "issue", packId: "k1", version: 2, answers: {}, confirmOpen: true,
      openReason: "Client moves in Monday; snag fixed under warranty" }));
  });

  it("records the client's acceptance with what's still outstanding, or a refusal with why", async () => {
    const signed = { id: "11111111-1111-4111-8111-111111111111", name: "handover-form.pdf", mimeType: "application/pdf", hasPreview: false, uploadedAt: "2026-09-27T12:30:00Z" };
    const fetcher = mount((url) => (url.startsWith("/api/workspace/evidence") ? signed : state({ packs: [pack({ status: "issued", issuedAt: "2026-09-26T10:00:00Z", contentHash: "b".repeat(64) })] })));
    handover();
    await userEvent.click(await screen.findByRole("button", { name: "Record acceptance" }));
    let dialog = await screen.findByRole("dialog", { name: "Record acceptance" });
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Who decided for the client/ }), "Maya Rahman");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add an item" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Outstanding item" }), "Touch-up paint");
    // A signed form is attached as the client's decision.
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.upload(within(dialog).getByLabelText("Add a photo or PDF"), new File(["%PDF-"], "handover-form.pdf", { type: "application/pdf" }));
    await within(dialog).findByRole("link", { name: "Open handover-form.pdf" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toMatchObject({ action: "accept", packId: "k1", version: 2, decidedByName: "Maya Rahman", method: "signed_document", outstanding: ["Touch-up paint"],
      evidenceFileIds: [signed.id] }));

    await userEvent.click(screen.getByRole("button", { name: "Record refusal" }));
    dialog = await screen.findByRole("dialog", { name: "Record refusal" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Who decided for the client/ }), "Maya Rahman");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why the client refused it/ }), "Doors misaligned");
    // Told in person: no file is needed.
    await userEvent.click(within(dialog).getByRole("button", { name: /How/ }));
    await userEvent.click(await screen.findByRole("option", { name: "In person" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toMatchObject({ action: "refuse", reason: "Doors misaligned" }));
  });

  it("creates a pack for chosen areas", async () => {
    const fetcher = mount(() => state({ packs: [] }));
    handover();
    await userEvent.click(await screen.findByRole("button", { name: "New pack" }));
    const dialog = await screen.findByRole("dialog", { name: "New pack" });
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Kitchen" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toMatchObject({ action: "create_pack", title: "Handover", areaIds: ["a1"] }));
  });
});
