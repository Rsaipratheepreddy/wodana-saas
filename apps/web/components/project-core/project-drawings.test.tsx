import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DrawingRevision, DrawingsState } from "@/lib/project-core/types";
import { ProjectDrawings } from "./project-drawings";

afterEach(() => vi.unstubAllGlobals());

const revision = (over: Partial<DrawingRevision> = {}): DrawingRevision => ({
  id: "r1", number: 1, status: "uploaded", note: "", createdByName: "Tara", createdAt: "2026-10-01T09:00:00.000Z", siteCheck: null, siteCheckNote: "",
  siteCheckedByName: null, siteCheckedAt: null, sentByName: null, sentAt: null, decidedOn: null, decidedByName: null, decisionNote: "", decisionVia: null,
  decisionRecordedByName: null,
  files: [{ id: "f1", kind: "drawing", name: "kitchen.pdf", mimeType: "application/pdf", byteSize: 10, hasPreview: false, byName: "Tara", at: "2026-10-01T09:00:00.000Z" }], ...over,
});
const state = (over: Partial<DrawingsState> = {}): DrawingsState => ({
  revisions: [revision()], version: 4, caseId: "c", inRoute: true, needsSiteCheck: true, canUpload: true, canCheck: true, canSend: false, canDecide: false, ...over,
});

it("PLM-058: the technical site check needs a note when it finds changes, and is sent on the latest revision", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return { ok: true, json: async () => (url.includes("/drawings") ? state() : { project: { version: 5 } }) };
  }));
  const changed = vi.fn();
  render(<ProjectDrawings workspaceId="w" projectId="p" version={4} onChanged={changed} />);
  expect(await screen.findByText("R1 · Waiting for the site check")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "kitchen.pdf" })).toHaveAttribute("href", expect.stringContaining("projects/p/drawings/files/f1"));
  fireEvent.click(screen.getByRole("button", { name: "Record the site check" }));
  fireEvent.click(await screen.findByRole("radio", { name: "Changes needed" }));
  const save = screen.getByRole("button", { name: "Save" });
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: /What needs changing/ }), { target: { value: "Sink wall 40 mm shorter" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(calls.some((call) => call.body && (call.body as { action?: string }).action === "check_drawings")).toBe(true));
  expect(calls.find((call) => (call.body as { action?: string } | null)?.action === "check_drawings")!.body)
    .toEqual({ action: "check_drawings", version: 4, revisionId: "r1", result: "changes", note: "Sink wall 40 mm shorter" });
  await waitFor(() => expect(changed).toHaveBeenCalled());
});

it("PLM-059: the project manager sends checked drawings and records the client's approval; the factory only reads", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => state({ revisions: [revision({ status: "sent", siteCheck: "ok", sentAt: "2026-10-02T09:00:00.000Z", sentByName: "Omar" })],
    canUpload: false, canCheck: false, canDecide: true }) })));
  const { unmount } = render(<ProjectDrawings workspaceId="w" projectId="p" version={4} />);
  expect(await screen.findByText("R1 · With the client")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Record the client's decision" })).toBeInTheDocument();
  unmount();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => state({ revisions: [revision({ status: "approved", siteCheck: "ok", decidedOn: "2026-10-03",
    decidedByName: "Maya Client", decisionVia: "portal" })], canUpload: false, canCheck: false }) })));
  render(<ProjectDrawings workspaceId="w" projectId="p" version={4} />);
  expect(await screen.findByText("R1 · Approved by the client")).toBeInTheDocument();
  expect(screen.getByText(/Maya Client/)).toHaveTextContent("In the client portal");
  expect(screen.queryByRole("button", { name: /Upload|Record|Send/ })).not.toBeInTheDocument();
});
