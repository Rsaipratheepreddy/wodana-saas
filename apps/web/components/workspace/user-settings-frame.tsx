import type { ReactNode } from "react";
import styles from "@/app/workspace/settings/settings.module.css";

export function UserSettingsFrame({ active, children }: { active: "profile" | "security" | "audit-logs"; children: ReactNode }) {
  const label = active === "profile" ? "Profile" : active === "security" ? "Sign-in security" : "Audit history";
  return <section aria-label={label} className={styles.page}>{children}</section>;
}
