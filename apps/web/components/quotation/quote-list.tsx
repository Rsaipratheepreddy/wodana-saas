"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge, Button, ControlledModalDialog, EmptyState, InlineNotice, RadioSet, RecordTable, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commercialPath, jsonRequest } from "@/lib/commercial/client";
import { SERVICE_PATHS } from "@/lib/commercial/service-paths";
import type { CommercialState, Quote } from "@/lib/commercial/types";
import { money, QUOTE_STATUS } from "@/lib/quotation/format";
import styles from "./quote-list.module.css";

/** The currency's own number of decimals (AED 2, JPY 0, KWD 3). */
const currencyDigits = (currency: string, locale: string) => { try { return new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; } };
const OPEN = ["draft", "internal_review", "internal_approved", "issued", "changes_requested", "accepted"];

/**
 * Every quote on the enquiry in one list — the design fee, the fit-out and later variations — each
 * opening the same editor. "New quote" starts one; revisions are made from inside a quote.
 */
export function QuoteList({ initial, baseHref }: { initial: CommercialState; baseHref: string }) {
  const t = useT();
  const hrefOf = (quoteId: string) => `${baseHref}?${new URLSearchParams({ quote: quoteId })}`;
  const { locale } = useDesignSystem();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [path, setPath] = useState(0);
  const [showReplaced, setShowReplaced] = useState(false);
  const { data } = initial;
  const quotes = [...data.quotes].sort((a, b) => b.number - a.number);
  const replaced = quotes.filter((quote) => !OPEN.includes(quote.status));
  const shown = showReplaced ? quotes : quotes.filter((quote) => OPEN.includes(quote.status));
  const needsPath = Boolean(initial.palmFlowEnabled && !data.palmFlow);
  const canStartMain = Boolean(data.palmFlow?.scope.design && data.palmFlow.scope.mainQuotation && data.dealFile
    && !data.quotes.some((quote) => quote.kind === "quotation" && quote.round === "main"));
  const canCreate = initial.canEdit && (!data.quotes.length || canStartMain);

  const create = async () => {
    setBusy(true); setError("");
    try {
      const url = commercialPath(initial.workspaceId, `cases/${initial.caseId}`);
      let revision = data.revision;
      if (needsPath) revision = (await jsonRequest<{ data: CommercialState["data"] }>(url, "POST", { action: "set_palm_flow", revision, scope: SERVICE_PATHS[path].scope })).data.revision;
      const result = await jsonRequest<{ data: CommercialState["data"] }>(url, "POST", { action: "create", revision });
      const created = result.data.quotes.at(-1);
      if (created) router.push(hrefOf(created.id)); else router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); }
  };
  const start = () => (needsPath ? setChoosing(true) : void create());
  const action = canCreate ? <Button variant="primary" size="compact" isLoading={busy && !choosing} onPress={start}><Plus aria-hidden="true" size={14} />{canStartMain ? t("New fit-out quote") : t("New quote")}</Button> : null;

  const kind = (quote: Quote) => quote.kind === "variation" ? t("Variation") : quote.round === "design" ? t("Design fee") : t("Fit-out");
  const date = (value: string) => value ? new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00Z`)) : "—";

  return <div className={styles.page}>
    {replaced.length || action ? <div className={styles.toolbar}>
      {replaced.length ? <Button size="compact" variant="quiet" onPress={() => setShowReplaced((value) => !value)}>
        {showReplaced ? t("Hide earlier versions") : t("Earlier versions · {count}", { count: replaced.length })}</Button> : null}
      <span className={styles.spacer} />
      {action}
    </div> : null}
    {error && !choosing ? <InlineNotice tone="error" message={error} /> : null}
    {!quotes.length ? <EmptyState title={t("No quotes yet")} action={action ?? undefined} /> : <RecordTable
      ariaLabel={t("Quotes")} data={shown} getRowId={(quote) => quote.id} showToolbar={false} showFooter={false} rowNumbers={false} selectable={false} wrapText
      onRowAction={(quote) => router.push(hrefOf(quote.id))}
      columns={[
        { id: "title", header: t("Quote"), size: 320, accessorFn: (quote) => quote.title, meta: { primary: true },
          cell: ({ row: { original: quote } }) => <span className={styles.title}><Link data-tour={quote.kind === "quotation" && quote.round !== "design" ? "quote-open quote-main" : "quote-open"} href={hrefOf(quote.id)}>{quote.title}</Link><small>{t("Q-{number}", { number: quote.number })}</small></span> },
        { id: "kind", header: t("Type"), size: 130, accessorFn: kind },
        { id: "total", header: t("Amount"), size: 150, accessorFn: (quote) => quote.total, meta: { align: "end" },
          cell: ({ row: { original: quote } }) => <span className={styles.amount}>{money(quote.clientDecision?.acceptedTotal ?? quote.total, quote.currency, currencyDigits(quote.currency, locale), locale)}</span> },
        { id: "status", header: t("Status"), size: 170, accessorFn: (quote) => quote.status,
          cell: ({ row: { original: quote } }) => <Badge tone={QUOTE_STATUS[quote.status]?.tone ?? "neutral"}>{t((QUOTE_STATUS[quote.status]?.label ?? quote.status) as never)}</Badge> },
        { id: "validUntil", header: t("Valid until"), size: 140, accessorFn: (quote) => quote.validUntil, cell: ({ row: { original: quote } }) => date(quote.validUntil) },
      ]} />}
    {choosing ? <ControlledModalDialog isOpen size="md" title={t("What is the client buying?")} onOpenChange={(open) => { if (!open && !busy) setChoosing(false); }}
      footer={<div className={styles.dialogActions}><Button size="compact" isDisabled={busy} onPress={() => setChoosing(false)}>{t("Cancel")}</Button>
        <Button size="compact" variant="primary" isLoading={busy} onPress={() => void create()}>{t("Start the quote")}</Button></div>}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <RadioSet label={t("Service")} value={String(path)} onChange={(value) => setPath(Number(value))}
        items={SERVICE_PATHS.map((item, index) => ({ id: String(index), label: t(item.label as never) }))} />
    </ControlledModalDialog> : null}
  </div>;
}
