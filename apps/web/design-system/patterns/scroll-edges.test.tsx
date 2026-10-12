import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScrollEdgeButtons } from "./scroll-edges";
import { markOverflow, overflowSides } from "./table-viewport";

const frame = (scrollWidth: number, clientWidth: number, scrollLeft: number) => ({ scrollWidth, clientWidth, scrollLeft });

describe("sideways overflow without drawn scrollbars (UX-030/031)", () => {
  it("names the sides that hide content, in either writing direction", () => {
    expect(overflowSides(frame(1188, 1142, 0))).toBe("end");
    expect(overflowSides(frame(1480, 1144, 120))).toBe("both");
    expect(overflowSides(frame(1480, 1144, 336))).toBe("start");
    // Right to left scrolls with a negative offset.
    expect(overflowSides(frame(1480, 1144, -336))).toBe("start");
    // A few pixels of border or focus ring are not content.
    expect(overflowSides(frame(1145, 1142, 0))).toBeNull();
  });

  it("marks the frame so its hidden side fades, and the fade follows the writing direction", () => {
    const element = document.createElement("div");
    Object.defineProperties(element, { scrollWidth: { value: 1188 }, clientWidth: { value: 1142 }, scrollLeft: { value: 0, writable: true } });
    markOverflow(element);
    expect(element.getAttribute("data-overflow")).toBe("end");
    const css = readFileSync(join(__dirname, "../styles/record-tables.css"), "utf8");
    expect(css).toMatch(/\.wd-scroll-fade\)\[data-overflow="end"\] \{ mask-image: linear-gradient\(to right/);
    expect(css).toMatch(/\[dir="rtl"\] :is\([^)]*\.wd-scroll-fade\)\[data-overflow="end"\] \{ mask-image: linear-gradient\(to left/);
    // Table frames draw their thin scrollbar despite the app-wide "no scrollbars" rule.
    expect(css).toContain("scrollbar-width: thin !important;");
  });

  it("offers buttons to page across only while something is hidden", async () => {
    const onScroll = vi.fn();
    const { rerender } = render(<ScrollEdgeButtons edges={{ start: false, end: true }} onScroll={onScroll} startLabel="Earlier stages" endLabel="Later stages" />);
    expect(screen.getByRole("button", { name: "Earlier stages" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Later stages" }));
    expect(onScroll).toHaveBeenCalledWith(1);
    rerender(<ScrollEdgeButtons edges={{ start: false, end: false }} onScroll={onScroll} />);
    expect(screen.queryByRole("group", { name: "Scroll" })).toBeNull();
  });
});
