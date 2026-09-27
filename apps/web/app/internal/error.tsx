"use client";

import { ErrorState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "@/components/control-plane/control-plane.module.css";

export default function InternalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  return <main className={styles.page}>
    <ErrorState title={t("Wodana Control is unavailable")} description={t("Try again. If it keeps failing, tell the platform team.")} onRetry={reset} />
  </main>;
}
