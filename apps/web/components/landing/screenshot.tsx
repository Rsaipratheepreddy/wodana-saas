import { preload } from "react-dom";
import type { Translate } from "@/lib/i18n/keys";
import { DeferredPicture } from "./deferred-picture";
import { pictureOf, type Shot } from "./landing-shots";

/**
 * A product screenshot in the visitor's theme: the dark capture on a dark system, else the light one, as AVIF with a
 * WebP fallback. The variants are static files (see landing-shots.ts), so the browser fetches only the one it shows,
 * at the size it needs, straight from the file server. The pixel size is known so nothing shifts while it loads.
 * - `priority`: the one image that paints first (the hero); eager, high priority and preloaded from the head.
 * - `defer`: no source until the page has loaded or the product tour asks for it (see deferred-picture.tsx).
 * - otherwise: lazy, decoded off the main thread.
 */
export function Screenshot({ shot, t, sizes, priority = false, defer = false, decorative = false, className, layer }: {
  shot: Shot;
  t: Translate;
  sizes: string;
  priority?: boolean;
  defer?: boolean;
  /** A duplicate of a screen described elsewhere (a cross-fade layer): hidden from assistive tech. */
  decorative?: boolean;
  className?: string;
  /** Its place in a stack of cross-fading screens. */
  layer?: number;
}) {
  const picture = pictureOf(shot, sizes);
  if (!picture) return null;
  const alt = decorative ? "" : t(shot.alt);
  if (defer) return <DeferredPicture alt={alt} className={className} decorative={decorative} layer={layer} picture={picture} />;
  if (priority) {
    for (const source of picture.sources.filter((item) => item.type === "image/avif")) {
      preload(source.srcSet.split(" ")[0] ?? "", {
        as: "image", fetchPriority: "high", imageSizes: sizes, imageSrcSet: source.srcSet, type: source.type,
        media: source.media ?? "not all and (prefers-color-scheme: dark)",
      });
    }
  }
  return <picture className={className} data-layer={layer}>
    {picture.sources.map((source) => <source key={`${source.type} ${source.media ?? ""}`} media={source.media} sizes={sizes}
      srcSet={source.srcSet} type={source.type} />)}
    <img alt={alt} aria-hidden={decorative || undefined} decoding={priority ? undefined : "async"} fetchPriority={priority ? "high" : undefined}
      height={picture.height} loading={priority ? "eager" : "lazy"} src={picture.src} width={picture.width} />
  </picture>;
}
