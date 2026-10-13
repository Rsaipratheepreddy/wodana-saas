import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { PortalApi } from "@/lib/client-portal/client";
import type { PortalFolderDesign, PortalProject } from "@/lib/client-portal/types";
import { DesignFile } from "./forms/design-file";
import type { PortalFormat } from "./portal-format";
import { DesignsSection } from "./sections/designs-section";

const format = { date: (iso: string) => iso.slice(0, 10), time: (iso: string) => iso.slice(11, 16) } as unknown as PortalFormat;
const board: PortalFolderDesign = {
  id: "d1", title: "Living mood board", room: "Living", sharedAt: "2026-10-12T10:00:00.000Z",
  files: [
    { id: "v2", number: 2, status: "client_review", sharedAt: "2026-10-12T10:00:00.000Z", mimeType: "image/png", hasPreview: true, canComment: true, comments: [] },
    { id: "v1", number: 1, status: "approved", sharedAt: "2026-10-01T10:00:00.000Z", mimeType: "image/png", hasPreview: true, canComment: true,
      comments: [{ id: "c1", at: "2026-10-02T09:00:00.000Z", text: "We love the oak.", fromClient: true, mine: true, author: "Maya" },
        { id: "c2", at: "2026-10-02T10:00:00.000Z", text: "Noted, it stays.", fromClient: false, mine: false, author: null }] },
  ],
};
const render2 = { ...board, id: "d2", title: "Kitchen render", room: null, files: [{ ...board.files[1], id: "v9", status: "approved" as const, comments: [] }] };
const api = (command = vi.fn(async () => ({ ok: true }))) => ({ command, file: (kind: string, id: string, preview = false) => `/files/${kind}/${id}${preview ? "?preview=1" : ""}` }) as unknown as PortalApi;
const wrap = (node: React.ReactNode) => render(<DesignSystemProvider locale="en-GB" timeZone="UTC">{node}</DesignSystemProvider>);
const project = (designs: PortalProject["designs"]) => ({ id: "case-1", designs }) as unknown as PortalProject;
const props = { site: {} as never, today: "2026-10-13", go: vi.fn(), reload: vi.fn(), format };

describe("PLM-153: the client's Designs folder", () => {
  it("shows each folder by stage with each design's latest file and its state in plain words; an empty project says so", async () => {
    const open = vi.fn();
    const user = userEvent.setup();
    const { unmount } = wrap(<DesignsSection {...props} api={api()} open={open} project={project({ groups: [{ key: "concepts", designs: [board] }, { key: "renders", designs: [render2] }] })} />);
    expect(screen.getByRole("heading", { name: "Concepts and mood boards" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Renders" })).toBeInTheDocument();
    expect(screen.getByText("Living mood board · V2")).toBeInTheDocument();
    expect(screen.getByText("For your review")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText(/2 rounds/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2 comments/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Living mood board · V2" }));
    expect(open).toHaveBeenCalledWith({ kind: "design-file", id: "d1" });
    unmount();
    wrap(<DesignsSection {...props} api={api()} open={open} project={project({ groups: [] })} />);
    expect(screen.getByText("No designs yet")).toBeInTheDocument();
  });

  it("opens a design at its latest file, shows the earlier round with its conversation, and sends the client's comment on that round", async () => {
    const command = vi.fn(async () => ({ ok: true }));
    const decide = vi.fn();
    const commented = vi.fn();
    const user = userEvent.setup();
    wrap(<DesignFile design={board} caseId="case-1" api={api(command)} format={format} onCommented={commented} onDecide={decide} />);
    expect(screen.getByText("For your review")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Give your decision" }));
    expect(decide).toHaveBeenCalledWith("v2");
    await user.click(screen.getByRole("radio", { name: "V1" }));
    expect(screen.getByText("We love the oak.")).toBeInTheDocument();
    expect(screen.getByText("Your design team")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Give your decision" })).toBeNull();
    await user.type(screen.getByRole("textbox", { name: "Comment" }), "Please keep the oak in V2 too.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(commented).toHaveBeenCalled());
    expect(command).toHaveBeenCalledWith(expect.any(String), { action: "design_file_comment", caseId: "case-1", versionId: "v1", commentId: expect.any(String), text: "Please keep the oak in V2 too." });
  });
});
