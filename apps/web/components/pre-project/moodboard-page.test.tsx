import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { CaseContent, ScopeEntry } from "@/lib/pre-project/content";
import { MoodboardPage } from "./moodboard-page";

afterEach(() => vi.unstubAllGlobals());
const base = { version: 1, roomId: null, roomName: null, note: "", category: "Inspiration", priority: "preferred", scopeStatus: "undecided", reviewStatus: "captured", quantity: null, unit: "nos", referenceUrl: "", avoid: "", source: "team", assets: [], catalogLinks: [], archivedAt: null, requirementIds: [], board: null };
const entries = [
  { ...base, id: "p1", kind: "inspiration", title: "Fluted glass wardrobe", referenceUrl: "https://www.instagram.com/p/x/", source: "client", board: { x: 0, y: 0, width: 240, z: 1, sentiment: "love" } },
  { ...base, id: "p2", kind: "inspiration", title: "Glossy white", note: "Too cold", board: { x: 300, y: 0, width: 240, z: 2, sentiment: "avoid" } },
  { ...base, id: "q1", kind: "requirement", title: "Kitchen cabinets" },
] as unknown as ScopeEntry[];
const data = { workspaceId: "ws", caseId: "c1", canEdit: true, rooms: [], entries, brief: { currencyCode: "AED" } } as unknown as CaseContent;
const renderBoard = () => render(<DesignSystemProvider><MoodboardPage initialData={data} /></DesignSystemProvider>);

describe("moodboard", () => {
  it("shows pins with their platform, feeling and source, and filters by feeling", async () => {
    renderBoard();
    expect(screen.getByRole("button", { name: "Fluted glass wardrobe" })).toHaveTextContent("Instagram");
    expect(screen.getByRole("button", { name: "Fluted glass wardrobe" })).toHaveTextContent("Client");
    expect(screen.getByRole("button", { name: "Glossy white" })).toHaveTextContent("Avoid");
    fireEvent.click(screen.getByRole("radio", { name: "Avoid" }));
    expect(screen.queryByRole("button", { name: "Fluted glass wardrobe" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Glossy white" })).toBeInTheDocument();
  });

  it("opens a pin's details and lets you link it to requirements", async () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Fluted glass wardrobe" }));
    const panel = await screen.findByRole("complementary", { name: "Pin details" });
    expect(panel).toHaveTextContent("Added by the client");
    expect(panel).toHaveTextContent("Requirements it informs");
    expect(screen.getByRole("link", { name: /Open Instagram/ })).toHaveAttribute("href", "https://www.instagram.com/p/x/");
  });

  it("adds a note pin and places it on the board", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method: init?.method ?? "GET", body });
      if (url.includes("/entries")) return { ok: true, json: async () => ({ ...base, ...body, assets: [], catalogLinks: [] }) };
      return { ok: true, json: async () => ({ saved: 1 }) };
    }));
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Note" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    expect(await screen.findByText("Write the note first.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "Keep the arch" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls.some((call) => call.url.includes("moodboard/layout"))).toBe(true));
    const saved = calls.find((call) => call.url.includes("/entries"))!.body as { kind: string; title: string; requirementIds: string[] };
    expect(saved).toMatchObject({ kind: "inspiration", title: "Keep the arch", requirementIds: [] });
    expect(await screen.findByRole("button", { name: "Keep the arch" })).toBeInTheDocument();
  });
});
