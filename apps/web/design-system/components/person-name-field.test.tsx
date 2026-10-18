import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "../foundations/provider";
import { PersonNameField } from "./person-name-field";

function Example({ initial = "", saved, onSubmit = vi.fn() }: { initial?: string; saved?: string; onSubmit?: () => void }) {
  const [name, setName] = useState(initial);
  return <DesignSystemProvider><form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <PersonNameField isRequired label="Customer name" onChange={setName} savedValue={saved} value={name} />
    <output data-testid="value">{name}</output>
    <button type="submit">Save</button>
  </form></DesignSystemProvider>;
}

describe("PersonNameField", () => {
  it("refuses digits and symbols at once, with one short line, and blocks the save", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Example onSubmit={onSubmit} />);
    const input = screen.getByRole("textbox", { name: /Customer name/ });
    await user.type(input, "Priya2");
    expect(screen.getByText("Use letters and spaces only")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).not.toHaveBeenCalled();
    await user.type(input, "{Backspace}");
    expect(screen.queryByText("Use letters and spaces only")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("accepts the punctuation real names need and waits for an unfinished one", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const input = screen.getByRole("textbox", { name: /Customer name/ });
    await user.type(input, "Mohammed Al-");
    expect(screen.queryByText("Use letters and spaces only")).not.toBeInTheDocument();
    await user.type(input, "Suwaidi");
    await user.tab();
    expect(screen.queryByText("Use letters and spaces only")).not.toBeInTheDocument();
    for (const name of ["Anil D'Souza", "John Smith Jr.", "محمد عبد الله", "José Álvarez"]) {
      await user.clear(input);
      await user.type(input, name);
      await user.tab();
      expect(screen.queryByText("Use letters and spaces only"), name).not.toBeInTheDocument();
    }
  });

  it("trims the name when the field is left", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.type(screen.getByRole("textbox", { name: /Customer name/ }), "  Priya   Sharma ");
    await user.tab();
    expect(screen.getByTestId("value")).toHaveTextContent(/^Priya Sharma$/);
  });

  it("keeps a name that came from a channel as it is until it is changed", async () => {
    const user = userEvent.setup();
    render(<Example initial="Ali 🙂" saved="Ali 🙂" />);
    expect(screen.queryByText("Use letters and spaces only")).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /Customer name/ }), "1");
    expect(screen.getByText("Use letters and spaces only")).toBeInTheDocument();
  });
});
