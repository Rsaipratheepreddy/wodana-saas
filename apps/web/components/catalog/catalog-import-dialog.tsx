"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Badge, Button, Callout, Checkbox, ControlledModalDialog, EmptyState, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { readCatalogImportFile } from "@/lib/workspace/catalog-import-file";
import { catalogApi, detectMapping, rowsFromSheet, type ImportPlan, type ImportRow, type SheetMapping } from "@/lib/workspace/catalog-v2";
import styles from "./catalog-page.module.css";

type Sheet = { name: string; rows: string[][]; mapping: SheetMapping | null; include: boolean };

/** Import a spreadsheet: pick sheets, see how columns map, review every row, then import. */
export function CatalogImportDialog({ workspaceId, catalogId, isOpen, onClose, onImported }: { workspaceId: string; catalogId: string; isOpen: boolean; onClose: () => void; onImported: () => void }) {
  const t = useT();
  const fieldLabel: Record<string, string> = { name: t("Name"), code: t("Code"), unit: t("Unit"), supplier: t("Supplier"), cost: t("Cost"), category: t("Category"), "attr:Size": t("Size"), "attr:Colour": t("Colour") };
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reset = () => { setSheets([]); setPlan(null); setError(""); };
  const close = () => { reset(); onClose(); };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(""); setPlan(null);
    try {
      const tables = await readCatalogImportFile(file);
      setSheets(tables.map((table) => { const mapping = detectMapping(table); return { ...table, mapping, include: Boolean(mapping) }; }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : ""); }
  };
  const rows = (): ImportRow[] => sheets.filter((sheet) => sheet.include && sheet.mapping).flatMap((sheet) => rowsFromSheet(sheet, sheet.mapping!));
  const run = async (mode: "preview" | "commit") => {
    setBusy(true); setError("");
    try {
      const result = await catalogApi<ImportPlan>(workspaceId, `${catalogId}/import`, { body: { mode, rows: rows() } });
      if (mode === "commit") { reset(); onImported(); } else setPlan(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : ""); }
    finally { setBusy(false); }
  };
  const importable = plan ? plan.summary.create + plan.summary.update : 0;
  const issues = plan ? [...plan.rows].filter((row) => row.action === "error" || row.messages.length).sort((a, b) => Number(b.action === "error") - Number(a.action === "error")) : [];

  const footer = <div className="wd-dialog-actions">
    <Button onPress={plan ? () => setPlan(null) : close}>{plan ? t("Back") : t("Cancel")}</Button>
    {plan ? <Button isDisabled={!importable} isLoading={busy} onPress={() => void run("commit")} variant="primary">{`${t("Import")} ${importable}`}</Button>
      : <Button isDisabled={!rows().length} isLoading={busy} onPress={() => void run("preview")} variant="primary">{t("Review")}</Button>}
  </div>;

  return <ControlledModalDialog footer={footer} isOpen={isOpen} onOpenChange={(open) => { if (!open) close(); }} size="lg" title={t("Import items")}>
    <div className={styles.importBody}>
      {error ? <Callout title={t("Could not import")} tone="danger">{error}</Callout> : null}
      {!sheets.length ? <label className={styles.drop}>
        <EmptyState illustration="upload" title={t("Choose a spreadsheet")} description={t("Excel (.xlsx) or CSV. Each sheet becomes a category.")} />
        <input accept=".xlsx,.csv,.tsv" aria-label={t("Choose a spreadsheet")} className="wd-visually-hidden" onChange={(event) => void choose(event.target.files?.[0])} type="file" />
      </label>
      : !plan ? <ul className={styles.sheets}>{sheets.map((sheet, index) => <li key={sheet.name}>
          <Checkbox isDisabled={!sheet.mapping} isSelected={sheet.include} onChange={(include) => setSheets((current) => current.map((entry, at) => at === index ? { ...entry, include } : entry))}>
            <FileSpreadsheet aria-hidden="true" size={15} /><span>{sheet.name}</span>
          </Checkbox>
          {sheet.mapping ? <>
            <TextInput aria-label={`${t("Category for")} ${sheet.name}`} label={t("Category")} onChange={(category) => setSheets((current) => current.map((entry, at) => at === index ? { ...entry, mapping: { ...entry.mapping!, category } } : entry))} value={sheet.mapping.category} />
            <div className={styles.chips}>{Object.values(sheet.mapping.columns).map((field) => <Badge key={field} tone="neutral">{fieldLabel[field] ?? field}</Badge>)}</div>
          </> : <small className={styles.muted}>{t("No item name column found")}</small>}
        </li>)}</ul>
      : <>
          <div className={styles.summary} role="status">
            <span><strong>{plan.summary.create}</strong> {t("new")}</span>
            <span><strong>{plan.summary.update}</strong> {t("updated")}</span>
            <span><strong>{plan.summary.skip}</strong> {t("skipped")}</span>
            <span data-tone={plan.summary.error ? "danger" : undefined}><strong>{plan.summary.error}</strong> {t("need a fix")}</span>
          </div>
          {issues.length ? <ul className={styles.issues} aria-label={t("Rows to check")}>{issues.slice(0, 200).map((row) => <li data-action={row.action} key={`${row.sheet}-${row.line}`}>
            <small dir="ltr">{row.sheet} · {row.line}</small><strong>{row.name || "—"}</strong><span>{row.messages.join(" · ")}</span>
          </li>)}</ul> : <p className={styles.muted}>{t("Every row is ready.")}</p>}
        </>}
    </div>
  </ControlledModalDialog>;
}
