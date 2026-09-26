import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

describe("site, room by room", () => {
  it("shows each room with its photos, measurements and issues", () => {
    renderSite();
    const kitchen = screen.getByRole("region", { name: "Kitchen" });
    expect(kitchen).toHaveTextContent("1 photo");
    expect(kitchen).toHaveTextContent("Measured");
    expect(kitchen).toHaveTextContent("1 issue");
    expect(kitchen).toHaveTextContent("Wall A 4.2 m");
    expect(kitchen).toHaveTextContent("Ceiling height 2.9 m");
    expect(within(kitchen).getByText("Marked")).toBeInTheDocument();
    expect(within(kitchen).getByRole("button", { name: "Edit measurements" })).toBeInTheDocument();
    expect(within(kitchen).getByRole("button", { name: /Crack above window/ })).toHaveTextContent("Open");
  });

  it("asks for photos in empty rooms and keeps plans under the whole project, without room measurements", () => {
    renderSite();
    const bedroom = screen.getByRole("region", { name: "Master bedroom" });
    expect(bedroom).toHaveTextContent("Not measured");
    expect(within(bedroom).getByRole("button", { name: /Add photos of every wall/ })).toBeInTheDocument();
    const whole = screen.getByRole("region", { name: "Whole project" });
    expect(whole).toHaveTextContent("plan.pdf");
    expect(within(whole).queryByRole("button", { name: "Measure" })).not.toBeInTheDocument();
    expect(whole).not.toHaveTextContent("Not measured");
  });

  it("starts a room's measurements with its walls and ceiling height", () => {
    expect(roomDimensions().map((d) => d.name)).toEqual(["Wall A", "Wall B", "Wall C", "Wall D", "Ceiling height"]);
    expect(new Set(roomDimensions().map((d) => d.id)).size).toBe(5);
  });
});
