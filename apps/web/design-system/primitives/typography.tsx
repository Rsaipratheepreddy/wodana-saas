import { forwardRef, type HTMLAttributes } from "react";

function classes(...values: Array<string | undefined>) { return values.filter(Boolean).join(" "); }

export const Text = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement> & { tone?: "default" | "muted" | "danger"; size?: "xs" | "sm" | "md" }>(function Text(
  { className, size = "sm", tone = "default", ...props }, ref,
) {
  return <p {...props} className={classes("wd-text", className)} data-size={size} data-tone={tone} ref={ref} />;
});

export function Heading({ as: Tag = "h2", className, size = "md", ...props }: HTMLAttributes<HTMLHeadingElement> & { as?: "h1" | "h2" | "h3" | "h4"; size?: "sm" | "md" | "lg" }) {
  return <Tag {...props} className={classes("wd-heading", className)} data-size={size} />;
}

export function LabelText(props: HTMLAttributes<HTMLSpanElement>) { return <span {...props} className={classes("wd-label", props.className)} />; }
export function Caption(props: HTMLAttributes<HTMLSpanElement>) { return <span {...props} className={classes("wd-caption", props.className)} />; }
export function MetricText(props: HTMLAttributes<HTMLSpanElement>) { return <span {...props} className={classes("wd-metric", props.className)} />; }
export function Code(props: HTMLAttributes<HTMLElement>) { return <code {...props} className={classes("wd-code", props.className)} />; }
export function LocalizedValue({ children, ...props }: HTMLAttributes<HTMLSpanElement>) { return <span {...props} className={classes("wd-localized-value", props.className)} dir="ltr">{children}</span>; }
export function TextLink({ className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) { return <a {...props} className={classes("wd-text-link", className)} />; }
export function UnorderedList(props: React.HTMLAttributes<HTMLUListElement>) { return <ul {...props} className={classes("wd-list", props.className)} />; }
export function OrderedList(props: React.HTMLAttributes<HTMLOListElement>) { return <ol {...props} className={classes("wd-list", props.className)} />; }
