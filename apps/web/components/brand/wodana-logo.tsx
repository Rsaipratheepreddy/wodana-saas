import type { HTMLAttributes } from "react";
import styles from "./wodana-logo.module.css";

export type WodanaLogoProps = HTMLAttributes<HTMLSpanElement> & {
  size?: "micro" | "compact" | "small" | "standard" | "large";
  subtitle?: string;
};

/** The Wodana lockup: the house mark and the wordmark set in the product font. It reads the same in every language direction. */
export function WodanaLogo({
  className,
  size = "standard",
  subtitle,
  ...props
}: WodanaLogoProps) {
  return (
    <span
      {...props}
      aria-label="Wodana"
      className={[styles.logo, className].filter(Boolean).join(" ")}
      data-size={size}
      dir="ltr"
      role="img"
    >
      <span className={styles.lockup} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- a tiny static SVG; next/image adds nothing here */}
        <img alt="" className={styles.mark} src="/brand/logo/wodana-mark.svg" />
        <span className={styles.wordmark}>wodana</span>
      </span>
      {subtitle ? <small className={styles.subtitle}>{subtitle}</small> : null}
    </span>
  );
}
