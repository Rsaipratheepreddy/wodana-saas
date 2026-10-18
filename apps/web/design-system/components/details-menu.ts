"use client";

import { useCallback, useEffect, useRef, type MouseEvent } from "react";

/**
 * A `<details>` used as a menu or filter panel behaves like every other popover: a click or tap outside closes it,
 * Esc closes it (focus goes back to its summary), and clicking inside it (a checkbox, its label, a search box) never
 * does, except choosing a single option or an action when `closeOnChoose` is set. Spread the result on the `<details>`.
 */
export function useDetailsMenu({ closeOnChoose = false }: { closeOnChoose?: boolean } = {}) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const details = ref.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      const details = ref.current;
      if (event.key !== "Escape" || !details?.open) return;
      details.open = false;
      details.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const onClick = useCallback((event: MouseEvent<HTMLDetailsElement>) => {
    const details = ref.current;
    if (!closeOnChoose || !details) return;
    const target = event.target instanceof Element ? event.target : null;
    // A link or a button chosen inside closes it; its own summary, a field or a checkbox does not.
    if (target && !target.closest("summary") && target.closest("a[href], button:not([aria-haspopup]):not([disabled])")) details.open = false;
  }, [closeOnChoose]);
  return { ref, onClick };
}
