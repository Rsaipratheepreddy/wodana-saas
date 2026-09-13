import Image from "next/image";
import type { HTMLAttributes } from "react";
import styles from "./wodana-logo.module.css";

export type WodanaLogoProps = HTMLAttributes<HTMLSpanElement> & {
  size?: "standard" | "large";
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
        <Image
          alt=""
          className={styles.logoImage}
          height={724}
          priority
          sizes={size === "large" ? "148px" : "124px"}
          src="/brand/wodana/wodana-logo-v4.png"
          width={2172}
        />
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
    </span>
  );
}
