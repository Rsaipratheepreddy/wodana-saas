import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "../foundations/provider";
import { ProblemSummary } from "./form-summary";
import { SelectField, TextInput } from "./forms";

const scrolled: Element[] = [];
beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) { scrolled.push(this); });
});
afterEach(() => { delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; });

const sources = [{ id: "company", label: "Company" }, { id: "referral", label: "Referral" }];
const types = [{ id: "individual", label: "Individual" }, { id: "company", label: "Company" }];

function Form() {
  return <DesignSystemProvider><form>
    <ProblemSummary title="Enquiry not saved" problems={[
      { key: "customerType", label: "Choose the client type." },
      { key: "displayName", label: "Enter a customer name." },
      { key: "source", label: "Choose where this enquiry came from." },
    ]} />
    <TextInput label="Customer name" name="displayName" />
    <SelectField label="Source" name="source" placeholder="Choose source" items={sources} />
    <SelectField label="Client type" name="customerType" placeholder="Choose client type" items={types} />
  </form></DesignSystemProvider>;
}

it("takes each problem to its own field by id: focuses the visible control and scrolls it into view (L8)", async () => {
  const user = userEvent.setup();
  render(<Form />);
  const box = screen.getByRole("alert");

  // A dropdown: its button, not its hidden select, and not the dropdown before it.
  await user.click(within(box).getByRole("button", { name: "Choose the client type." }));
  const clientType = screen.getByRole("button", { name: /Client type/ });
  expect(clientType).toHaveFocus();
  expect(clientType.id).not.toBe("");
  expect(scrolled.at(-1)).toBe(clientType);
  expect(screen.getByRole("button", { name: /Source/ })).not.toHaveFocus();

  // A text field: the input itself.
  await user.click(within(box).getByRole("button", { name: "Enter a customer name." }));
  const name = screen.getByRole("textbox", { name: "Customer name" });
  expect(name).toHaveFocus();
  expect(scrolled.at(-1)).toBe(name);

  await user.click(within(box).getByRole("button", { name: "Choose where this enquiry came from." }));
  expect(screen.getByRole("button", { name: /Source/ })).toHaveFocus();
});
