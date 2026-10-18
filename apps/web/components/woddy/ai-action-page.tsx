"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorState, NoAccessState, PageHeader, Skeleton, isNoAccessError } from "@/design-system";
import { APPROVALS_CHANGED } from "@/components/approvals/use-waiting-count";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { WoddyCardError, readWoddyCard, type WoddyCard } from "@/lib/woddy/agent";
import { WoddyActionCard } from "./woddy-action-card";
import styles from "./ai-action-page.module.css";

/**
 * A change an AI app prepared (over MCP) as this person: exactly what it changes, to confirm or cancel here.
 * Opened from Approvals or the notice; deciding updates the waiting count everywhere.
 */
export function AiActionPage({ workspaceId, toolCallId }: { workspaceId: string; toolCallId: string }) {
  const t = useT();
  const [card, setCard] = useState<WoddyCard | null>(null);
  const [error, setError] = useState<{ message: string; noAccess: boolean; missing: boolean } | null>(null);
  const load = useCallback(async () => {
    try { setCard(await readWoddyCard(workspaceId, toolCallId)); setError(null); }
    catch (cause) {
      setError({
        message: cause instanceof Error ? translateKnown(t, cause.message) : t("The action could not be completed."),
        noAccess: isNoAccessError(cause), missing: cause instanceof WoddyCardError && cause.status === 404,
      });
    }
  }, [t, toolCallId, workspaceId]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const content = error && !card
    ? error.noAccess ? <NoAccessState /> : <ErrorState description={error.message} onRetry={error.missing ? undefined : () => void load()} />
    : !card ? <Skeleton lines={5} shape="form" />
    : <WoddyActionCard card={card} key={card.id} onChange={() => window.dispatchEvent(new Event(APPROVALS_CHANGED))} workspaceId={workspaceId} />;
  return <div className={styles.page}>
    <PageHeader title={t("Waiting for your OK")} description={card?.clientName ? t("Prepared by {app}", { app: card.clientName }) : undefined} />
    <div className={styles.content}>{content}</div>
  </div>;
}
