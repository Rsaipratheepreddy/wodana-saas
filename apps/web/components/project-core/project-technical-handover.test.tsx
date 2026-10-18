import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { HandoverRow, TechnicalHandover } from "@/lib/project-core/technical";
import { ProjectTechnicalHandover } from "./project-technical-handover";

afterEach(() => vi.unstubAllGlobals());

const row = (over: Partial<HandoverRow> = {}): HandoverRow => ({
  lineId: "l1", title: "Wardrobe", code: null, quantity: "1", unit: "pcs", areaName: "Bedroom", catalogItemId: null, catalogId: null, catalogImageId: null, imageAssetId: null, size: "180 × 240 cm",
  drawing: { needed: true, reason: "bespoke", overridden: false }, requirements: "pending",
  cells: { picture: { state: "missing" }, size: { state: "done" }, materials: { state: "done", note: "from_quote" }, selection: { state: "not_needed" } }, waivers: {}, missing: ["picture"], ...over,
});
const pack = (over: Partial<TechnicalHandover> = {}): TechnicalHandover => ({
  status: "handed_over", version: 2, handedOver: { byName: "Sara", at: "2026-10-15T08:00:00.000Z", note: "" }, accepted: null, items: ["picture", "size", "materials", "selection"],
  rows: [row(), row({ lineId: "l2", title: "Sofa", requirements: "verified", cells: { picture: { state: "missing" }, size: { state: "missing" }, materials: { state: "done" }, selection: { state: "not_needed" } }, missing: ["picture", "size"] })],
  missing: 3, requirements: [], caseId: "c", projectVersion: 7, canHandOver: false, canAccept: true, canWaive: true, canSaveRequirements: true, canConfirmRequirements: false, ...over,
});

it("PLM-165: the pack can't be accepted while items are missing; a missing item is marked not applicable with a reason", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => pack() })));
  const run = vi.fn(async () => true);
  render(<ProjectTechnicalHandover workspaceId="w" projectId="p" version={7} run={run} />);
  expect(await screen.findByText("3 missing")).toBeInTheDocument();
  expect(screen.getByText(/Handed over by Sara on/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Review handover" })).toBeDisabled();
  expect(screen.getAllByText("Waiting for the factory lead").length).toBeGreaterThan(0);
  // A Missing chip opens the "not applicable" dialog; the reason is required and travels with the command.
  fireEvent.click(screen.getAllByRole("button", { name: "Fill Picture" })[0]);
  const save = await screen.findByRole("button", { name: "Save" });
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: /Why it doesn't apply/ }), { target: { value: "Client photo on file" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(run).toHaveBeenCalledWith("waive_handover_item", { lineId: "l1", item: "picture", reason: "Client photo on file" }));
});

it("PLM-165: once nothing is missing the technical team accepts the pack, version-checked", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => pack({ missing: 0, rows: [row({ missing: [], waivers: { picture: { reason: "Photo on file", byName: "Tara", at: "2026-10-15T09:00:00.000Z" } } })] }) })));
  const run = vi.fn(async () => true);
  render(<ProjectTechnicalHandover workspaceId="w" projectId="p" version={7} run={run} />);
  expect(await screen.findByText("Nothing missing")).toBeInTheDocument();
  expect(screen.getByText("Not applicable")).toBeInTheDocument();
  // Accepted in a review of every line and what it has (never one click).
  fireEvent.click(screen.getByRole("button", { name: "Review handover" }));
  const review = await screen.findByRole("dialog", { name: "Accept handover" });
  expect(within(review).getByText("Wardrobe")).toBeInTheDocument();
  fireEvent.click(within(review).getByRole("button", { name: "Accept handover" }));
  await waitFor(() => expect(run).toHaveBeenCalledWith("accept_technical_handover", { handoverVersion: 2 }));
});
