import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DesignSystemProvider } from "../foundations/provider";
import { SelectField, type SelectItem } from "./forms";

const few: SelectItem[] = [{ id: "a", label: "Apple" }, { id: "b", label: "Banana" }, { id: "c", label: "Cherry" }];
const many: SelectItem[] = ["Aisha", "Bilal", "Chen", "Divya", "Ehsan", "Farah", "Gopal", "Hana", "Imran", "Jaya", "Karim", "Ravi"].map((name) => ({ id: name.toLowerCase(), label: name }));

/** The page owns the value (as every list filter and form does) and shows what the data holds. */
function Page({ items, initial }: { items: SelectItem[]; initial?: string }) {
  const [value, setValue] = useState<string | undefined>(initial);
  return <DesignSystemProvider>
    <SelectField items={items} label="Owner" onSelectionChange={(key) => setValue(key == null ? undefined : String(key))} selectedKey={value} />
    <output data-testid="data">{value ?? "none"}</output>
    <button onClick={() => setValue(undefined)} type="button">Clear</button>
    <button onClick={() => setValue(items[1].id)} type="button">Pick second</button>
  </DesignSystemProvider>;
}

describe("SelectField follows the value the page holds", () => {
  it("shows a new choice, and shows nothing again when the page clears it (no previous choice comes back)", async () => {
    const user = userEvent.setup();
    render(<Page items={few} />);
    const trigger = screen.getByRole("button", { name: /Owner/ });
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Cherry" }));
    expect(trigger).toHaveTextContent("Cherry");
    expect(screen.getByTestId("data")).toHaveTextContent("c");
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByTestId("data")).toHaveTextContent("none");
    expect(trigger).not.toHaveTextContent("Cherry");
    await user.click(screen.getByRole("button", { name: "Pick second" }));
    expect(trigger).toHaveTextContent("Banana");
  });

  it("a long list (type to filter) follows the page too, and clears with it", async () => {
    const user = userEvent.setup();
    render(<Page items={many} initial="chen" />);
    const input = screen.getByRole("combobox", { name: /Owner/ });
    expect(input).toHaveValue("Chen");
    await user.click(screen.getByRole("button", { name: "Pick second" }));
    await waitFor(() => expect(input).toHaveValue("Bilal"));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("keeps what was typed in a long list: Enter or leaving the field chooses the one option it names", async () => {
    const user = userEvent.setup();
    render(<Page items={many} initial="chen" />);
    const input = screen.getByRole("combobox", { name: /Owner/ });
    await user.click(input);
    await user.keyboard("{Control>}a{/Control}");
    await user.keyboard("Ravi{Enter}");
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("ravi"));
    expect(input).toHaveValue("Ravi");
    await user.click(input);
    await user.keyboard("{Control>}a{/Control}");
    await user.keyboard("imr");
    await user.tab();
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("imran"));
    expect(input).toHaveValue("Imran");
  });
});
