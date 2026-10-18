import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { PortalApi } from "@/lib/client-portal/client";
import type { PortalFolderDesign } from "@/lib/client-portal/types";
import { DesignFile } from "./forms/design-file";
import type { PortalFormat } from "./portal-format";

const format = { date: (value: string) => value.slice(0, 10), time: () => "10:00" } as unknown as PortalFormat;
const design = (comments: PortalFolderDesign["files"][number]["comments"] = []): PortalFolderDesign => ({ id: "d", title: "Living room", room: null, sharedAt: "2026-10-17T08:00:00Z",
  files: [{ id: "v1", number: 1, status: "client_review", sharedAt: "2026-10-17T08:00:00Z", mimeType: "image/png", hasPreview: true, canComment: true, comments }] });

describe("pinned comments on a design, inside the portal (§0.3)", () => {
  it("places a pin where the client taps and sends it with the comment", async () => {
    const command = vi.fn(async () => ({ ok: true }));
    const api = { command, file: (kind: string, id: string) => `/files/${kind}/${id}` } as unknown as PortalApi;
    render(<DesignSystemProvider><DesignFile design={design()} caseId="c1" api={api} format={format} onCommented={vi.fn()} /></DesignSystemProvider>);
    expect(screen.queryByRole("link", { name: /open the file/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add a pin" }));
    const stage = screen.getByRole("img", { name: "Living room, version 1" }).parentElement!;
    stage.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 200, right: 500, bottom: 250, x: 100, y: 50, toJSON: () => ({}) });
    fireEvent.click(stage, { clientX: 200, clientY: 100 });
    expect(screen.getByText("Pinned")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: /Comment/ }), "Warmer here");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(command).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: "design_file_comment", versionId: "v1", text: "Warmer here",
      anchor: { x: 0.25, y: 0.25 } })));
  });

  it("numbers each pinned comment and shows its pin on the design", () => {
    const api = { command: vi.fn(), file: (kind: string, id: string) => `/files/${kind}/${id}` } as unknown as PortalApi;
    render(<DesignSystemProvider><DesignFile design={design([
      { id: "m1", threadId: "m1", at: "2026-10-17T09:00:00Z", text: "Warmer here", fromClient: true, mine: true, author: "Dana", anchor: { x: 0.5, y: 0.5 } },
      { id: "m2", threadId: "m1", at: "2026-10-17T09:30:00Z", text: "We'll try oak", fromClient: false, mine: false, author: null },
    ])} caseId="c1" api={api} format={format} onCommented={vi.fn()} /></DesignSystemProvider>);
    expect(screen.getByRole("button", { name: "Pin 1: Warmer here" })).toBeInTheDocument();
  });
});
