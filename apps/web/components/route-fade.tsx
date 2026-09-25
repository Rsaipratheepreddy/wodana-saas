"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";

/** Animate route content without remounting pages or the persistent app shell. */
export function RouteFade() {
  const pathname = usePathname();
  const previousPathname = useRef(pathname);

  useLayoutEffect(() => {
    // The document's CSS animation already handles its initial appearance.
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const content = document.querySelector("main") ?? document.body;
    if (motionPreference.matches || typeof content.animate !== "function") return;

    const animation = content.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], {
      duration: 260,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    });
    const cancel = () => animation.cancel();
    motionPreference.addEventListener("change", cancel);
    return () => {
      cancel();
      motionPreference.removeEventListener("change", cancel);
    };
  }, [pathname]);

  return null;
}
