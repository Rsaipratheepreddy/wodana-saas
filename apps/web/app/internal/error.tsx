"use client";

import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/design-system";
import styles from "./portal.module.css";

export default function InternalPortalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className={styles.errorPage}>
      <span><AlertCircle aria-hidden="true" size={20} /></span>
      <p>Wodana control</p>
      <h1>Tenant controls are temporarily unavailable</h1>
      <p>Retry the Wodana management connection. If the problem continues, contact the platform team.</p>
      <div><Button onPress={reset} variant="primary"><RotateCw size={15} />Retry</Button></div>
    </main>
  );
}
