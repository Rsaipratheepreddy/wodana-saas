import type { ReactNode } from "react";
import styles from "./ui.module.css";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: styles.badgeNeutral,
  success: styles.badgeSuccess,
  warning: styles.badgeWarning,
  danger: styles.badgeDanger,
  info: styles.badgeInfo,
};

export function Badge({
  children,
  dot = false,
  tone = "neutral",
}: {
  children: ReactNode;
  dot?: boolean;
  tone?: Tone;
}) {
  return (
    <span className={`${styles.badge} ${tones[tone]}`}>
      {dot ? <span aria-hidden="true" className={styles.dot} /> : null}
      {children}
    </span>
  );
}
