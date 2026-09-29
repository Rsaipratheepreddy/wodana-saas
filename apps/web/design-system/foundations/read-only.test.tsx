import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, IconMenuButton, buttonWrites } from "../components/actions";
import { FileUploader, Form, Switch } from "../components/forms";
import { DesignSystemProvider } from "./provider";
import { ReadOnlyProvider } from "./read-only";

const reason = "Read-only while viewing as Sara";

describe("read-only pages (view as)", () => {
  it("turns off the buttons that write, with the reason as their tooltip, and leaves reading alone", async () => {
    const user = userEvent.setup();
    const save = vi.fn(), open = vi.fn(), exit = vi.fn();
    render(<DesignSystemProvider><ReadOnlyProvider reason={reason}>
      <Button onPress={save} variant="primary">Save</Button>
      <Button onPress={open}>Open project</Button>
      <Button intent="write" onPress={vi.fn()}>Archive</Button>
      <Button intent="read" onPress={exit} variant="primary">Exit</Button>
      <Button type="submit">Send</Button>
    </ReadOnlyProvider></DesignSystemProvider>);
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeDisabled();
    expect(saveButton.closest("[title]")).toHaveAttribute("title", reason);
    expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await user.click(saveButton);
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Open project" }));
    await user.click(screen.getByRole("button", { name: "Exit" }));
    expect(open).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });

  it("keeps switches, uploads, form submits and destructive menu items from changing anything", async () => {
    const user = userEvent.setup();
    const change = vi.fn(), submit = vi.fn(), remove = vi.fn();
    render(<DesignSystemProvider><ReadOnlyProvider reason={reason}>
      <Switch onChange={change}>Email notices</Switch>
      <FileUploader label="Upload files" onFiles={vi.fn()} />
      <Form onSubmit={submit}><input aria-label="Name" /><button type="submit">Go</button></Form>
      <IconMenuButton ariaLabel="Actions" items={[{ id: "open", label: "Open" }, { id: "delete", label: "Delete", tone: "danger" }]} onAction={remove} />
    </ReadOnlyProvider></DesignSystemProvider>);
    await user.click(screen.getByRole("switch", { name: "Email notices" }));
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Upload files/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: "Open" })).not.toHaveAttribute("aria-disabled", "true");
  });

  it("changes nothing outside a read-only page", () => {
    render(<DesignSystemProvider><Button variant="primary">Save</Button></DesignSystemProvider>);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(buttonWrites({ variant: "danger" })).toBe(true);
    expect(buttonWrites({ variant: "quiet" })).toBe(false);
    expect(buttonWrites({ variant: "primary", intent: "read" })).toBe(false);
  });
});
