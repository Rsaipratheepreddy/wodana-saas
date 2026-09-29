import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider, WorkspaceRegionProvider } from "../foundations/provider";
import { ReadOnlyProvider } from "../foundations/read-only";
import { EditableField, EditableFieldList, type EditableFieldProps } from "./editable-field";

const wrap = (ui: React.ReactNode) => <WorkspaceRegionProvider currency="AED" locale="en-AE" timeZone="UTC"><DesignSystemProvider><EditableFieldList>{ui}</EditableFieldList></DesignSystemProvider></WorkspaceRegionProvider>;

/** A record that keeps the saved value, like a detail view after its update command answers. */
function Record(props: Omit<EditableFieldProps, "value" | "onSave"> & { initial: string; save: (next: string) => unknown }) {
  const [value, setValue] = useState(props.initial);
  return <EditableField {...props} onSave={async (next) => { await props.save(next); setValue(next); }} value={value} />;
}

describe("editable field", () => {
  it("turns a value into its field on click and saves with Enter", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(wrap(<Record initial="sara@studio.com" kind="email" label="Email" save={save} />));
    expect(screen.getByText("Email")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit Email" }));
    const input = screen.getByRole("textbox", { name: "Email" });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, "sara@palm.ae{Enter}");
    expect(save).toHaveBeenCalledWith("sara@palm.ae");
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Email" })).toHaveTextContent("sara@palm.ae");
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Email" })).toHaveFocus());
  });

  it("saves when the person leaves the field", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(wrap(<><Record initial="Sara" label="Name" save={save} /><button type="button">Elsewhere</button></>));
    await user.click(screen.getByRole("button", { name: "Edit Name" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), " Khan");
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("Sara Khan"));
  });

  it("cancels with Esc and saves nothing when nothing changed", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(wrap(<Record initial="Sara" label="Name" save={save} />));
    await user.click(screen.getByRole("button", { name: "Edit Name" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), " Khan{Escape}");
    expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Name" })).toHaveTextContent("Sara");
    await user.click(screen.getByRole("button", { name: "Edit Name" }));
    await user.keyboard("{Enter}");
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps the new value with the reason and Retry when a save fails", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockRejectedValueOnce(new Error("That mobile belongs to another client.")).mockResolvedValueOnce(undefined);
    render(wrap(<Record initial="0501234567" label="Mobile" save={save} />));
    await user.click(screen.getByRole("button", { name: "Edit Mobile" }));
    await user.clear(screen.getByRole("textbox", { name: "Mobile" }));
    await user.type(screen.getByRole("textbox", { name: "Mobile" }), "0509999999{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("That mobile belongs to another client.");
    expect(screen.getByRole("textbox", { name: "Mobile" })).toHaveValue("0509999999");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Edit Mobile" })).toHaveTextContent("0509999999");
  });

  it("says someone else changed the record on a version conflict and offers Reload", async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    render(wrap(<Record initial="Villa 12" label="Project name" onReload={reload} save={() => { throw Object.assign(new Error(""), { status: 409 }); }} />));
    await user.click(screen.getByRole("button", { name: "Edit Project name" }));
    await user.type(screen.getByRole("textbox", { name: "Project name" }), "A{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone else saved a change first");
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("checks a required value before saving", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(wrap(<Record initial="Sara" isRequired label="Name" save={save} />));
    await user.click(screen.getByRole("button", { name: "Edit Name" }));
    await user.clear(screen.getByRole("textbox", { name: "Name" }));
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Required");
    expect(save).not.toHaveBeenCalled();
  });

  it("saves a choice as soon as it is picked", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(wrap(<Record initial="normal" items={[{ id: "normal", label: "Normal" }, { id: "high", label: "High" }]} kind="select" label="Priority" save={save} />));
    expect(screen.getByRole("button", { name: "Edit Priority" })).toHaveTextContent("Normal");
    await user.click(screen.getByRole("button", { name: "Edit Priority" }));
    await user.click(await screen.findByRole("option", { name: "High" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("high"));
    expect(await screen.findByRole("button", { name: "Edit Priority" })).toHaveTextContent("High");
  });

  it("shows plain text to people who may not change it", () => {
    render(wrap(<Record canEdit={false} initial="Sara" label="Name" save={vi.fn()} />));
    expect(screen.getByText("Sara")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Name" })).not.toBeInTheDocument();
  });

  it("shows plain text while the page is read-only (viewing as someone)", () => {
    render(<ReadOnlyProvider reason="Read-only while viewing as Sara">{wrap(<Record initial="Sara" label="Name" save={vi.fn()} />)}</ReadOnlyProvider>);
    expect(screen.getByText("Sara")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Name" })).not.toBeInTheDocument();
  });

  it("offers Add for an empty value", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(wrap(<Record initial="" label="Website" save={save} />));
    expect(screen.getByRole("button", { name: "Edit Website" })).toHaveTextContent("Add");
    await user.click(screen.getByRole("button", { name: "Edit Website" }));
    await user.type(screen.getByRole("textbox", { name: "Website" }), "palm.ae{Enter}");
    expect(save).toHaveBeenCalledWith("palm.ae");
  });

  it("edits money as an exact decimal", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(wrap(<Record display="AED 1,000" initial="1000" kind="money" label="Budget" save={save} />));
    await user.click(screen.getByRole("button", { name: "Edit Budget" }));
    const input = screen.getByRole("textbox", { name: "Budget" });
    expect(input).toHaveValue("1,000");
    await user.clear(input);
    await user.type(input, "250000.5{Enter}");
    expect(save).toHaveBeenCalledWith("250000.5");
  });
});
