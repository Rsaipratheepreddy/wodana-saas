import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeferredPicture } from "./deferred-picture";
import { FEATURE_TAB_IDS, FeatureTabs, type FeatureTab } from "./feature-tabs";
import { pictureOf, SHOTS } from "./landing-shots";
import { PRODUCT_LINKS } from "./marketing-links";

const tabs: FeatureTab[] = FEATURE_TAB_IDS.map((id) => ({
  id,
  label: `Tab ${id}`,
  title: `Title ${id}`,
  points: [`${id} one`, `${id} two`, `${id} three`],
  visual: <span>{`Screen ${id}`}</span>,
}));

type Observed = (entries: { isIntersecting: boolean }[]) => void;
const callbacks: Observed[] = [];
// Every observer the tour made (it pauses off screen and loads screens as it nears) hears the same entries.
const observed = (entries: { isIntersecting: boolean }[]) => callbacks.forEach((callback) => callback(entries));
class IntersectionObserverMock {
  constructor(callback: Observed) { callbacks.push(callback); }
  observe() {}
  disconnect() {}
}

const setReducedMotion = (reduce: boolean) => Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: (query: string) => ({ matches: reduce && query.includes("reduced-motion"), addEventListener() {}, removeEventListener() {} }),
});

beforeEach(() => {
  callbacks.length = 0;
  vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
  setReducedMotion(false);
  window.history.replaceState(null, "", "/");
});
afterEach(() => { vi.unstubAllGlobals(); setReducedMotion(false); });

const tour = () => screen.getByRole("tablist").parentElement!;
const progress = () => document.querySelector("[role=tab][aria-selected=true] > span[aria-hidden]");

describe("product tour", () => {
  it("shows one tab's title, points and screen at a time", async () => {
    const user = userEvent.setup();
    render(<FeatureTabs label="Product tour" tabs={tabs} />);
    expect(screen.getAllByRole("tab")).toHaveLength(6);
    expect(screen.getByRole("tab", { name: "Tab sales" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Title sales");
    await user.click(screen.getByRole("tab", { name: "Tab projects" }));
    expect(screen.getByRole("tab", { name: "Tab projects" })).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", "projects-panel");
    expect(panel).toHaveTextContent("projects two");
    expect(panel).toHaveTextContent("Screen projects");
    expect(document.getElementById("sales-panel")).toHaveAttribute("aria-hidden", "true");
  });

  it("moves between tabs with the arrows, Home and End", async () => {
    const user = userEvent.setup();
    render(<FeatureTabs label="Product tour" tabs={tabs} />);
    screen.getByRole("tab", { name: "Tab sales" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Tab quotes" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Tab quotes" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Tab portal" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Tab sales" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Tab portal" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Tab sales" })).toHaveAttribute("aria-selected", "true");
  });

  it("advances on its own only while on screen, and pauses on hover and focus", () => {
    render(<FeatureTabs label="Product tour" tabs={tabs} />);
    expect(tour()).not.toHaveAttribute("data-playing");
    act(() => observed([{ isIntersecting: true }]));
    expect(tour()).toHaveAttribute("data-playing");
    fireEvent.animationEnd(progress()!);
    expect(screen.getByRole("tab", { name: "Tab quotes" })).toHaveAttribute("aria-selected", "true");
    fireEvent.pointerEnter(tour());
    expect(tour()).not.toHaveAttribute("data-playing");
    fireEvent.pointerLeave(tour());
    expect(tour()).toHaveAttribute("data-playing");
    fireEvent.focus(screen.getByRole("tab", { name: "Tab quotes" }));
    expect(tour()).not.toHaveAttribute("data-playing");
    act(() => observed([{ isIntersecting: false }]));
    fireEvent.blur(screen.getByRole("tab", { name: "Tab quotes" }));
    expect(tour()).not.toHaveAttribute("data-playing");
  });

  it("stops advancing once a tab is chosen", async () => {
    const user = userEvent.setup();
    render(<FeatureTabs label="Product tour" tabs={tabs} />);
    act(() => observed([{ isIntersecting: true }]));
    expect(progress()).not.toBeNull();
    await user.click(screen.getByRole("tab", { name: "Tab site" }));
    expect(progress()).toBeNull();
  });

  it("never advances with reduced motion", () => {
    setReducedMotion(true);
    render(<FeatureTabs label="Product tour" tabs={tabs} />);
    act(() => observed([{ isIntersecting: true }]));
    expect(progress()).toBeNull();
    expect(tour()).not.toHaveAttribute("data-playing");
  });

  it("opens the tab a link names (/#portal)", () => {
    window.history.replaceState(null, "", "/#portal");
    render(<FeatureTabs label="Product tour" tabs={tabs} />);
    expect(screen.getByRole("tab", { name: "Tab portal" })).toHaveAttribute("aria-selected", "true");
    act(() => {
      window.history.replaceState(null, "", "/#purchasing");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("tab", { name: "Tab purchasing" })).toHaveAttribute("aria-selected", "true");
  });

  it("loads the current and next tab's screens as the tour nears the screen, and any other tab's when it is chosen", async () => {
    const user = userEvent.setup();
    const picture = pictureOf(SHOTS.pipeline, "40rem")!;
    const withScreens = tabs.map((tab) => ({ ...tab, visual: <DeferredPicture alt={`Screen ${tab.id}`} picture={picture} /> }));
    render(<FeatureTabs label="Product tour" tabs={withScreens} />);
    const loaded = () => FEATURE_TAB_IDS.filter((id) => document.querySelector(`#${id}-panel img`)?.hasAttribute("src"));
    expect(loaded()).toEqual([]);
    expect(document.querySelector("#sales-panel source")).toBeNull();
    act(() => observed([{ isIntersecting: true }]));
    expect(loaded()).toEqual(["sales", "quotes"]);
    expect(document.querySelector("#sales-panel source[type='image/avif']")?.getAttribute("srcset")).toContain("1440w");
    await user.click(screen.getByRole("tab", { name: "Tab portal" }));
    expect(loaded()).toEqual(["sales", "quotes", "portal"]);
  });

  it("has a tab for every Product menu link except the mobile app section", () => {
    const hashes = PRODUCT_LINKS.map((link) => link.href.replace("/#", ""));
    expect(hashes.filter((hash) => hash !== "mobile").every((hash) => (FEATURE_TAB_IDS as readonly string[]).includes(hash))).toBe(true);
  });
});
