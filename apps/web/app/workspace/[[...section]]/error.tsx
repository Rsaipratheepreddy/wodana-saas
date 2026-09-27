"use client";

import Link from "next/link";
import { DesignSystemProvider, EmptyState, ErrorState, isNoAccessError, NoAccessState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./workspace-error.module.css";

/**
 * What went wrong, said truthfully: a page the role can't open, a page that doesn't exist, or a
 * service that didn't answer (the only case where trying again can help). Pages check access
 * before loading, so a production server error, whose message is hidden, is a service failure.
 */
export default function WorkspaceScreenError({ error, retry, reset }: { error: Error & { digest?: string; status?: number }; retry?: () => void; reset?: () => void }) {
  const t = useT();
  const notFound = error.status === 404 || /\bnot found\b|\bno longer exists\b/i.test(error.message ?? "");
  return (
    <DesignSystemProvider className={styles.root}>
      {isNoAccessError(error) ? <NoAccessState />
        : notFound ? <EmptyState illustration="search" title={t("This page doesn't exist")} action={<Link className="wd-button" data-variant="secondary" href="/workspace">{t("Go to Home")}</Link>} />
          : <ErrorState title={t("This page didn't load")} description={t("The service didn't answer. Check your connection, then try again.")} onRetry={() => (retry ?? reset)?.()} />}
    </DesignSystemProvider>
  );
}
