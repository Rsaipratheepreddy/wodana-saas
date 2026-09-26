import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { CaseContent, ScopeEntry } from "@/lib/pre-project/content";
import { MoodboardPage } from "./moodboard-page";

afterEach(() => vi.unstubAllGlobals());
const base = { version: 1, roomId: null, roomName: null, note: "", category: "Inspiration", priority: "preferred", scopeStatus: "undecided", reviewStatus: "captured", quantity: null, unit: "nos", referenceUrl: "", avoid: "", source: "team", assets: [], catalogLinks: [], archivedAt: null, requirementIds: [], board: null, createdByName: "Sara Sales" };
const photo = (id: string) => ({ id, name: `${id}.jpg`, mimeType: "image/jpeg", byteSize: 1, hasPreview: true });
const entries = [
  { ...base, id: "p1", kind: "inspiration", title: "Fluted glass wardrobe", referenceUrl: "https://www.instagram.com/p/x/", source: "client", roomId: "r1", requirementIds: ["q1"] },
  { ...base, id: "p2", kind: "inspiration", title: "Glossy white", note: "Too cold", assets: [photo("a1"), photo("a2")], board: { x: 0, y: 0, width: 240, z: 2, sentiment: "avoid" } },
  { ...base, id: "p3", kind: "inspiration", title: "Keep the arch", note: "Keep the arch and light it." },
  { ...base, id: "q1", kind: "requirement", title: "Walk-in wardrobe" },
] as unknown as ScopeEntry[];
const data = { workspaceId: "ws", caseId: "c1", canEdit: true, rooms: [{ id: "r1", name: "Master bedroom" }], entries, brief: { currencyCode: "AED" } } as unknown as CaseContent;
const renderBoard = () => render(<DesignSystemProvider><MoodboardPage initialData={data} clientName="Aisha Al Mansoori" /></DesignSystemProvider>);
const card = (name: string) => screen.getByRole("article", { name });

describe("moodboard", () => {
  it("shows who added each pin by name, its room and the requirements it informs", () => {
    renderBoard();
    const wardrobe = card("Fluted glass wardrobe");
    expect(wardrobe).toHaveTextContent("From Aisha Al Mansoori");
    expect(wardrobe).toHaveTextContent("Master bedroom");
    expect(wardrobe).toHaveTextContent("Walk-in wardrobe");
    expect(wardrobe).toHaveTextContent("Instagram");
    expect(card("Glossy white")).toHaveTextContent("Added by Sara Sales");
    expect(card("Glossy white")).toHaveTextContent("Avoid");
    expect(card("Glossy white")).toHaveTextContent("+1");
  });

  it("filters by feeling and by who added it, and offers to clear an empty result", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("radio", { name: "Avoid" }));
    expect(screen.queryByRole("article", { name: "Fluted glass wardrobe" })).not.toBeInTheDocument();
    expect(card("Glossy white")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Client" }));
    expect(screen.getByText("Nothing matches these filters")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByText("3 pins")).toBeInTheDocument();
  });

  it("opens photos full size and steps between them", async () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "View Glossy white full size" }));
    const viewer = await screen.findByRole("dialog", { name: "Glossy white" });
    expect(viewer).toHaveTextContent("1 / 2");
    fireEvent.click(within(viewer).getByRole("button", { name: "Next photo" }));
    expect(viewer).toHaveTextContent("2 / 2");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Glossy white" })).not.toBeInTheDocument());
  });

  it("marks a pin Love or Avoid from its card and saves the new feeling", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { if (url.includes("moodboard/layout")) bodies.push(JSON.parse(String(init?.body))); return { ok: true, json: async () => ({ saved: 1 }) }; }));
    renderBoard();
    fireEvent.click(within(card("Glossy white")).getByRole("button", { name: "Love" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ pins: [{ entryId: "p2", sentiment: "love" }] });
    expect(within(card("Glossy white")).getByRole("button", { name: "Love" })).toHaveAttribute("aria-pressed", "true");
  });

  it("adds a note pin", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      return { ok: true, json: async () => ({ ...base, ...body, assets: [], catalogLinks: [] }) };
    }));
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Note" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    expect(await screen.findByText("Write the note first.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "No open shelving" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("article", { name: "No open shelving" })).toBeInTheDocument();
    expect(calls.find((call) => call.url.includes("/entries"))!.body).toMatchObject({ kind: "inspiration", title: "No open shelving", requirementIds: [] });
  });
});
