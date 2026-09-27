import type { HTMLAttributes } from "react";
import { LOGO_VIEWBOX, MARK_ARCH, MARK_BODY, MARK_DOOR, MARK_VIEWBOX, WORDMARK, WORDMARK_STROKE, WORDMARK_TRANSFORM } from "./wodana-logo-paths";
import styles from "./wodana-logo.module.css";

export type WodanaLogoProps = HTMLAttributes<HTMLSpanElement> & {
  size?: "micro" | "compact" | "small" | "standard" | "large";
  subtitle?: string;
  /** Only the house, for tight spots such as a collapsed sidebar. */
  markOnly?: boolean;
};

/* The mark's colours are the brand's own and stay the same in every theme; the wordmark follows the text colour. */
function Mark() {
  return <>
    <path d={MARK_BODY} fill="#01A92D" />
    <path d={MARK_ARCH} fill="#fff" />
    <path d={MARK_DOOR} fill="#007A2A" />
  </>;
}

/** The Wodana logo, drawn inline so it is crisp at any size and reads the same in every language direction. */
export function WodanaLogo({ className, markOnly = false, size = "standard", subtitle, ...props }: WodanaLogoProps) {
  return (
    <span {...props} aria-label="Wodana" className={[styles.logo, className].filter(Boolean).join(" ")} data-size={size} dir="ltr" role="img">
      {markOnly
        ? <svg aria-hidden="true" className={styles.artwork} focusable="false" viewBox={MARK_VIEWBOX}><Mark /></svg>
        : <svg aria-hidden="true" className={styles.artwork} focusable="false" viewBox={LOGO_VIEWBOX}>
          <g transform="translate(-277 -250)"><Mark /></g>
          <path d={WORDMARK} fill="currentColor" stroke="currentColor" strokeLinejoin="round" strokeWidth={WORDMARK_STROKE} transform={WORDMARK_TRANSFORM} />
        </svg>}
      {subtitle ? <small className={styles.subtitle}>{subtitle}</small> : null}
    </span>
  );
}
