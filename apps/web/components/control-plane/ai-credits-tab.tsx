"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, EmptyState, ErrorState, RecordTable, SegmentedControl, Skeleton, TextAreaField, TextInput, useDesignSystem, type DataGridColumn, FormDialog } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { consoleApi, type CreditOverview } from "@/lib/internal/console";
import { ENTRY_LABELS, featureLabel, formatCredits, type CreditLedgerEntry } from "@/lib/workspace/ai-credits";
import { useConsoleFormat } from "./labels";
import styles from "./control-plane.module.css";

const CREDITS = /^\d{1,10}(\.\d{1,4})?$/;
const SIGNED_CREDITS = /^-?\d{1,10}(\.\d{1,4})?$/;
const ZERO = /^-?0+(\.0+)?$/;
type Dialog = "top-up" | "adjust" | "threshold" | null;

/**
 * One organization's AI credits: balance, use and the low-balance line, the ledger, and the Wodana team's
 * top-ups (recorded by hand until there is a payment gateway), adjustments, refunds and the alert line.
 */
export function AiCreditsTab({ orgKey, canManage }: { orgKey: string; canManage: boolean }) {
  const t = useT();
  const format = useConsoleFormat();
  const { locale } = useDesignSystem();
  const [credits, setCredits] = useState<CreditOverview | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const load = useCallback(async () => {
    try { setCredits(await consoleApi.organizationAiCredits(orgKey)); setError(""); }
    catch (cause) { setError((cause as Error).message || t("AI credits didn't load.")); }
  }, [orgKey, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const columns = useMemo<DataGridColumn<CreditLedgerEntry>[]>(() => [
    { id: "when", header: t("When"), size: 150, accessorFn: (row) => row.createdAt, meta: { renderCell: (row) => format.dateTime(row.createdAt) } },
    { id: "entry", header: t("Entry"), size: 190, accessorFn: (row) => t(ENTRY_LABELS[row.entryType]), meta: { primary: true, renderCell: (row) =>
      <span className={styles.nameCell}><strong>{t(ENTRY_LABELS[row.entryType])}</strong>
        <small>{row.entryType === "usage" && row.feature ? `${t(featureLabel(row.feature))} · ${row.model ?? ""}` : [row.reference, row.note].filter(Boolean).join(" · ")}</small></span> } },
    { id: "credits", header: t("Credits"), size: 120, accessorFn: (row) => row.credits, meta: { align: "end", renderCell: (row) =>
      <span className={styles.number} dir="ltr">{row.credits.startsWith("-") ? "" : "+"}{formatCredits(row.credits, locale, 4)}</span> } },
    { id: "balance", header: t("Balance"), size: 120, accessorFn: (row) => row.balanceAfter, meta: { align: "end", renderCell: (row) =>
      <span className={styles.number}>{formatCredits(row.balanceAfter, locale)}</span> } },
    { id: "by", header: t("By"), size: 160, accessorFn: (row) => row.createdByName ?? "" },
  ], [format, locale, t]);

  if (error && !credits) return <div className={styles.panel}><ErrorState description={error} onRetry={() => void load()} /></div>;
  if (!credits) return <div className={styles.panel}><Skeleton shape="facts" lines={4} /></div>;
  const state = credits.state === "exhausted" ? { tone: "danger" as const, label: t("Used up") } : credits.state === "low" ? { tone: "warning" as const, label: t("Running low") } : null;
  const saved = (next: CreditOverview) => { setCredits(next); setDialog(null); };
  return <div className={styles.panel}>
    <div className={styles.toolbar}>
      <dl className={styles.seatFacts}>
        <div><dt>{t("Balance")}</dt><dd>{formatCredits(credits.balance, locale)}</dd></div>
        <div><dt>{t("Used this month")}</dt><dd>{formatCredits(credits.usedThisMonth, locale)}</dd></div>
        <div><dt>{t("Used today")}</dt><dd>{t("{used} of {limit}", { used: formatCredits(credits.usedToday, locale), limit: formatCredits(credits.dailyLimit, locale) })}</dd></div>
        <div><dt>{t("Alert at")}</dt><dd>{formatCredits(credits.threshold, locale)}</dd></div>
      </dl>
      {canManage ? <div className={styles.toolbarActions}>
        <Button onPress={() => setDialog("threshold")}>{t("Set alert")}</Button>
        <Button onPress={() => setDialog("adjust")}>{t("Adjust")}</Button>
        <Button variant="primary" onPress={() => setDialog("top-up")}>{t("Top up")}</Button>
      </div> : null}
    </div>
    {state ? <div className={styles.inline}><Badge tone={state.tone}>{state.label}</Badge></div> : null}
    <section className={styles.section} aria-label={t("Ledger")}>
      <h2 className={styles.subhead}>{t("Ledger")}</h2>
      <RecordTable<CreditLedgerEntry> ariaLabel={t("AI credit ledger")} columns={columns} data={credits.ledger} getRowId={(row) => row.id}
        emptyContent={<EmptyState illustration={null} title={t("No entries yet")} />} rowNumbers={false} selectable={false} showToolbar={false} showFooter={false} wrapText />
    </section>
    {dialog === "top-up" ? <EntryDialog kind="top-up" onClose={() => setDialog(null)}
      onSave={async (input, key) => saved(await consoleApi.topUpAiCredits(orgKey, input, key))} /> : null}
    {dialog === "adjust" ? <EntryDialog kind="adjust" onClose={() => setDialog(null)}
      onSave={async (input, key) => saved(await consoleApi.adjustAiCredits(orgKey, { kind: input.kind ?? "adjustment", credits: input.credits, reference: input.reference, note: input.note }, key))} /> : null}
    {dialog === "threshold" ? <ThresholdDialog credits={credits} onClose={() => setDialog(null)}
      onSave={async (threshold) => saved(await consoleApi.setAiCreditThreshold(orgKey, { expectedVersion: credits.version, threshold }))} /> : null}
  </div>;
}

type EntryInput = { kind?: "adjustment" | "refund"; credits: string; reference: string; note?: string };

/** Top up (credits paid for, with the invoice or payment note), or adjust / refund. One request key per dialog. */
function EntryDialog({ kind, onClose, onSave }: { kind: "top-up" | "adjust"; onClose: () => void; onSave: (input: EntryInput, key: string) => Promise<void> }) {
  const t = useT();
  const key = useRef(crypto.randomUUID());
  const [entry, setEntry] = useState<"adjustment" | "refund">("adjustment");
  const [credits, setCredits] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const amount = credits.trim();
  const valid = (kind === "adjust" && entry === "adjustment" ? SIGNED_CREDITS : CREDITS).test(amount) && !ZERO.test(amount) && reference.trim().length >= 3;
  return <FormDialog size="md" title={kind === "top-up" ? t("Top up") : t("Adjust")} onClose={onClose} error={error || undefined} isSubmitDisabled={!valid} submitLabel={t("Save")} onSubmit={async () => { setError("");
        try { await onSave({ kind: kind === "adjust" ? entry : undefined, credits: amount, reference: reference.trim(), note: note.trim() || undefined }, key.current); }
        catch (cause) { setError((cause as Error).message || t("The credits could not be saved.")); }
        finally { }
      }}>
      {kind === "adjust" ? <SegmentedControl label={t("Entry")} value={entry} onChange={(value) => setEntry(value as "adjustment" | "refund")}
        options={[{ id: "adjustment", label: t("Adjustment") }, { id: "refund", label: t("Refund") }]} /> : null}
      <TextInput label={t("Credits")} isRequired value={credits} onChange={setCredits}
        description={kind === "adjust" && entry === "adjustment" ? t("Negative to take credits away.") : undefined} />
      <TextInput label={kind === "top-up" ? t("Invoice or payment reference") : t("Reference")} isRequired value={reference} onChange={setReference} />
      <TextAreaField label={t("Note")} value={note} onChange={setNote} />
  </FormDialog>;
}

/** The low-balance line: 20% of the last topped-up balance, or a fixed number of credits. */
function ThresholdDialog({ credits, onClose, onSave }: { credits: CreditOverview; onClose: () => void; onSave: (threshold: string | null) => Promise<void> }) {
  const t = useT();
  const [mode, setMode] = useState<"automatic" | "fixed">(credits.customThreshold === null ? "automatic" : "fixed");
  const [value, setValue] = useState(credits.customThreshold ?? credits.threshold);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = mode === "automatic" || CREDITS.test(value.trim());
  return <FormDialog size="md" title={t("Set alert")} onClose={onClose} error={error || undefined} isSubmitDisabled={!valid} submitLabel={t("Save")} onSubmit={async () => { setError("");
        try { await onSave(mode === "automatic" ? null : value.trim()); }
        catch (cause) { setError((cause as Error).message || t("The alert could not be saved.")); }
        finally { }
      }}>
      <SegmentedControl label={t("Alert at")} value={mode} onChange={(next) => setMode(next as "automatic" | "fixed")}
        options={[{ id: "automatic", label: t("20% of the last top-up") }, { id: "fixed", label: t("Fixed credits") }]} />
      {mode === "fixed" ? <TextInput label={t("Credits")} isRequired value={value} onChange={setValue} /> : null}
  </FormDialog>;
}
