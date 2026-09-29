import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LandingHeader } from "./landing-header";

const main = () => screen.getByRole("navigation", { name: "Main" });
const trigger = (name: string) => within(main()).getByRole("button", { name });

describe("public site header", () => {
  it("has the Product, Solutions and Company menus, Sign in and Contact sales", () => {
    render(<LandingHeader />);
    for (const name of ["Product", "Solutions", "Company"]) expect(trigger(name)).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Contact sales" })).toHaveAttribute("href", "#contact");
  });

  it("sends Contact sales to its own page away from the landing page", () => {
    render(<LandingHeader onLanding={false} />);
    expect(screen.getByRole("link", { name: "Contact sales" })).toHaveAttribute("href", "/contact-sales");
  });

  it("opens a menu on click with its links, and closes it with Escape, returning focus", async () => {
    const user = userEvent.setup();
    render(<LandingHeader />);
    await user.click(trigger("Product"));
    expect(trigger("Product")).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(trigger("Product").getAttribute("aria-controls")!)!;
    expect(within(panel).getByRole("link", { name: /Planning & quotes/ })).toHaveAttribute("href", "/#quotes");
    expect(within(panel).getByRole("link", { name: /Mobile app/ })).toHaveAttribute("href", "/#mobile");
    expect(within(panel).getByRole("link", { name: /Woddy, your AI teammate/ })).toHaveAttribute("href", "/#woddy");
    await user.keyboard("{Escape}");
    expect(trigger("Product")).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toBeVisible();
    expect(trigger("Product")).toHaveFocus();
  });

  it("opens with the down arrow, focuses the first link, and moves with the arrows", async () => {
    const user = userEvent.setup();
    render(<LandingHeader />);
    trigger("Solutions").focus();
    await user.keyboard("{ArrowDown}");
    const panel = document.getElementById(trigger("Solutions").getAttribute("aria-controls")!)!;
    const links = within(panel).getAllByRole("link");
    expect(links[0]).toHaveTextContent("For owners");
    expect(links[0]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(links[1]).toHaveFocus();
    await user.keyboard("{End}");
    expect(links.at(-1)).toHaveTextContent("For finance");
    expect(links.at(-1)).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(links.at(-2)).toHaveFocus();
  });

  it("keeps one menu open at a time and closes on a click outside", async () => {
    const user = userEvent.setup();
    render(<><LandingHeader /><p>Outside</p></>);
    await user.click(trigger("Company"));
    const panel = document.getElementById(trigger("Company").getAttribute("aria-controls")!)!;
    expect(within(panel).getByRole("link", { name: /Careers/ })).toHaveAttribute("href", "/careers");
    await user.click(trigger("Product"));
    expect(trigger("Company")).toHaveAttribute("aria-expanded", "false");
    expect(trigger("Product")).toHaveAttribute("aria-expanded", "true");
    fireEvent.pointerDown(screen.getByText("Outside"));
    expect(trigger("Product")).toHaveAttribute("aria-expanded", "false");
  });

  it("folds every menu into one phone sheet with sections, closed by Escape", async () => {
    const user = userEvent.setup();
    render(<LandingHeader />);
    // The menu button shows only on narrow screens (a media query the test DOM does not apply).
    const menuButton = document.querySelector<HTMLButtonElement>("button[aria-controls='landing-menu']")!;
    expect(menuButton).toHaveAttribute("aria-label", "Open menu");
    fireEvent.click(menuButton);
    expect(menuButton).toHaveAttribute("aria-label", "Close menu");
    const sheet = screen.getByRole("navigation", { name: "Menu" });
    const product = within(sheet).getByRole("button", { name: "Product" });
    expect(product).toHaveAttribute("aria-expanded", "true");
    expect(within(sheet).getByRole("link", { name: "Client portal" })).toHaveAttribute("href", "/#portal");
    await user.click(within(sheet).getByRole("button", { name: "Solutions" }));
    expect(within(sheet).getByRole("button", { name: "Solutions" })).toHaveAttribute("aria-expanded", "true");
    expect(within(sheet).getByRole("link", { name: "For site teams" })).toHaveAttribute("href", "/#for-site-teams");
    expect(within(sheet).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(document.documentElement.style.overflow).toBe("hidden");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("navigation", { name: "Menu" })).toBeNull();
    expect(menuButton).toHaveFocus();
    expect(menuButton).toHaveAttribute("aria-expanded", "false");
    expect(document.documentElement.style.overflow).toBe("");
  });
});
