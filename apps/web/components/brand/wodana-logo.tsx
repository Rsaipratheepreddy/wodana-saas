import Image from "next/image";
import type { HTMLAttributes } from "react";
import styles from "./wodana-logo.module.css";

export type WodanaLogoProps = HTMLAttributes<HTMLSpanElement> & {
  size?: "micro" | "compact" | "small" | "standard" | "large";
  subtitle?: string;
};

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
      role="img"
    >
      <span className={styles.wordmark}>
        <span className={styles.artwork}>
          <Image
            alt=""
            className={styles.logoImage}
            height={587}
            priority
            sizes={size === "large" ? "148px" : size === "standard" ? "124px" : size === "small" ? "76px" : size === "compact" ? "54px" : "45px"}
            src="/brand/wodana/wodana-logo-v5.png"
            width={1973}
          />
        </span>
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
    </span>
  );
}
