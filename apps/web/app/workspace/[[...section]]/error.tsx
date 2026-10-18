"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { Button, DesignSystemProvider, EmptyState, ErrorState, isNoAccessError, NoAccessState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./workspace-error.module.css";

/**
 * What went wrong, said truthfully: a page the role can't open, a page that doesn't exist, a record that
 * changed while it was open (reload to see it), a request the service refused with a reason (shown as
 * sent), or a service that didn't answer (the only case where trying again can help). Pages check access
 * before loading, so a production server error, whose message is hidden, is a service failure.
 */
export default function WorkspaceScreenError({ error, retry, reset }: { error: Error & { digest?: string; status?: number }; retry?: () => void; reset?: () => void }) {
  const t = useT();
  const router = useRouter();
  const status = Number(error.status);
  const notFound = status === 404 || /\bnot found\b|\bno longer exists\b/i.test(error.message ?? "");
  const conflict = status === 409 || /\bversion (?:conflict|mismatch)\b|\bchanged since\b|\bstale version\b/i.test(error.message ?? "");
  const refused = status === 422 && Boolean(error.message);
  const again = () => (retry ?? reset)?.();
  const reload = () => startTransition(() => { router.refresh(); again(); });
  return (
    <DesignSystemProvider className={styles.root}>
      {isNoAccessError(error) ? <NoAccessState />
        : notFound ? <EmptyState illustration="search" title={t("This page doesn't exist")} action={<Link className="wd-button" data-variant="secondary" href="/workspace">{t("Go to Home")}</Link>} />
          : conflict ? <EmptyState illustration="error" title={t("This changed while you were away")} description={t("Someone saved a newer version. Reload to see it, then make your change again.")} action={<Button onPress={reload}>{t("Reload")}</Button>} />
            : refused ? <ErrorState title={t("This couldn't be done")} description={error.message} onRetry={again} />
              : <ErrorState title={t("This page didn't load")} description={t("The service didn't answer. Check your connection, then try again.")} onRetry={again} />}
    </DesignSystemProvider>
  );
}
