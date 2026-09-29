"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { PictureData } from "./landing-shots";

/**
 * When a deferred screenshot may start loading. Inside the product tour the tour decides (its tab is chosen, or the
 * tour comes into view); elsewhere (null) it waits for the page's load event, so it never competes with the first
 * paint, or at the latest a few seconds in, just before the hero's cross-fade shows it.
 */
export const ImageGate = createContext<boolean | null>(null);

const FALLBACK_MS = 4000;

const onLoad = (notify: () => void) => {
  window.addEventListener("load", notify);
  return () => window.removeEventListener("load", notify);
};

function useAfterLoad(enabled: boolean) {
  const complete = useSyncExternalStore(onLoad, () => document.readyState === "complete", () => false);
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!enabled || complete) return;
    const timer = window.setTimeout(() => setLate(true), FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, complete]);
  return complete || late;
}

/**
 * A screenshot that is in the page from the start (so its box and any animation are in place) but has no image
 * source until its gate opens; then it loads lazily and decodes off the main thread.
 */
export function DeferredPicture({ picture, alt, decorative, className, layer }: {
  picture: PictureData;
  alt: string;
  decorative?: boolean;
  className?: string;
  layer?: number;
}) {
  const gate = useContext(ImageGate);
  const loaded = useAfterLoad(gate === null);
  const ready = gate ?? loaded;
  return <picture className={className} data-layer={layer}>
    {ready ? picture.sources.map((source) => <source key={`${source.type} ${source.media ?? ""}`} media={source.media}
      sizes={picture.sizes} srcSet={source.srcSet} type={source.type} />) : null}
    <img alt={alt} aria-hidden={decorative || undefined} decoding="async" height={picture.height} key={ready ? "ready" : "waiting"}
      loading="lazy" src={ready ? picture.src : undefined} style={{ aspectRatio: `${picture.width} / ${picture.height}` }} width={picture.width} />
  </picture>;
}
