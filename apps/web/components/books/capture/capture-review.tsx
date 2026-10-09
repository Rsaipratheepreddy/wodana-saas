"use client";

import { ExternalLink } from "lucide-react";
import { Button, Callout, InlineNotice, Woddy } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown, type Translate } from "@/lib/i18n/keys";
import type { CaptureField, CaptureState, CaptureWarning } from "@/lib/books/capture-client";
import { useProjectFormat } from "../../project-core/format";
import styles from "./capture.module.css";

/**
 * The bill as it was photographed, beside the draft Woddy read from it: the original, how sure the reading is,
 * and what to look at before saving (a bill already entered, a total that doesn't add up, a supplier not found).
 */
export function CaptureReview({ state, fileUrl, onRetry, retrying = false }: { state: CaptureState; fileUrl: string; onRetry?: () => void; retrying?: boolean }) {
  const t = useT();
  const format = useProjectFormat();
  const { capture, proposal } = state;
  const pdf = capture.contentType === "application/pdf";
  const confidence = capture.confidence === null ? null : Math.round(Number(capture.confidence) * 100);
  const money = (value: string) => (proposal?.currency ? format.money(value, proposal.currency) : value);
  const failed = capture.status === "failed";
  return <aside aria-label={t("The original bill")} className={styles.original}>
    {/* A reading that failed is said first and plainly, with why and Retry; the photo stays beside the form to enter it by hand. */}
    {failed ? <Callout tone="danger" title={t("Couldn't read the bill")}
      actions={onRetry ? <Button size="compact" isLoading={retrying} onPress={onRetry}>{t("Retry")}</Button> : undefined}>
      <span>{t("Enter it by hand or try again.")}</span>
      {capture.error ? <small className={styles.reason}>{translateKnown(t, capture.error)}</small> : null}
    </Callout> : null}
    <a className={styles.page} href={fileUrl} rel="noreferrer" target="_blank">
      {pdf ? <object aria-label={capture.fileName} className={styles.pdf} data={fileUrl} type="application/pdf"><span>{capture.fileName}</span></object>
        : <img alt={t("Photo of the bill")} className={styles.photo} src={fileUrl} />}
      <span className={styles.open}><ExternalLink aria-hidden="true" data-directional="true" size={12} />{t("Open the original")}</span>
    </a>
    {failed ? null : <p className={styles.read}><Woddy decorative pose="celebrating" size={20} />
      <span>{capture.status === "reading" ? t("Woddy is still reading. You'll be told when it's done.")
        : confidence !== null ? t("Read by Woddy, {percent}% sure. Check it before saving.", { percent: confidence }) : t("Read by Woddy. Check it before saving.")}</span></p>}
    {state.duplicate ? <InlineNotice message={t("This bill was already captured.")} tone="info" /> : null}
    {proposal?.warnings.map((warning) => <InlineNotice key={warning.code} message={warningText(t, warning, money, format.day)} tone={warning.code === "duplicate_bill" ? "error" : "info"} />)}
  </aside>;
}

export function warningText(t: Translate, warning: CaptureWarning, money: (value: string) => string, day: (value: string) => string) {
  switch (warning.code) {
    case "duplicate_bill": return t("Invoice {number} from this supplier is already entered.", { number: warning.number });
    case "total_mismatch": return t("The bill says {stated}; its lines add up to {computed}.", { stated: money(warning.stated), computed: money(warning.computed) });
    case "supplier_not_found": return warning.name ? t("{name} isn't one of your suppliers yet. Choose the supplier.", { name: warning.name }) : t("Woddy couldn't tell the supplier. Choose the supplier.");
    case "order_other_currency": return t("{order} is in {currency}, so its lines weren't used.", { order: warning.order, currency: warning.currency });
    case "future_date": return t("The invoice date {date} is in the future.", { date: day(warning.date) });
  }
}

/** The hint under a field Woddy wasn't sure of, while it still holds what Woddy read. */
export function captureHint(t: Translate, state: CaptureState | null, field: CaptureField, untouched: boolean) {
  const hint = untouched ? state?.proposal?.hints[field] : undefined;
  return hint === "check" ? t("Woddy wasn't sure. Check it.") : hint === "missing" ? t("Woddy couldn't read this.") : undefined;
}
