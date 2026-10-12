"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import { IconButton } from "../components/actions";
import { overflowSides } from "./table-viewport";

export type ScrollEdges = { start: boolean; end: boolean };
const NONE: ScrollEdges = { start: false, end: false };

/**
 * For a sideways scroller whose scrollbar isn't drawn (a board of columns): which inline sides hide content, kept up
 * to date on scroll and resize, and a way to scroll a page toward either side. The element gets `data-overflow`,
 * so with the `wd-scroll-fade` class its hidden side fades out (UX-031).
 */
export function useScrollEdges<E extends HTMLElement>() {
  const [edges, setEdges] = useState<ScrollEdges>(NONE);
  const element = useRef<E | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const ref = useCallback((node: E | null) => {
    cleanup.current?.();
    cleanup.current = null;
    element.current = node;
    if (!node) return;
    const update = () => {
      const sides = overflowSides(node);
      if (sides) node.setAttribute("data-overflow", sides); else node.removeAttribute("data-overflow");
      const next = { start: sides === "start" || sides === "both", end: sides === "end" || sides === "both" };
      setEdges((current) => (current.start === next.start && current.end === next.end ? current : next));
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(update);
      observer.observe(node);
      for (const child of Array.from(node.children)) observer.observe(child);
    }
    cleanup.current = () => { node.removeEventListener("scroll", update); observer?.disconnect(); };
  }, []);
  /** Scrolls most of a view toward the inline start (-1) or end (1), in either direction of writing. */
  const scroll = useCallback((toward: -1 | 1) => {
    const node = element.current;
    if (!node) return;
    const rtl = getComputedStyle(node).direction === "rtl";
    node.scrollBy({ left: toward * (rtl ? -1 : 1) * Math.max(node.clientWidth * 0.8, 1), behavior: "smooth" });
  }, []);
  return { ref, edges, scroll };
}

/** Two quiet buttons that page a sideways scroller back and on; shown only while something is hidden. */
export function ScrollEdgeButtons({ edges, onScroll, startLabel, endLabel }: { edges: ScrollEdges; onScroll: (toward: -1 | 1) => void; startLabel?: string; endLabel?: string }) {
  const t = useT();
  if (!edges.start && !edges.end) return null;
  return <span className="wd-scroll-edge-buttons" role="group" aria-label={t("Scroll")}>
    <IconButton size="compact" aria-label={startLabel ?? t("Scroll back")} isDisabled={!edges.start} onPress={() => onScroll(-1)}><ChevronLeft aria-hidden="true" size={16} /></IconButton>
    <IconButton size="compact" aria-label={endLabel ?? t("Scroll on")} isDisabled={!edges.end} onPress={() => onScroll(1)}><ChevronRight aria-hidden="true" size={16} /></IconButton>
  </span>;
}
