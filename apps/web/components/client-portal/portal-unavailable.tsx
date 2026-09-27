"use client";

import { DesignSystemProvider, EmptyState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./portal.module.css";
import { useDeviceTheme } from "./use-device-theme";

/** A link that doesn't open a portal: switched off, mistyped, or an old link. */
export function PortalUnavailable() {
  const t = useT();
  const theme = useDeviceTheme();
  return <DesignSystemProvider theme={theme}>
    <div className={styles.page}>
      <main className={styles.main}>
        <EmptyState illustration="locked" title={t("This project page isn't available")}
          description={t("Open the latest link your project team sent you, or ask them for a new one.")} />
      </main>
    </div>
  </DesignSystemProvider>;
}
