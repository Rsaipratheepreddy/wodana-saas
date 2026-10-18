import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  // The check opens the revision's drawings; sending it back needs what to change.
  expect(within(await screen.findByRole("dialog")).getByRole("link", { name: "Open kitchen.pdf" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Changes needed" }));
  const save = screen.getByRole("button", { name: "Changes needed" });
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: /What needs to change/ }), { target: { value: "Sink wall 40 mm shorter" } });
  fireEvent.click(screen.getByRole("button", { name: "Changes needed" }));
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
  expect(screen.getByText(/Maya Client/).closest("li")).toHaveTextContent("In the client portal");
  expect(screen.queryByRole("button", { name: /Upload|Record|Send/ })).not.toBeInTheDocument();
});

it("PLM-149: shop drawings wait for the technical site measure, recorded with its dimensions; then it reads back with its photos", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const waiting = state({ revisions: [], canUpload: false, canCheck: false, check: "design",
    measure: { required: true, done: false, measures: [], unit: "mm", units: ["mm", "cm", "m", "in", "ft"], canRecord: true } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body && typeof init.body === "string" ? JSON.parse(init.body) : null });
    return { ok: true, json: async () => (url.includes("/drawings") ? waiting : { project: { version: 5 } }) };
  }));
  const user = userEvent.setup();
  const { unmount } = render(<ProjectDrawings workspaceId="w" projectId="p" version={4} />);
  expect(await screen.findByText("Shop drawings start after the technical site measure.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Upload drawings" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Record the technical measure" }));
  const save = await screen.findByRole("button", { name: "Save" });
  expect(save).toBeDisabled();
  await user.type(screen.getByRole("textbox", { name: "Where" }), "Kitchen");
  await user.type(screen.getByRole("textbox", { name: "Dimension" }), "Sink wall width");
  await user.type(screen.getByRole("textbox", { name: "Size" }), "3195");
  await user.tab();
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(calls.some((call) => (call.body as { action?: string } | null)?.action === "record_technical_measure")).toBe(true));
  expect(calls.find((call) => (call.body as { action?: string } | null)?.action === "record_technical_measure")!.body).toMatchObject({
    action: "record_technical_measure", version: 4, measureId: expect.any(String), note: "",
    lines: [{ area: "Kitchen", label: "Sink wall width", value: 3195, unit: "mm" }] });
  unmount();

  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => state({ revisions: [revision({ status: "uploaded" })], check: "design", canCheck: false, canUpload: true,
    measure: { required: true, done: true, unit: "mm", units: ["mm"], canRecord: false, measures: [{ id: "m1", measuredOn: "2026-10-12", note: "Out of plumb", byName: "Faris", at: "2026-10-12T09:00:00Z",
      lines: [{ area: "Kitchen", label: "Sink wall width", value: "3195", unit: "mm" }], files: [{ id: "f9", name: "sketch.pdf", mimeType: "application/pdf", byteSize: 9, hasPreview: false, byName: "Faris", at: "2026-10-12T09:00:00Z" }] }] } }) })));
  render(<ProjectDrawings workspaceId="w" projectId="p" version={4} />);
  expect(await screen.findByText("R1 · Waiting for the design check")).toBeInTheDocument();
  expect(screen.getByText("Sink wall width")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open sketch.pdf" })).toHaveAttribute("href", expect.stringContaining("projects/p/technical-measures/files/f9"));
  // The technical team doesn't check against the design nor record the measure.
  expect(screen.queryByRole("button", { name: /Check against the design|Record the technical measure|Send/ })).not.toBeInTheDocument();
});

it("PLM-057: shows which items need drawings and which already have one, and the team decides per item with the reason", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const items = [
    { lineId: "l1", title: "Kitchen cabinets", area: "Kitchen", catalogItemId: null, catalogId: null, catalogName: null, catalogDrawingUrl: null,
      rule: { needed: true, reason: "bespoke" as const }, needed: true, override: null, version: 1 },
    { lineId: "l2", title: "Sofa 3 seater", area: "Living", catalogItemId: "i2", catalogId: "c1", catalogName: "Harriet sofa", catalogDrawingUrl: "https://drive.example.com/harriet.pdf",
      rule: { needed: false, reason: "catalogue_drawing" as const }, needed: false, override: null, version: 1 },
  ];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return { ok: true, json: async () => (url.includes("/drawings") ? state({ revisions: [], needed: true, items, canDecideItems: true }) : { project: { version: 5 } }) };
  }));
  render(<ProjectDrawings workspaceId="w" projectId="p" version={4} />);
  expect(await screen.findByText("Kitchen cabinets")).toBeInTheDocument();
  expect(screen.getByText("Bespoke")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Harriet sofa" })).toHaveAttribute("href", "https://drive.example.com/harriet.pdf");
  expect(screen.getByText("1 need drawings")).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Change" })[1]);
  fireEvent.click(await screen.findByRole("radio", { name: "Needed" }));
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: /Why/ }), { target: { value: "Client changed the arm width" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(calls.some((call) => (call.body as { action?: string } | null)?.action === "set_drawing_need")).toBe(true));
  expect(calls.find((call) => (call.body as { action?: string } | null)?.action === "set_drawing_need")!.body)
    .toEqual({ action: "set_drawing_need", version: 4, lineId: "l2", needed: true, reason: "Client changed the arm width" });
});
