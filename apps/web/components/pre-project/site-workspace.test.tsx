import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { CaseContent, ScopeEntry } from "@/lib/pre-project/content";
import type { SiteData } from "@/lib/pre-project/site";
import { roomDimensions, SiteWorkspace } from "./site-workspace";

const img = (id: string) => ({ id, name: `${id}.jpg`, mimeType: "image/jpeg", byteSize: 1, hasPreview: true });
const file = (id: string, title: string, roomId: string | null, assets: unknown[]) => ({ id, version: 1, kind: "file", title, roomId, note: "", category: "Site", priority: "preferred", scopeStatus: "included", reviewStatus: "captured", quantity: null, unit: "nos", referenceUrl: "", avoid: "", source: "team", assets, catalogLinks: [], archivedAt: null });
const data = { workspaceId: "ws", caseId: "c1", canEdit: true, rooms: [{ id: "r1", name: "Kitchen", version: 1 }, { id: "r2", name: "Master bedroom", version: 1 }],
  entries: [file("f1", "Wall A", "r1", [img("m1"), img("a1")]), file("f2", "Floor plan", null, [{ id: "p1", name: "plan.pdf", mimeType: "application/pdf", byteSize: 1, hasPreview: false }])] as unknown as ScopeEntry[] } as unknown as CaseContent;
const dim = (name: string, measured: number) => ({ id: name, name, unit: "m", basis: "site_opening", approximate: null, measured, source: "team", evidence: "" });
const site = { timezone: "UTC", members: [], canVerify: true, items: [
  { id: "ms1", version: 1, kind: "measurement", title: "Kitchen", note: "", status: "measured", roomId: "r1", entryId: null, assetIds: [], assets: [], dimensions: [dim("Wall A", 4.2), dim("Ceiling height", 2.9)] },
  { id: "o1", version: 1, kind: "observation", title: "Crack above window", note: "Fill before paint", status: "open", roomId: "r1", entryId: null, assetIds: [], assets: [] },
] } as unknown as SiteData;
const renderSite = () => render(<DesignSystemProvider><SiteWorkspace initialData={data} initialSite={site} /></DesignSystemProvider>);

describe("site, a card per room", () => {
  it("shows each room as a card: its state, key dimensions, photos and issues, with quick actions", () => {
    renderSite();
    const kitchen = screen.getByRole("article", { name: "Kitchen" });
    expect(kitchen).toHaveTextContent("Awaiting verification");
    expect(kitchen).toHaveTextContent("Wall A 4.2 m · Ceiling height 2.9 m");
    expect(kitchen).toHaveTextContent("Photos1");
    expect(kitchen).toHaveTextContent("Issues1 open");
    expect(within(kitchen).getByRole("button", { name: "View Kitchen" })).toBeInTheDocument();
    expect(within(kitchen).getByRole("button", { name: "Edit measurements of Kitchen" })).toBeInTheDocument();
    expect(within(kitchen).getByRole("button", { name: "Add photos to Kitchen" })).toBeInTheDocument();
    expect(within(kitchen).getByRole("button", { name: "Open Wall A" })).toBeInTheDocument();
  });

  it("opens a room's sheet with its details, photos and notes, and edits from there with the existing form", async () => {
    renderSite();
    fireEvent.click(within(screen.getByRole("article", { name: "Kitchen" })).getByRole("button", { name: "View Kitchen" }));
    const sheet = await screen.findByRole("dialog", { name: "Kitchen" });
    expect(sheet).toHaveTextContent("Ceiling height");
    expect(sheet).toHaveTextContent("2.9 m");
    fireEvent.click(within(sheet).getByRole("tab", { name: /Photos/ }));
    expect(await within(sheet).findByText("Marked")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("tab", { name: /Notes/ }));
    expect(await within(sheet).findByRole("button", { name: /Crack above window/ })).toHaveTextContent("Open");
    fireEvent.click(within(sheet).getByRole("button", { name: "Edit measurements" }));
    expect(await screen.findByRole("dialog", { name: "Edit measurements" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Kitchen" })).not.toBeInTheDocument());
  });

  it("lists only rooms with something captured, and keeps roomless files apart without room measurements", () => {
    renderSite();
    expect(screen.queryByRole("article", { name: "Master bedroom" })).not.toBeInTheDocument();
    const loose = screen.getByRole("article", { name: "Not in a room" });
    expect(within(loose).getByRole("button", { name: "Open Floor plan" })).toBeInTheDocument();
    expect(within(loose).queryByRole("button", { name: /Measure|Edit measurements/ })).not.toBeInTheDocument();
    expect(loose).not.toHaveTextContent("Not measured");
  });

  it("starts empty and adds rooms from the catalog, not a pre-filled list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ items: [{ id: "k9", name: "Guest bathroom", catalogName: "Rooms" }] }) })));
    render(<DesignSystemProvider><SiteWorkspace initialData={{ ...data, entries: [] }} initialSite={{ ...site, items: [] }} /></DesignSystemProvider>);
    expect(screen.getByText("Nothing captured on site yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add room" }));
    fireEvent.click(await screen.findByRole("button", { name: "Master bedroom" }));
    const bedroom = await screen.findByRole("article", { name: "Master bedroom" });
    expect(within(bedroom).getByRole("button", { name: /Add photos of every wall/ })).toBeInTheDocument();
    expect(bedroom).toHaveTextContent("Not measured");
    expect(within(bedroom).getByRole("button", { name: "Measure Master bedroom" })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("starts a room's measurements with its walls and ceiling height", () => {
    expect(roomDimensions().map((d) => d.name)).toEqual(["Wall A", "Wall B", "Wall C", "Wall D", "Ceiling height"]);
    expect(new Set(roomDimensions().map((d) => d.id)).size).toBe(5);
  });
});
