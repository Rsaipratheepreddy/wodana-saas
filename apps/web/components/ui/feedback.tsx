import type { ReactNode } from "react";
import { Icon } from "./icon";
import styles from "./ui.module.css";

type CalloutTone = "info" | "success" | "warning";

const calloutTone = {
  info: styles.calloutInfo,
  success: styles.calloutSuccess,
  warning: styles.calloutWarning,
};

export function Callout({ children, title, tone = "info" }: { children: ReactNode; title: string; tone?: CalloutTone }) {
  return (
    <div className={`${styles.callout} ${calloutTone[tone]}`} role={tone === "warning" ? "alert" : "status"}>
      <Icon name={tone === "warning" ? "warning" : tone === "success" ? "check" : "info"} />
      <div>
        <p className={styles.calloutTitle}>{title}</p>
        <p className={styles.calloutCopy}>{children}</p>
      </div>
    </div>
  );
}

export function Progress({ label, value }: { label: string; value: number }) {
  const safeValue = Math.min(100, Math.max(0, value));
  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={safeValue}
      className={styles.progressTrack}
      role="progressbar"
    >
      <div className={styles.progressValue} style={{ width: `${safeValue}%` }} />
    </div>
  );
}

export function Skeleton({ height = 12, width = "100%" }: { height?: number; width?: number | string }) {
  return <span aria-hidden="true" className={styles.skeleton} style={{ display: "block", height, width }} />;
}
