"use client";

import Link from "next/link";
import { EmptyState, ErrorState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown } from "@/lib/i18n/keys";

/** Where a person connects or reconnects QuickBooks or Zoho Books. */
export const RECONNECT_HREF = "/workspace/integrations";

/**
 * Business Core's sentences for a statement it couldn't read from the accounting system (src/books/sources), kept
 * here so the translation pass covers them.
 */
export const SOURCE_MESSAGES = {
  not_connected: tKey("This company isn't connected to the accounting system. Connect it in Settings › Accounting."),
  reconnect: tKey("The accounting connection needs to be connected again before its reports can be read."),
  busy: tKey("The accounting system is busy. Try again in a minute."),
  unavailable: tKey("The accounting system didn't answer. Try again shortly."),
  refused: tKey("The accounting system's report couldn't be read. Check the connection and try again."),
  unsupported: tKey("The accounting system's reports cover the whole company. Project statements come from Wodana's records or the Ledger."),
  not_set_up: tKey("Accounting reports aren't set up for this Wodana yet."),
} as const;

/** Whether reconnecting fixes it: an expired or missing grant (409), or a company not connected yet. */
export function needsReconnect(status: number, message: string) {
  return status === 409 || message === SOURCE_MESSAGES.reconnect || message === SOURCE_MESSAGES.not_connected;
}

/**
 * A statement from QuickBooks or Zoho Books that couldn't be read: what happened and the one next step — Reconnect
 * when the connection needs it, otherwise Try again (the shared ErrorState).
 */
export function StatementSourceErrorState({ status, message, onRetry }: { status: number; message: string; onRetry?: () => void }) {
  const t = useT();
  const description = translateKnown(t, message);
  if (needsReconnect(status, message))
    return <EmptyState illustration="error" title={t("Reconnect the accounting system")} description={description}
      action={<Link className="wd-button" data-variant="primary" href={RECONNECT_HREF}>{t("Reconnect")}</Link>} />;
  return <ErrorState description={description} onRetry={onRetry} />;
}
