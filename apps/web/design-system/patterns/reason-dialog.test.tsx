import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider, WorkspaceRegionProvider } from "../foundations/provider";
import { ReasonDialog } from "./reason-dialog";

const wrap = (ui: React.ReactNode) => <WorkspaceRegionProvider currency="AED" locale="en-AE" timeZone="UTC"><DesignSystemProvider>{ui}</DesignSystemProvider></WorkspaceRegionProvider>;

describe("reason dialog", () => {
  it("asks for one reason, with Cancel then the action at the bottom end, and confirms with the trimmed text", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn();
    const close = vi.fn();
    render(wrap(<ReasonDialog confirmLabel="Put on hold" label="Reason" onClose={close} onConfirm={confirm} title="Put the job on hold?" />));
    const dialog = screen.getByRole("dialog", { name: "Put the job on hold?" });
    const buttons = within(dialog.querySelector("footer")!).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Cancel", "Put on hold"]);
    expect(buttons[1]).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Reason" }), "  Waiting for the client  ");
    expect(buttons[1]).toBeEnabled();
    await user.click(buttons[1]);
    await waitFor(() => expect(confirm).toHaveBeenCalledWith("Waiting for the client"));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it("keeps the action off while the reason is only spaces", async () => {
    const user = userEvent.setup();
    render(wrap(<ReasonDialog confirmLabel="Reject" confirmVariant="danger" label="Why it is refused" onClose={() => undefined} onConfirm={() => undefined} title="Reject the drawing?" />));
    await user.type(screen.getByRole("textbox", { name: "Why it is refused" }), "   ");
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  });
});
