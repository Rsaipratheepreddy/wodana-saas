import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { CaseContent, ScopeEntry } from "@/lib/pre-project/content";
import type { StaffMoodboard } from "@/lib/client-portal/types";
import { MoodboardPage } from "./moodboard-page";

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(nav.search) }));
afterEach(() => { vi.unstubAllGlobals(); nav.search = ""; });
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

describe("moodboard with the client portal", () => {
  const pins = [
    { ...base, id: "c1", kind: "inspiration", title: "Terrazzo floor", source: "client", fromClient: true, createdByName: "Omar Al Mansoori" },
    { ...base, id: "t1", kind: "inspiration", title: "Walnut slats" },
    { ...base, id: "t2", kind: "inspiration", title: "Brass handles" },
  ] as unknown as ScopeEntry[];
  const shared: StaffMoodboard = {
    shared: ["t2"], canEdit: true,
    reactions: [{ targetKind: "pin", targetId: "t2", reaction: "like", by: "Aisha Al Mansoori", at: "2026-09-20T09:00:00.000Z" },
      { targetKind: "pin", targetId: "t2", reaction: "dislike", by: "Omar Al Mansoori", at: "2026-09-20T10:00:00.000Z" }],
    comments: [{ id: "m1", targetKind: "pin", targetId: "t2", text: "Could these be matte?", at: "2026-09-20T11:00:00.000Z", fromClient: true, author: "Aisha Al Mansoori" }],
    boards: [{ id: "v2", designId: "d1", title: "Living room concept", number: 2, room: "Living room" }],
  };
  /** The moodboard's own requests answer as before; the portal's answer with the board, applying shares and replies. */
  const mount = () => {
    let board = structuredClone(shared);
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (url.includes("/moodboard/share")) board = { ...board, shared: body.shared ? [...new Set([...board.shared, ...body.entryIds])] : board.shared.filter((id) => !body.entryIds.includes(id)) };
      if (url.includes("/moodboard/reply")) board = { ...board, comments: [...board.comments, { id: body.id, targetKind: body.targetKind, targetId: body.targetId, text: body.text, at: "2026-09-21T08:00:00.000Z", fromClient: false, author: "Sara Sales" }] };
      return { ok: true, status: 200, json: async () => (url.startsWith("/api/client-portal-admin/") ? board : { saved: 1 }) };
    });
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><MoodboardPage initialData={{ ...data, entries: pins }} clientName="Aisha Al Mansoori" /></DesignSystemProvider>);
    return fetcher;
  };
  const portalPosts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([url, init]) => init?.method === "POST" && String(url).startsWith("/api/client-portal-admin/"))
    .map(([url, init]) => ({ url: String(url).split("?")[0], body: JSON.parse(String(init!.body)) }));

  it("marks what the client sees, what they added, their likes and comments, and the boards they see", async () => {
    mount();
    const brass = card("Brass handles");
    expect(await within(brass).findByText("Shown to the client")).toBeInTheDocument();
    expect(within(brass).getByLabelText("1 like")).toHaveAttribute("title", "Aisha Al Mansoori");
    expect(within(brass).getByLabelText("1 dislike")).toBeInTheDocument();
    expect(within(brass).getByLabelText("1 comment")).toBeInTheDocument();
    const terrazzo = card("Terrazzo floor");
    expect(terrazzo).toHaveTextContent("From client");
    expect(terrazzo).toHaveTextContent("From Omar Al Mansoori");
    expect(within(card("Walnut slats")).queryByText("Shown to the client")).not.toBeInTheDocument();
    const boards = screen.getByRole("region", { name: "Boards the client sees" });
    expect(within(boards).getByRole("link", { name: /Living room concept/ })).toHaveAttribute("href", "/workspace/pre-projects/cases/c1/designs?file=d1");
  });

  it("shows who liked and disliked a pin and its comments, and answers the client", async () => {
    const fetcher = mount();
    await within(card("Brass handles")).findByText("Shown to the client");
    fireEvent.click(screen.getByRole("button", { name: "Open details for Brass handles" }));
    const panel = screen.getByRole("complementary", { name: "Pin details" });
    const feedback = within(panel).getByRole("region", { name: "Client feedback" });
    expect(feedback).toHaveTextContent("Liked by Aisha Al Mansoori");
    expect(feedback).toHaveTextContent("Disliked by Omar Al Mansoori");
    expect(feedback).toHaveTextContent("Could these be matte?");
    await userEvent.type(within(feedback).getByRole("textbox", { name: "Reply to the client" }), "Yes, brushed brass is matte.");
    await userEvent.click(within(feedback).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(portalPosts(fetcher)).toHaveLength(1));
    expect(portalPosts(fetcher)[0]).toEqual({ url: "/api/client-portal-admin/cases/c1/moodboard/reply",
      body: { id: expect.stringMatching(/^[0-9a-f-]{36}$/), targetKind: "pin", targetId: "t2", text: "Yes, brushed brass is matte." } });
    expect(await within(feedback).findByText("Yes, brushed brass is matte.")).toBeInTheDocument();
    expect(within(feedback).getByRole("textbox", { name: "Reply to the client" })).toHaveValue("");
  });

  it("shows or hides a pin in the portal from its details, and the pins in view from the toolbar", async () => {
    const fetcher = mount();
    await within(card("Brass handles")).findByText("Shown to the client");
    fireEvent.click(screen.getByRole("button", { name: "Open details for Walnut slats" }));
    const panel = screen.getByRole("complementary", { name: "Pin details" });
    // Not shown yet, so there's nothing to reply to.
    expect(within(panel).queryByRole("textbox", { name: "Reply to the client" })).not.toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("switch", { name: "Show in the client portal" }));
    await waitFor(() => expect(portalPosts(fetcher).at(-1)).toEqual({ url: "/api/client-portal-admin/cases/c1/moodboard/share", body: { entryIds: ["t1"], shared: true } }));
    expect(await within(card("Walnut slats")).findByText("Shown to the client")).toBeInTheDocument();
    expect(within(panel).getByRole("textbox", { name: "Reply to the client" })).toBeInTheDocument();
    // Both team pins are shown now; the client's own pin is always theirs, so the toolbar hides the two.
    await userEvent.click(screen.getByRole("button", { name: /Client portal/ }));
    const hide = await screen.findByRole("menuitem", { name: "Hide 2 from the portal" });
    expect(screen.queryByRole("menuitem", { name: /Show/ })).not.toBeInTheDocument();
    await userEvent.click(hide);
    await waitFor(() => expect(portalPosts(fetcher).at(-1)).toEqual({ url: "/api/client-portal-admin/cases/c1/moodboard/share", body: { entryIds: ["t1", "t2"], shared: false } }));
  });

  it("opens the pin a notice links to; a pin the client added can't be hidden from them", async () => {
    nav.search = "pin=c1";
    mount();
    const panel = screen.getByRole("complementary", { name: "Pin details" });
    expect(panel).toHaveTextContent("Terrazzo floor");
    expect(panel).toHaveTextContent("From client");
    expect(await within(panel).findByRole("textbox", { name: "Reply to the client" })).toBeInTheDocument();
    expect(within(panel).queryByRole("switch", { name: "Show in the client portal" })).not.toBeInTheDocument();
  });
});
