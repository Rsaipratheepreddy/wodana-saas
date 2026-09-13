import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteFade } from "./route-fade";

const route = vi.hoisted(() => ({ pathname: "/workspace" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

const animate = vi.fn();
const removeEventListener = vi.fn();
let reduceMotion = false;
let preferenceChanged: (() => void) | undefined;
function Page() {
  return <><aside>Navigation</aside><main><input aria-label="Page draft" defaultValue="Keep this draft" /></main><RouteFade /></>;
}

beforeEach(() => {
  route.pathname = "/workspace";
  reduceMotion = false;
  preferenceChanged = undefined;
  animate.mockReset().mockImplementation(() => ({ cancel: vi.fn() }));
  removeEventListener.mockReset();
  vi.spyOn(window, "matchMedia").mockImplementation(() => ({
    matches: reduceMotion,
    addEventListener: (_event: string, listener: () => void) => { preferenceChanged = listener; },
    removeEventListener,
  }) as unknown as MediaQueryList);
  vi.stubGlobal("Animation", class {});
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
});
afterEach(() => {
  delete (Element.prototype as Partial<Element>).animate;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("global route fade", () => {
  it("fades incoming content on navigation without resetting page state or animating the shell", () => {
    const { rerender } = render(<Page />);
    const draft = screen.getByRole("textbox");
    expect(animate).not.toHaveBeenCalled();
    route.pathname = "/workspace/hrms/leave";
    rerender(<Page />);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.contexts[0]).toBe(document.querySelector("main"));
    expect(screen.getByRole("textbox")).toBe(draft);
    expect(draft).toHaveValue("Keep this draft");
    rerender(<Page />);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("cancels an unfinished fade on rapid navigation and on unmount", () => {
    const { rerender, unmount } = render(<Page />);
    route.pathname = "/workspace/hrms/leave";
    rerender(<Page />);
    const first = animate.mock.results[0].value;
    route.pathname = "/workspace/hrms/settings";
    rerender(<Page />);
    expect(first.cancel).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenCalledTimes(2);
    unmount();
    expect(animate.mock.results[1].value.cancel).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledTimes(2);
  });

  it("skips reduced motion and cancels a running fade when the preference changes", () => {
    const { rerender } = render(<Page />);
    reduceMotion = true;
    route.pathname = "/workspace/hrms";
    rerender(<Page />);
    expect(animate).not.toHaveBeenCalled();
    reduceMotion = false;
    route.pathname = "/workspace/hrms/leave";
    rerender(<Page />);
    act(() => preferenceChanged?.());
    expect(animate.mock.results[0].value.cancel).toHaveBeenCalledOnce();
  });

  it("keeps navigation usable when browser animations are unavailable", () => {
    delete (Element.prototype as Partial<Element>).animate;
    const { rerender } = render(<Page />);
    route.pathname = "/workspace/hrms";
    rerender(<Page />);
    expect(screen.getByRole("textbox")).toBeVisible();
  });
});
