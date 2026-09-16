"use client";

import Link from "next/link";
import { AlertCircle, RotateCw } from "lucide-react";
import styles from "./portal.module.css";

export default function InternalPortalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className={styles.errorPage}>
      <span><AlertCircle aria-hidden="true" size={20} /></span>
      <p>Wodana control</p>
      <h1>Tenant controls are temporarily unavailable</h1>
      <p>The workspace remains available. Retry the secure management connection or return to your workspace.</p>
      <div><button onClick={reset} type="button"><RotateCw size={15} />Retry</button><Link href="/workspace">Back to workspace</Link></div>
    </main>
  );
}
