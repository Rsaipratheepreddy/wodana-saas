import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "../foundations/provider";
import { SelectField } from "./forms";

const scrolled: Array<{ element: Element; options: unknown }> = [];
beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = vi.fn(function (this: Element, options?: unknown) { scrolled.push({ element: this, options }); });
});
afterEach(() => { delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; });

const items = Array.from({ length: 8 }, (_, index) => ({ id: `t${index}`, label: `Type ${index}` }));

function setup() {
  render(<DesignSystemProvider><div data-testid="dialog-body" style={{ overflow: "auto" }}><SelectField label="Client type" placeholder="Choose client type" items={items} /></div></DesignSystemProvider>);
  const trigger = screen.getByRole("button", { name: /Client type/ });
  let top = 700;
  vi.spyOn(trigger, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, top, 300, 40));
  return { user: userEvent.setup(), trigger, moveTo: (next: number) => { top = next; } };
}

it("scrolls a partly hidden trigger into view before its list opens (L9)", async () => {
  const { user, trigger } = setup();
  await user.click(trigger);
  expect(await screen.findByRole("listbox")).toBeInTheDocument();
  expect(scrolled[0]).toEqual({ element: trigger, options: { block: "nearest", inline: "nearest" } });
  // React Aria places the list against the trigger (flipping when needed) and says where.
  expect(screen.getByRole("listbox").closest(".wd-picker-popover")).toHaveAttribute("data-placement");
});

it("closes the list when a scroll moves its trigger, so it never hangs detached from the field (L9)", async () => {
  const { user, trigger, moveTo } = setup();
  await user.click(trigger);
  const listbox = await screen.findByRole("listbox");
  // Scrolling the list itself, or a scroll that leaves the trigger in place, keeps it open.
  fireEvent.scroll(listbox);
  fireEvent.scroll(screen.getByTestId("dialog-body"));
  expect(screen.getByRole("listbox")).toBeInTheDocument();
  // The dialog body scrolls and the trigger moves: the list closes.
  moveTo(560);
  fireEvent.scroll(screen.getByTestId("dialog-body"));
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});
