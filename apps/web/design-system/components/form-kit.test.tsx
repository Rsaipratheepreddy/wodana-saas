import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarDate, parseDate, today, type DateValue } from "@internationalized/date";
import { DesignSystemProvider, WorkspaceRegionProvider } from "../foundations/provider";
import { workingCalendar } from "../foundations/working-days";
import { ComboboxField, DateField, Form, TextAreaField, TextInput } from "./forms";
import { FormDialog, FormNotSaved, MoreDetails, useFormDraft } from "./form-kit";
import { ControlledModalDialog } from "./overlays";
import { MoneyField, parseMoneyText } from "./money-field";
import { PhoneField, PhoneNumberField } from "./phone-field";

const wrap = (ui: React.ReactNode, locale = "en-AE") => <WorkspaceRegionProvider currency="AED" locale={locale} timeZone="UTC"><DesignSystemProvider>{ui}</DesignSystemProvider></WorkspaceRegionProvider>;

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.useRealTimers());

describe("form layout", () => {
  it("marks the fields a person may skip and leaves required ones bare", () => {
    render(wrap(<Form><TextInput isRequired label="Customer name" /><TextInput label="Company" /></Form>));
    const required = screen.getByText("Customer name");
    const optional = screen.getByText("Company");
    expect(required).not.toHaveAttribute("data-optional");
    expect(required.textContent).toBe("Customer name");
    expect(optional).toHaveAttribute("data-optional", "Optional");
    // The marker is drawn, not text: the field is still found by its own label.
    expect(screen.getByRole("textbox", { name: "Company" })).toBeInTheDocument();
    expect(screen.getByLabelText("Company")).toBeInTheDocument();
  });

  it("keeps labels outside a form bare", () => {
    render(wrap(<TextInput label="Search clients" />));
    expect(screen.getByText("Search clients")).not.toHaveAttribute("data-optional");
  });

  it("names the fields a blocked save needs at the top, focuses the first and clears as they are fixed", async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(wrap(<Form onSubmit={submit}><TextInput isRequired label="Customer name" /><TextInput isRequired label="Mobile" /><button type="submit">Save</button></Form>));
    await user.click(screen.getByRole("button", { name: "Save" }));
    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("Check 2 fields");
    expect(within(summary).getByRole("button", { name: "Go to Customer name" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Customer name" })).toHaveFocus());
    expect(submit).not.toHaveBeenCalled();
    await user.click(within(summary).getByRole("button", { name: "Go to Mobile" }));
    expect(screen.getByRole("textbox", { name: "Mobile" })).toHaveFocus();
    await user.type(screen.getByRole("textbox", { name: "Customer name" }), "Sara");
    await user.type(screen.getByRole("textbox", { name: "Mobile" }), "0501234567");
    await user.tab();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("opens More details when a blocked save needs one of its fields", async () => {
    const user = userEvent.setup();
    render(wrap(<Form onSubmit={(event) => event.preventDefault()}><TextInput label="Name" /><MoreDetails><TextInput isRequired label="Tax number" /></MoreDetails><button type="submit">Save</button></Form>));
    const toggle = screen.getByRole("button", { name: "More details" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "true"));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Tax number" })).toHaveFocus());
  });
});

function Dialog({ onSubmit, onClose = () => undefined, conflict, draftKey }: { onSubmit: (value: { name: string; notes: string }) => unknown; onClose?: () => void; conflict?: Parameters<typeof FormDialog>[0]["conflict"]; draftKey?: string }) {
  const [value, setValue] = useState({ name: "", notes: "" });
  const dirty = Boolean(value.name || value.notes);
  const draft = useFormDraft(draftKey, value, { isDirty: dirty, restore: setValue });
  return <FormDialog conflict={conflict} draft={draftKey ? draft : undefined} isDirty={dirty} onClose={onClose} onSubmit={() => onSubmit(value)} submitLabel="Create" title="New client">
    <TextInput isRequired label="Name" onChange={(name) => setValue((current) => ({ ...current, name }))} value={value.name} />
    <TextAreaField label="Notes" onChange={(notes) => setValue((current) => ({ ...current, notes }))} value={value.notes} />
  </FormDialog>;
}

describe("form dialog", () => {
  it("puts Cancel then the primary action at the end, and Enter in a single-line field submits", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(wrap(<Dialog onSubmit={submit} />));
    const buttons = within(screen.getByRole("dialog", { name: "New client" }).querySelector("footer")!).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Cancel", "Create"]);
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Sara{Enter}");
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ name: "Sara", notes: "" }));
  });

  it("submits with ⌘/Ctrl+Enter from a multi-line field", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(wrap(<Dialog onSubmit={submit} />));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Sara");
    await user.type(screen.getByRole("textbox", { name: "Notes" }), "Line one{Enter}Line two");
    expect(submit).not.toHaveBeenCalled();
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ name: "Sara", notes: "Line one\nLine two" }));
    submit.mockClear();
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
  });

  it("asks before Esc closes a form with unsaved changes", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(wrap(<Dialog onClose={close} onSubmit={vi.fn()} />));
    await user.keyboard("{Escape}");
    expect(close).toHaveBeenCalledOnce();
    close.mockClear();
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Sara");
    await user.keyboard("{Escape}");
    expect(close).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Sara");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(await screen.findByRole("button", { name: "Discard changes" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps the dialog open with the reason when a save fails", async () => {
    const user = userEvent.setup();
    render(wrap(<Dialog onSubmit={() => { throw new Error("The mobile belongs to another client."); }} />));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Sara{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Not saved");
    expect(alert).toHaveTextContent("The mobile belongs to another client.");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Sara");
  });

  it("offers Reload or Keep my changes on a version conflict", async () => {
    const user = userEvent.setup();
    const conflictError = Object.assign(new Error("Changed"), { status: 409 });
    const submit = vi.fn().mockRejectedValueOnce(conflictError).mockResolvedValueOnce(undefined);
    const keepMine = vi.fn(async () => undefined);
    const reload = vi.fn();
    render(wrap(<Dialog conflict={{ onKeepMine: keepMine, onReload: reload }} onSubmit={submit} />));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Sara{Enter}");
    expect(await screen.findByText("Someone else saved a change first")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(keepMine).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
    expect(submit).toHaveBeenLastCalledWith({ name: "Sara", notes: "" });
    await waitFor(() => expect(screen.queryByText("Someone else saved a change first")).not.toBeInTheDocument());
  });

  it("reloads the latest on request after a conflict", async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    render(wrap(<Dialog conflict={{ onReload: reload }} onSubmit={() => { throw Object.assign(new Error("Changed"), { status: 409 }); }} />));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Sara{Enter}");
    await user.click(await screen.findByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Keep my changes" })).not.toBeInTheDocument();
  });
});

