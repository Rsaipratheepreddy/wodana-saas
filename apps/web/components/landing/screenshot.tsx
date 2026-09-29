import { getImageProps } from "next/image";
import type { Translate } from "@/lib/i18n/keys";
import { darkReady, type Shot } from "./landing-shots";

/**
 * A product screenshot in the visitor's theme: the dark capture on a dark system, else the light one. The browser
 * fetches only the one it shows, at the size it needs; the pixel size is known so nothing shifts while it loads.
 * `priority` is for the one image that paints first (the hero); everything else loads lazily.
 */
export function Screenshot({ shot, t, sizes, priority = false, decorative = false, className, layer }: {
  shot: Shot;
  t: Translate;
  sizes: string;
  priority?: boolean;
  /** A duplicate of a screen described elsewhere (a cross-fade layer): hidden from assistive tech. */
  decorative?: boolean;
  className?: string;
  /** Its place in a stack of cross-fading screens. */
  layer?: number;
}) {
  const alt = decorative ? "" : t(shot.alt);
  const loading = priority ? { loading: "eager" as const, fetchPriority: "high" as const } : { loading: "lazy" as const };
  const common = { alt, width: shot.width, height: shot.height, sizes };
  const { props: light } = getImageProps({ ...common, src: shot.src, ...loading });
  const dark = darkReady(shot) ? getImageProps({ ...common, src: shot.dark }).props.srcSet : null;
  return <picture className={className} data-layer={layer}>
    {dark ? <source media="(prefers-color-scheme: dark)" sizes={sizes} srcSet={dark} /> : null}
    <img {...light} alt={alt} aria-hidden={decorative || undefined} />
  </picture>;
}
