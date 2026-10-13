import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { PortalApi } from "@/lib/client-portal/client";
import type { PortalMeeting, PortalProject } from "@/lib/client-portal/types";
import { MeetingNotes } from "./forms/meeting-notes";
import type { PortalFormat } from "./portal-format";
import { MeetingsSection } from "./sections/meetings-section";

const format = { date: (iso: string) => iso.slice(0, 10), time: (iso: string) => iso.slice(11, 16) } as unknown as PortalFormat;
const meeting: PortalMeeting = {
  id: "m1", title: "Kick-off", meetingAt: "2026-10-13T09:00:00.000Z", text: "Render sign-off agreed for 21 Oct.", sharedAt: "2026-10-13T11:00:00.000Z",
  updatedAt: "2026-10-13T15:00:00.000Z", files: [{ id: "f1", name: "whiteboard.pdf", mimeType: "application/pdf", hasPreview: false }],
  comments: [{ id: "c1", at: "2026-10-13T12:00:00.000Z", text: "Yes, 22 Oct works.", fromClient: false, author: null, mine: false }],
};
const wrap = (node: React.ReactNode) => render(<DesignSystemProvider locale="en-GB" timeZone="UTC">{node}</DesignSystemProvider>);

describe("PLM-153: meeting notes in the client portal", () => {
  it("list each meeting's notes, saying when they were updated, and open one", async () => {
    const open = vi.fn();
    const user = userEvent.setup();
    wrap(<MeetingsSection project={{ id: "case-1", meetings: { meetings: [meeting] } } as unknown as PortalProject} format={format} open={open}
      site={{} as never} api={{} as never} today="2026-10-13" go={vi.fn()} reload={vi.fn()} />);
    expect(screen.getByText("Kick-off")).toBeInTheDocument();
    expect(screen.getByText(/Updated 2026-10-13/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Kick-off/ }));
    expect(open).toHaveBeenCalledWith({ kind: "minutes", id: "m1" });
  });

  it("show the notes, their files and the team as one team, and send the client's comment once", async () => {
    const command = vi.fn(async () => ({ ok: true }));
    const api = { command, file: (kind: string, id: string) => `/files/${kind}/${id}` } as unknown as PortalApi;
    const commented = vi.fn();
    const user = userEvent.setup();
    wrap(<MeetingNotes meeting={meeting} caseId="case-1" api={api} format={format} onCommented={commented} />);
    expect(screen.getByText("Render sign-off agreed for 21 Oct.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /whiteboard.pdf/ })).toHaveAttribute("href", "/files/minutes/f1");
    expect(screen.getAllByText("Your project team").length).toBeGreaterThan(0);
    await user.type(screen.getByRole("textbox", { name: "Comment" }), "Thanks, see you then.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(commented).toHaveBeenCalled());
    expect(command).toHaveBeenCalledWith(expect.any(String), { action: "minutes_comment", caseId: "case-1", minutesId: "m1", commentId: expect.any(String), text: "Thanks, see you then." });
  });
});
