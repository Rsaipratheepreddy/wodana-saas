"use client";

import { useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Woddy } from "../components/woddy";

const subscribeNothing = () => () => undefined;

export type TourLoaderProps = {
  /** "Getting the tour ready…" or "Back to your workspace…" */
  message: string;
  /** How far it has got, 0 to 1. */
  progress: number;
  /** Fades out; the loader is removed by its owner afterwards. */
  leaving?: boolean;
  direction?: "ltr" | "rtl";
  /** Tenant brand variables, so the progress follows the workspace colour. */
  style?: CSSProperties;
};

/**
 * The calm full-screen moment while a tour opens its first screen, or while the workspace comes back after it:
 * Woddy thinking, one line and a thin progress bar. It covers the page completely, so half-loaded screens and
 * demo state are never seen.
 */
export function TourLoader({ message, progress, leaving = false, direction = "ltr", style }: TourLoaderProps) {
  // Rendered in the browser only; false during server rendering and hydration.
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  if (!mounted) return null;
  const value = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return createPortal(
    <div aria-busy={!leaving} className="wd-tour-loader" data-leaving={leaving || undefined} data-react-aria-top-layer="true" dir={direction} style={style}>
      <div className="wd-tour-loader-body" role="status">
        <Woddy className="wd-tour-loader-woddy" decorative motion="idle" pose="thinking" size={88} />
        <p className="wd-tour-loader-text">{message}</p>
        <div aria-hidden="true" className="wd-tour-loader-track">
          <span className="wd-tour-loader-bar" style={{ inlineSize: `${Math.max(8, value)}%` }} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
