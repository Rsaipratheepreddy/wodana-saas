import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "../foundations/provider";
import { ControlledModalDialog, InspectorSheet, SideSheet } from "./overlays";

/** A page whose dialogs portal into its own provider, which only exists after the first render (as on a page reached by a link). */
function PortalPage({ children }: { children: ReactNode }) {
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  return <DesignSystemProvider portalContainer={portal} ref={setPortal}><button type="button">Page action</button>{children}</DesignSystemProvider>;
}

// While a dialog is open, everything else is hidden (`inert`, or `aria-hidden` where the browser has no inert).
const hiddenAncestor = (element: Element) => element.parentElement?.closest("[aria-hidden='true'], [inert]") ?? null;

describe("overlays opened on arrival", () => {
  it.each([
    ["dialog", (close: () => void) => <ControlledModalDialog isOpen onOpenChange={close} title="Opportunity details"><button type="button">Inside</button></ControlledModalDialog>],
    ["inspector sheet", (close: () => void) => <InspectorSheet isOpen onOpenChange={close} title="Opportunity details"><button type="button">Inside</button></InspectorSheet>],
    ["side sheet", (close: () => void) => <SideSheet defaultOpen onOpenChange={close} title="Opportunity details" trigger={<button type="button">Open</button>}><button type="button">Inside</button></SideSheet>],
  ])("a %s open from the first render stays usable once it moves into the page's portal", async (_kind, overlay) => {
    const close = vi.fn();
    render(<PortalPage>{overlay(close)}</PortalPage>);
    const dialog = await screen.findByRole("dialog");
    expect(document.body.contains(dialog)).toBe(true);
    expect(hiddenAncestor(dialog)).toBeNull();
    // Only the page behind is hidden.
    expect(screen.getByText("Page action").closest("[aria-hidden='true'], [inert]")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Close/ }));
    expect(close).toHaveBeenCalledWith(false);
  });

  it("leaves nothing hidden after the dialog closes", async () => {
    function Page() {
      const [open, setOpen] = useState(true);
      return <PortalPage>{open ? <ControlledModalDialog isOpen onOpenChange={setOpen} title="Opportunity details"><p>Inside</p></ControlledModalDialog> : null}</PortalPage>;
    }
    render(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: /Close/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[aria-hidden='true'], [inert]")).toBeNull();
    expect(screen.getByRole("button", { name: "Page action" })).toBeTruthy();
  });
});