describe("drafts", () => {
  it("restores unsaved changes when the form opens again, and Discard puts it back", async () => {
    const user = userEvent.setup();
    const first = render(wrap(<Dialog draftKey="ws/client/new" onSubmit={vi.fn()} />));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Sara");
    first.unmount();
    expect(JSON.parse(window.localStorage.getItem("wodana.draft.v1:ws/client/new")!).value).toEqual({ name: "Sara", notes: "" });

    render(wrap(<Dialog draftKey="ws/client/new" onSubmit={vi.fn()} />));
    expect(await screen.findByText("Restored your draft")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Sara");
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("");
    expect(screen.queryByText("Restored your draft")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("wodana.draft.v1:ws/client/new")).toBeNull();
  });

  it("forgets the draft once the form is saved", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    const view = render(wrap(<Dialog draftKey="ws/client/new" onSubmit={submit} />));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Sara");
    await waitFor(() => expect(window.localStorage.getItem("wodana.draft.v1:ws/client/new")).not.toBeNull());
    await user.keyboard("{Enter}");
    await waitFor(() => expect(submit).toHaveBeenCalled());
    view.unmount();
    expect(window.localStorage.getItem("wodana.draft.v1:ws/client/new")).toBeNull();
  });

  it("closing a dirty form with a draft says the draft stays", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(wrap(<Dialog draftKey="ws/client/new" onClose={close} onSubmit={vi.fn()} />));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Sara");
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("dialog", { name: "Close this form?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("smart inputs", () => {
  it("groups money as it is typed and hands back an exact decimal", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    function Money() { const [value, setValue] = useState(""); return <MoneyField label="Amount" onChange={(next) => { change(next); setValue(next); }} value={value} />; }
    render(wrap(<Form><Money /></Form>));
    const input = screen.getByRole("textbox", { name: "Amount" });
    expect(screen.getByText("AED")).toBeInTheDocument();
    await user.type(input, "1250000.5");
    expect(input).toHaveValue("1,250,000.5");
    expect(change).toHaveBeenLastCalledWith("1250000.5");
    await user.type(input, "99");
    // Fils stop at the currency's two places.
    expect(change).toHaveBeenLastCalledWith("1250000.59");
  });

  it("reads and writes amounts the region's way", () => {
    expect(parseMoneyText("1250000", "en-IN", 2)).toEqual({ amount: "1250000", shown: "12,50,000" });
    expect(parseMoneyText("1.234,5", "de-DE", 2)).toEqual({ amount: "1234.5", shown: "1.234,5" });
    expect(parseMoneyText("٣٬٥٠٠", "en-AE", 2)).toEqual({ amount: "3500", shown: "3,500" });
    expect(parseMoneyText("12.345", "en-KW", 3).amount).toBe("12.345");
    expect(parseMoneyText("-40", "en-AE", 2, true).amount).toBe("-40");
    expect(parseMoneyText("-40", "en-AE", 2).amount).toBe("40");
  });

  it("offers Today, Tomorrow and the next working day on a date field", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(wrap(<Form><DateField label="Follow up on" onChange={(value) => change(value?.toString())} quickPicks="inline" /></Form>));
    const picks = screen.getByRole("group", { name: "Quick dates" });
    const now = today("UTC");
    await user.click(within(picks).getByRole("button", { name: "Tomorrow" }));
    expect(change).toHaveBeenLastCalledWith(now.add({ days: 1 }).toString());
    await user.click(within(picks).getByRole("button", { name: "Today" }));
    expect(change).toHaveBeenLastCalledWith(now.toString());
  });

  it("does not offer a quick date the field would refuse", () => {
    const past = today("UTC").add({ days: 2 });
    render(wrap(<DateField label="Due" minValue={past} quickPicks="inline" />));
    const picks = screen.queryByRole("group", { name: "Quick dates" });
    if (picks) {
      expect(within(picks).queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
      expect(within(picks).queryByRole("button", { name: "Tomorrow" })).not.toBeInTheDocument();
    }
  });

  it("offers Create '…' for typed text that matches no option", async () => {
    const user = userEvent.setup();
    const create = vi.fn();
    render(wrap(<ComboboxField items={[{ id: "oak", label: "Oak" }]} label="Finish" onCreate={create} />));
    await user.type(screen.getByRole("combobox", { name: "Finish" }), "Walnut");
    await user.click(await screen.findByRole("option", { name: "Create “Walnut”" }));
    expect(create).toHaveBeenCalledWith("Walnut");
  });

  it("starts a phone with the workspace region's country code", () => {
    render(wrap(<PhoneField countryCode="" label="Mobile" onChange={() => undefined} onCountryChange={() => undefined} value="" />, "en-AE"));
    expect(screen.getByRole("button", { name: "Mobile country code" })).toHaveTextContent("+971");
  });

  it("counts working days from the workspace's week and days off", () => {
    const friday = new CalendarDate(2026, 10, 2);
    const gulf = workingCalendar([0, 1, 2, 3, 4]);
    expect(gulf.nextWorkingDay(friday).toString()).toBe("2026-10-04");
    const uae = workingCalendar([1, 2, 3, 4, 5], ["2026-10-05"]);
    expect(uae.nextWorkingDay(friday).toString()).toBe("2026-10-06");
    expect(uae.isWorkingDay(parseDate("2026-10-03") as DateValue as CalendarDate)).toBe(false);
  });
});

describe("keyboard focus", () => {
  it("focuses the first field when a dialog opens on a desktop", async () => {
    const original = window.matchMedia;
    Object.defineProperty(window, "matchMedia", { value: (query: string) => ({ matches: query === "(pointer: fine)", addEventListener() {}, removeEventListener() {} }), writable: true });
    try {
      render(wrap(<Dialog onSubmit={vi.fn()} />));
      await waitFor(() => expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus());
    } finally {
      Object.defineProperty(window, "matchMedia", { value: original, writable: true });
    }
  });

  it("does not submit twice while a save is running", async () => {
    let finish: () => void = () => undefined;
    const submit = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(wrap(<Dialog onSubmit={submit} />));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Sara" } });
    const form = screen.getByRole("textbox", { name: "Name" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(submit).toHaveBeenCalledOnce();
    await act(async () => finish());
  });
});

describe("dialog saves", () => {
  it("stays open without a second message when the page already says why (FormNotSaved)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(wrap(<FormDialog error="The quotation changed. Reload it." onClose={onClose} closeOnSuccess onSubmit={() => { throw new FormNotSaved(); }} submitLabel="Save" title="Milestone">
      <TextInput label="Milestone" />
    </FormDialog>));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The quotation changed. Reload it.")).toBeInTheDocument();
    expect(screen.queryByText("Could not save.")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("submits the form inside any modal dialog on Cmd/Ctrl+Enter", async () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(wrap(<ControlledModalDialog isOpen onOpenChange={() => undefined} title="Rename"><form onSubmit={submit}><TextInput label="Name" /></form></ControlledModalDialog>));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "Enter", metaKey: true });
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
  });
});

describe("phone number field", () => {
  it("keeps one international number from a country and a local number", async () => {
    const user = userEvent.setup();
    const changes: string[] = [];
    function Phone() {
      const [value, setValue] = useState("");
      return <PhoneNumberField label="Client phone" value={value} onChange={(next) => { changes.push(next); setValue(next); }} />;
    }
    render(wrap(<Phone />));
    await user.type(screen.getByRole("textbox", { name: /Client phone/ }), "501234567");
    expect(changes.at(-1)).toBe("+971501234567");
  });
});
