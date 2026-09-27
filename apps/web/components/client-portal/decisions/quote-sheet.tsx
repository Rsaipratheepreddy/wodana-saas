"use client";

import { useState } from "react";
import { Button, Checkbox, TextAreaField } from "@/design-system";
import { QuotationDocument } from "@/components/commercial/quotation-document";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import { documentQuote } from "@/lib/client-portal/document-quote";
import type { PortalQuote } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import { StateLabel } from "../portal-labels";
import styles from "../portal.module.css";
import { ConfirmCode } from "./confirm-code";

type Decision = "accept" | "changes" | "decline";

/**
 * A quotation or variation exactly as issued. The decision-maker picks the options they want and accepts,
 * asks for changes or declines; a code confirms it for this revision only.
 */
export function QuoteSheet({ quote, caseId, slug, api, format, channels, onDecided }: {
  quote: PortalQuote; caseId: string; slug: string; api: PortalApi; format: PortalFormat; channels: Array<"whatsapp" | "email">; onDecided: () => void;
}) {
  const t = useT();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const [id] = useState(commandId);
  const optional = quote.lines.filter((line) => line.optional);
  // What the chosen options add, priced by the quotation's own engine.
  const cents = (value: number) => Math.round(value * 100);
  const withOptions = (cents(quote.total) + optional.filter((line) => options.includes(line.id)).reduce((sum, line) => sum + cents(line.optionPrice ?? 0), 0)) / 100;
  const print = `/portal/${encodeURIComponent(slug)}/print?${new URLSearchParams({ case: caseId, quote: quote.id, ...(quote.hash ? { snapshot: quote.hash } : {}) })}`;
  const labels: Record<Decision, string> = { accept: t("Accept"), changes: t("Ask for changes"), decline: t("Decline") };

  if (decision && confirming) return <ConfirmCode api={api} channels={channels} purpose={`quote:${caseId}:${quote.id}:${decision}`} confirmLabel={labels[decision]}
    onBack={() => setConfirming(false)}
    onConfirm={async (proof) => {
      await api.command(id, { action: "quote_decision", caseId, quoteId: quote.id, decision, note: note.trim(), selectedOptionLineIds: decision === "accept" ? options : [],
        hash: quote.hash, ...proof });
      onDecided();
    }} />;

  return <div className={styles.sheet}>
    <div className={styles.rowHead}>
      <StateLabel state={quote.expired && quote.status === "issued" ? "expired" : quote.status} />
      <a className={styles.muted} href={print} rel="noreferrer" target="_blank">{t("Print or save as PDF")}</a>
    </div>
    <div className={styles.document}><QuotationDocument quote={documentQuote(quote)} /></div>
    {quote.canDecide ? <>
      {optional.length ? <fieldset className={styles.options}>
        <legend className={styles.groupTitle}>{t("Options you can add")}</legend>
        {optional.map((line) => <Checkbox key={line.id} isSelected={options.includes(line.id)}
          onChange={(selected) => setOptions((current) => (selected ? [...current, line.id] : current.filter((item) => item !== line.id)))}>
          {line.title}{line.optionPrice !== null ? ` · ${format.money(line.optionPrice, quote.currency)}` : ""}
        </Checkbox>)}
      </fieldset> : null}
      <div className={styles.total}><span>{t("Total")}</span><span className={styles.amount}>{format.money(withOptions, quote.currency)}</span></div>
      <p className={styles.muted}>{t("Valid until {date}", { date: format.date(quote.validUntil) })}</p>
      {decision && decision !== "accept"
        ? <TextAreaField label={decision === "changes" ? t("What would you like changed?") : t("Why are you declining?")} value={note} onChange={setNote} maxLength={6000} isRequired autoFocus />
        : null}
      <div className={styles.choices}>
        {decision ? <>
          <Button onPress={() => { setDecision(null); setNote(""); }}>{t("Back")}</Button>
          <Button variant="primary" isDisabled={decision !== "accept" && !note.trim()} onPress={() => setConfirming(true)}>{t("Continue")}</Button>
        </> : <>
          <Button variant="quiet" onPress={() => setDecision("decline")}>{labels.decline}</Button>
          <Button onPress={() => setDecision("changes")}>{labels.changes}</Button>
          <Button variant="primary" onPress={() => { setDecision("accept"); setConfirming(true); }}>{labels.accept}</Button>
        </>}
      </div>
    </> : quote.decision ? <p className={styles.muted}>{t("{name} decided on {date}.", { name: quote.decision.decidedBy, date: format.date(quote.decision.decidedAt) })}</p> : null}
  </div>;
}
