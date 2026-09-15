import Link from "next/link";
import type { ReactNode } from "react";
import styles from "@/app/workspace/settings/settings.module.css";

export function UserSettingsFrame({ active, children }: { active: "security" | "audit-logs"; children: ReactNode }) {
  return <section className={styles.page} aria-label="User Settings">
    <header><h1>User Settings</h1></header>
    <nav aria-label="User Settings sections" className={styles.tabs}>
      <Link aria-current={active === "security" ? "page" : undefined} href="/workspace/settings/security">Security</Link>
      <Link aria-current={active === "audit-logs" ? "page" : undefined} href="/workspace/settings/audit-logs">Audit Logs</Link>
    </nav>
    {children}
  </section>;
}
