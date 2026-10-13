import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "../foundations/provider";
import { Checkbox } from "./forms";
import { useDetailsMenu } from "./details-menu";

function Menu({ closeOnChoose = false, onChoose = vi.fn() }: { closeOnChoose?: boolean; onChoose?: () => void }) {
  const menu = useDetailsMenu({ closeOnChoose });
  return <DesignSystemProvider>
    <p>Page text</p>
    <details data-testid="menu" onClick={menu.onClick} ref={menu.ref}>
      <summary>Assignee</summary>
      <div><input aria-label="Search people" /><Checkbox>Include archived</Checkbox><button onClick={onChoose} type="button">Sara</button></div>
    </details>
  </DesignSystemProvider>;
}
const menu = () => screen.getByTestId("menu") as HTMLDetailsElement;

describe("useDetailsMenu", () => {
  it("stays open while its own content is used, closes on a click outside and on Esc", async () => {
    const user = userEvent.setup();
    render(<Menu />);
    await user.click(screen.getByText("Assignee"));
    expect(menu().open).toBe(true);
    await user.click(screen.getByText("Include archived"));
    await user.type(screen.getByRole("textbox", { name: "Search people" }), "sa");
    expect(menu().open).toBe(true);
    await user.click(screen.getByText("Page text"));
    expect(menu().open).toBe(false);
    await user.click(screen.getByText("Assignee"));
    expect(menu().open).toBe(true);
    await user.keyboard("{Escape}");
    expect(menu().open).toBe(false);
    expect(screen.getByText("Assignee")).toHaveFocus();
  });

  it("closes after choosing a single option when asked to", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<Menu closeOnChoose onChoose={onChoose} />);
    await user.click(screen.getByText("Assignee"));
    await user.click(screen.getByText("Include archived"));
    expect(menu().open).toBe(true);
    await user.click(screen.getByRole("button", { name: "Sara" }));
    expect(onChoose).toHaveBeenCalledOnce();
    expect(menu().open).toBe(false);
  });
});
