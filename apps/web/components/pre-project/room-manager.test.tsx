import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { CaseContent, CaseRoom } from "@/lib/pre-project/content";
import { RoomManager } from "./room-manager";

afterEach(() => vi.unstubAllGlobals());
const data = { workspaceId: "ws", caseId: "c1", canEdit: true, rooms: [{ id: "r1", name: "Kitchen", version: 1, catalogRecordId: "k1" }] } as unknown as CaseContent;
const catalogs = (items: unknown[]) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ items }) })));
const open = (onSave = vi.fn(async (room: CaseRoom) => ({ ...room, version: 1 }))) => { render(<DesignSystemProvider><RoomManager data={data} onClose={() => undefined} onSave={onSave} /></DesignSystemProvider>); return onSave; };

describe("project rooms", () => {
  it("lists catalog rooms from every catalog once, without rooms already in the project", async () => {
    catalogs([{ id: "k1", name: "Kitchen", catalogName: "Rooms" }, { id: "b1", name: "Master bedroom", catalogName: "Rooms" }, { id: "b2", name: "master  bedroom", catalogName: "Imported" }, { id: "l1", name: "Living room", catalogName: "Imported" }]);
    open();
    const list = await screen.findByRole("list", { name: "Rooms from your catalog" });
    expect([...list.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Living room", "Master bedroom"]);
    expect(screen.getByRole("button", { name: "Master bedroom" })).toHaveAttribute("title", "Rooms, Imported");
  });

  it("adds a catalog room in one click, linked to its catalog record", async () => {
    catalogs([{ id: "l1", name: "Living room", catalogName: "Rooms" }]);
    const onSave = open();
    fireEvent.click(await screen.findByRole("button", { name: "Living room" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Living room", catalogRecordId: "l1", version: 0 })));
    expect(await screen.findByText("Every catalog room is already in this project.")).toBeInTheDocument();
  });

  it("adds a custom room when the catalog has none, and suggests the common rooms", async () => {
    catalogs([]);
    const onSave = open();
    expect(await screen.findByText("Suggested rooms")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Living room" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find or type a room" }), { target: { value: "  Prayer   room " } });
    fireEvent.click(screen.getByRole("button", { name: /as a custom room/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Prayer room", catalogRecordId: null })));
  });

  it("does not offer a custom room that already exists", async () => {
    catalogs([]);
    open();
    await screen.findByText("Suggested rooms");
    fireEvent.change(screen.getByRole("searchbox", { name: "Find or type a room" }), { target: { value: "kitchen" } });
    expect(screen.queryByRole("button", { name: /as a custom room/ })).not.toBeInTheDocument();
  });
});
