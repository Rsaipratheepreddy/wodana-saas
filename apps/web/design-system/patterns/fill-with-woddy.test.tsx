import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "../foundations/provider";
import { FormDialog } from "../components/form-kit";
import { TextInput } from "../components/forms";
import { FillWithWoddy } from "./fill-with-woddy";

const fields = [{ key: "customerName", label: "Customer name" }, { key: "mobile", label: "Mobile" }, { key: "email", label: "Email" }];

function NewClient({ extract, submit }: { extract: Parameters<typeof FillWithWoddy>[0]["onExtract"]; submit: (value: Record<string, string>) => void }) {
  const [value, setValue] = useState<Record<string, string>>({ customerName: "", mobile: "", email: "" });
  return <FormDialog lead={<FillWithWoddy fields={fields} onApply={(found) => setValue((current) => ({ ...current, ...found }))} onExtract={extract} />}
    onClose={() => undefined} onSubmit={() => submit(value)} submitLabel="Create" title="New client">
    {fields.map((field) => <TextInput key={field.key} label={field.label} onChange={(next) => setValue((current) => ({ ...current, [field.key]: next }))} value={value[field.key]} />)}
  </FormDialog>;
}

describe("Fill with Woddy", () => {
  it("reads pasted text into the fields the person keeps, and saves nothing by itself", async () => {
    const user = userEvent.setup();
    const extract = vi.fn(async () => ({ customerName: "Sara Khan", mobile: "+971 50 123 4567", email: "sara@palm.ae", unknown: "ignored" }));
    const submit = vi.fn();
    render(<DesignSystemProvider><NewClient extract={extract} submit={submit} /></DesignSystemProvider>);
    await user.click(screen.getByRole("button", { name: "Fill with Woddy" }));
    const panel = screen.getByRole("group", { name: "Fill with Woddy" });
    await user.type(within(panel).getByRole("textbox", { name: "Paste a message, email or card" }), "Hi, Sara Khan here. Call me on +971 50 123 4567");
    await user.click(within(panel).getByRole("button", { name: "Read it" }));
    expect(extract).toHaveBeenCalledWith({ text: "Hi, Sara Khan here. Call me on +971 50 123 4567", image: null });
    const found = await within(panel).findByRole("list", { name: "What Woddy found" });
    expect(within(found).getAllByRole("checkbox")).toHaveLength(3);
    // Leave the email out.
    await user.click(within(found).getByRole("checkbox", { name: /Email/ }));
    await user.click(within(panel).getByRole("button", { name: "Use 2 values" }));
    expect(screen.getByRole("textbox", { name: "Customer name" })).toHaveValue("Sara Khan");
    expect(screen.getByRole("textbox", { name: "Mobile" })).toHaveValue("+971 50 123 4567");
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Filled 2 fields. Check them before saving.");
    expect(submit).not.toHaveBeenCalled();
  });

  it("⌘Enter in the pasted text reads it instead of submitting the form", async () => {
    const user = userEvent.setup();
    const extract = vi.fn(async () => ({ customerName: "Omar" }));
    const submit = vi.fn();
    render(<DesignSystemProvider><NewClient extract={extract} submit={submit} /></DesignSystemProvider>);
    await user.click(screen.getByRole("button", { name: "Fill with Woddy" }));
    await user.type(screen.getByRole("textbox", { name: "Paste a message, email or card" }), "Omar");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(extract).toHaveBeenCalledOnce());
    expect(submit).not.toHaveBeenCalled();
  });

  it("says why when Woddy can't help, and keeps the text to try again", async () => {
    const user = userEvent.setup();
    const extract = vi.fn().mockRejectedValueOnce(new Error("AI credits are used up. Ask your admin to top up.")).mockResolvedValueOnce({});
    render(<DesignSystemProvider><NewClient extract={extract} submit={vi.fn()} /></DesignSystemProvider>);
    await user.click(screen.getByRole("button", { name: "Fill with Woddy" }));
    await user.type(screen.getByRole("textbox", { name: "Paste a message, email or card" }), "Sara");
    await user.click(screen.getByRole("button", { name: "Read it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("AI credits are used up. Ask your admin to top up.");
    expect(screen.getByRole("textbox", { name: "Paste a message, email or card" })).toHaveValue("Sara");
    await user.click(screen.getByRole("button", { name: "Read it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Woddy found nothing to fill.");
  });
});
