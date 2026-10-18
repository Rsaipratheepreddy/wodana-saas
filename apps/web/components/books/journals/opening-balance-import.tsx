"use client";

import { useMemo, useState } from "react";
import { AmountList, Button, FileUploader, InlineNotice, RecordTable, useDesignSystem, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey } from "@/lib/i18n/keys";
import { manualJournalsApi, newId, type JournalDetail, type OpeningPreview } from "@/lib/books/settings-client";
import { amountText, toUnits } from "./journal-amounts";
import styles from "./journals.module.css";

const O = {
  choose: tKey("Choose the trial balance file"),
  rows: tKey("Opening balances"),
  row: tKey("Row"),
  code: tKey("Code"),
  account: tKey("Account"),
  debit: tKey("Debit"),
  credit: tKey("Credit"),
  rowError: tKey("Row {row}: {message}"),
  asAt: tKey("Balances at {date}, posted on {start}"),
  submit: tKey("Submit for approval"),
  submitted: tKey("{reference} is waiting for approval."),
  tooLarge: tKey("Choose a file up to 1 MB."),
  total: tKey("Total"),
} as const;

type PreviewLine = OpeningPreview["lines"][number];

/** The file's text (FileReader where `File.text` is missing). */
function readText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Opening balances from a trial balance (CSV with the account code, debit and credit): the file is read against the
 * company's chart and shown with every problem by its row number; once it balances, it goes for approval and posts
 * as the opening journal on the start date. Mounted by the Ledger's Journals tab (slice C).
 */
export function OpeningBalanceImport({ workspaceId, legalEntityId, onDone }: { workspaceId: string; legalEntityId: string; onDone?: (detail: JournalDetail) => void }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const api = useMemo(() => manualJournalsApi(workspaceId), [workspaceId]);
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<OpeningPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<JournalDetail | null>(null);
  const [id] = useState(() => newId());

  const read = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setError(""); setPreview(null); setDone(null);
    if (file.size > 1_000_000) { setError(t(O.tooLarge)); return; }
    setBusy(true);
    try {
      const text = await readText(file);
      setCsv(text);
      setPreview(await api.previewOpening(legalEntityId, text));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    setBusy(false);
  };
  const submit = async () => {
    if (!csv) return;
    setBusy(true); setError("");
    try {
      const detail = await api.command(id, "import_opening", { legalEntityId, csv });
      setDone(detail);
      onDone?.(detail);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    setBusy(false);
  };

  const money = (value: string) => (toUnits(value) ? amountText(value, locale) : "");
  const columns: DataGridColumn<PreviewLine>[] = [
    { id: "row", header: t(O.row), size: 64, accessorFn: (row) => row.row, cell: ({ row }: { row: { original: PreviewLine } }) => <span className={styles.number}>{row.original.row}</span> },
    { id: "code", header: t(O.code), accessorFn: (row) => row.code, meta: { primary: true }, cell: ({ row }: { row: { original: PreviewLine } }) =>
      <span className={styles.code} data-unknown={row.original.accountId ? undefined : true}>{row.original.code}</span> },
    { id: "account", header: t(O.account), accessorFn: (row) => row.name, cell: ({ row }: { row: { original: PreviewLine } }) => <span>{row.original.name}</span> },
    { id: "debit", header: t(O.debit), accessorFn: (row) => row.debit, meta: { align: "end" }, cell: ({ row }: { row: { original: PreviewLine } }) => <span className={styles.number}>{money(row.original.debit)}</span> },
    { id: "credit", header: t(O.credit), accessorFn: (row) => row.credit, meta: { align: "end" }, cell: ({ row }: { row: { original: PreviewLine } }) => <span className={styles.number}>{money(row.original.credit)}</span> },
  ];

  return <div className={styles.editor}>
    <FileUploader appearance="button" accept=".csv,text/csv" multiple={false} label={t(O.choose)} onFiles={(files) => void read(files)} />
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {preview?.errors.length ? <InlineNotice tone="error" message={<ul className={styles.errorList}>{preview.errors.map((item, index) => <li key={`${item.row ?? "file"}-${index}`}>
      {item.row ? t(O.rowError, { row: item.row, message: item.message }) : item.message}</li>)}</ul>} /> : null}
    {done ? <InlineNotice tone="success" message={t(O.submitted, { reference: done.journal.reference })} /> : null}
    {preview && preview.lines.length ? <>
      {preview.asAt && preview.journalDate ? <p className={styles.muted}>{t(O.asAt, { date: preview.asAt, start: preview.journalDate })}</p> : null}
      <RecordTable ariaLabel={t(O.rows)} data={preview.lines} columns={columns} getRowId={(row) => String(row.row)} selectable={false} rowNumbers={false} showToolbar={false} />
      <div className={styles.foot}>
        <span className={styles.spacer} />
        <AmountList label={t("Total")} rows={[{ id: "debit", label: t(O.debit), amount: money(preview.debit) }, { id: "credit", label: t(O.credit), amount: money(preview.credit) }]} />
      </div>
      <div className={styles.actions}>
        <span className={styles.spacer} />
        <Button variant="primary" isLoading={busy} isDisabled={!preview.balanced || preview.errors.length > 0 || Boolean(done)} onPress={() => void submit()}>{t(O.submit)}</Button>
      </div>
    </> : null}
  </div>;
}
