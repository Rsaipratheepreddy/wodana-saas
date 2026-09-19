import { forwardRef, type CSSProperties, type HTMLAttributes } from "react";

type ElementProps = HTMLAttributes<HTMLDivElement> & { as?: "div" | "section" | "article" | "aside" | "main" };
type Space = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 13 | 16 | 21;

function classes(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export const Box = forwardRef<HTMLDivElement, ElementProps>(function Box({ as: Tag = "div", className, ...props }, ref) {
  return <Tag {...props} className={classes("wd-box", className)} ref={ref} />;
});

export const Stack = forwardRef<HTMLDivElement, ElementProps & { gap?: Space }>(function Stack(
  { as: Tag = "div", className, gap = 4, style, ...props },
  ref,
) {
  return <Tag {...props} className={classes("wd-stack", className)} ref={ref} style={{ ...style, "--wd-gap": `var(--wd-space-${gap})` } as CSSProperties} />;
});

export const Inline = forwardRef<HTMLDivElement, ElementProps & { align?: "start" | "center" | "end"; gap?: Space; wrap?: boolean }>(function Inline(
  { as: Tag = "div", align = "center", className, gap = 2, style, wrap = true, ...props },
  ref,
) {
  return <Tag {...props} className={classes("wd-inline", className)} data-align={align} data-wrap={wrap} ref={ref} style={{ ...style, "--wd-gap": `var(--wd-space-${gap})` } as CSSProperties} />;
});

export const Grid = forwardRef<HTMLDivElement, ElementProps & { min?: number; gap?: Space }>(function Grid(
  { as: Tag = "div", className, gap = 4, min = 240, style, ...props },
  ref,
) {
  return <Tag {...props} className={classes("wd-grid", className)} ref={ref} style={{ ...style, "--wd-gap": `var(--wd-space-${gap})`, "--wd-grid-min": `${min}px` } as CSSProperties} />;
});

export const Surface = forwardRef<HTMLDivElement, ElementProps & { tone?: "default" | "subtle" | "raised" }>(function Surface(
  { as: Tag = "div", className, tone = "default", ...props },
  ref,
) {
  return <Tag {...props} className={classes("wd-surface", className)} data-tone={tone} ref={ref} />;
});

export const Container = forwardRef<HTMLDivElement, ElementProps & { size?: "form" | "narrow" | "wide" | "full" }>(function Container(
  { as: Tag = "div", className, size = "wide", ...props },
  ref,
) {
  return <Tag {...props} className={classes("wd-container", className)} data-size={size} ref={ref} />;
});

export const Split = forwardRef<HTMLDivElement, ElementProps>(function Split({ as: Tag = "div", className, ...props }, ref) {
  return <Tag {...props} className={classes("wd-split", className)} ref={ref} />;
});

export function Separator({ orientation = "horizontal", ...props }: HTMLAttributes<HTMLHRElement> & { orientation?: "horizontal" | "vertical" }) {
  return <hr {...props} aria-orientation={orientation} className={classes("wd-separator", props.className)} data-orientation={orientation} />;
}

export const ScrollArea = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function ScrollArea({ className, ...props }, ref) {
  return <div {...props} className={classes("wd-scroll-area", className)} ref={ref} tabIndex={props.tabIndex ?? 0} />;
});

export function AspectRatio({ ratio = 16 / 9, style, ...props }: HTMLAttributes<HTMLDivElement> & { ratio?: number }) {
  return <div {...props} className={classes("wd-aspect-ratio", props.className)} style={{ ...style, aspectRatio: ratio }} />;
}

export function VisuallyHidden(props: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={classes("wd-visually-hidden", props.className)} />;
}
