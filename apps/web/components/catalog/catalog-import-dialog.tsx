"use client";

import { useEffect, useState } from "react";
import { FileSpreadsheet, Sparkles } from "lucide-react";
import { Badge, Button, Callout, Checkbox, ControlledModalDialog, EmptyState, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { readCatalogImportFile } from "@/lib/workspace/catalog-import-file";
import { AiPauseNotice } from "@/components/workspace/ai-pause-notice";
import { isAiPauseMessage } from "@/lib/ai/pause";
import { loadAiSettings } from "@/lib/workspace/ai-settings";
import { catalogApi, detectMapping, rowsFromSheet, type ImportPlan, type ImportRow, type SheetMapping } from "@/lib/workspace/catalog-v2";
import styles from "./catalog-page.module.css";

type Sheet = { name: string; rows: string[][]; mapping: SheetMapping | null; include: boolean };
type Suggestion = { line: number; name?: string; size?: string; colour?: string; brand?: string; unit?: string; category?: string; note?: string };
const rowKey = (row: { sheet?: string; line: number }) => `${row.sheet ?? ""}#${row.line}`;

/** Import a spreadsheet: pick sheets, see how columns map, review every row, then import. */
export function CatalogImportDialog({ workspaceId, catalogId, isOpen, onClose, onImported }: { workspaceId: string; catalogId: string; isOpen: boolean; onClose: () => void; onImported: () => void }) {
  const t = useT();
  const fieldLabel: Record<string, string> = { name: t("Name"), code: t("Code"), unit: t("Unit"), supplier: t("Supplier"), cost: t("Cost"), category: t("Category"), "attr:Size": t("Size"), "attr:Colour": t("Colour") };
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<Suggestion & { key: string; before: ImportRow; accepted: boolean }> | null>(null);
  const [applied, setApplied] = useState<Map<string, Suggestion>>(new Map());
  useEffect(() => { if (isOpen) void loadAiSettings(workspaceId).then((settings) => setAiReady(Boolean(settings?.enabled && settings.available))); }, [isOpen, workspaceId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reset = () => { setSheets([]); setPlan(null); setError(""); setSuggestions(null); setApplied(new Map()); };
  const close = () => { reset(); onClose(); };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(""); setPlan(null);
    try {
      const tables = await readCatalogImportFile(file);
      setSheets(tables.map((table) => { const mapping = detectMapping(table); return { ...table, mapping, include: Boolean(mapping) }; }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : ""); }
  };
  const sourceRows = (): ImportRow[] => sheets.filter((sheet) => sheet.include && sheet.mapping).flatMap((sheet) => rowsFromSheet(sheet, sheet.mapping!));
  // Accepted AI suggestions are applied on top of the spreadsheet; the file itself is never changed.
  const rows = (): ImportRow[] => sourceRows().map((row) => {
    const change = applied.get(rowKey(row));
    if (!change) return row;
    const attributes = { ...row.attributes, ...(change.size ? { Size: change.size } : {}), ...(change.colour ? { Colour: change.colour } : {}), ...(change.brand ? { Brand: change.brand } : {}) };
    return { ...row, name: change.name ?? row.name, unit: change.unit ?? row.unit, category: change.category ?? row.category, attributes };
  });
  const cleanWithAi = async () => {
    setBusy(true); setError("");
    try {
      const source = sourceRows();
      const byLine = new Map(source.map((row) => [row.line, row]));
      // Lines repeat across sheets, so ask per sheet.
      const all: NonNullable<typeof suggestions> = [];
      for (const sheet of [...new Set(source.map((row) => row.sheet))]) {
        const batch = source.filter((row) => row.sheet === sheet);
        const result = await catalogApi<{ suggestions: Suggestion[] }>(workspaceId, `${catalogId}/import/ai-clean`, { body: { rows: batch } });
        for (const suggestion of result.suggestions) {
          const before = batch.find((row) => row.line === suggestion.line) ?? byLine.get(suggestion.line);
          if (before) all.push({ ...suggestion, key: rowKey(before), before, accepted: true });
        }
      }
      setSuggestions(all);
    } catch (reason) { setError(reason instanceof Error ? reason.message : ""); }
    finally { setBusy(false); }
  };
  const applySuggestions = () => {
    setApplied(new Map((suggestions ?? []).filter((suggestion) => suggestion.accepted).map((suggestion) => [suggestion.key, suggestion])));
    setSuggestions(null);
  };
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
    <Button onPress={plan ? () => setPlan(null) : suggestions ? () => setSuggestions(null) : close}>{plan || suggestions ? t("Back") : t("Cancel")}</Button>
    {plan ? <Button isDisabled={!importable} isLoading={busy} onPress={() => void run("commit")} variant="primary">{`${t("Import")} ${importable}`}</Button>
      : suggestions ? <Button onPress={applySuggestions} variant="primary">{`${t("Use")} ${suggestions.filter((suggestion) => suggestion.accepted).length} ${t("suggestions")}`}</Button>
      : <>
          {aiReady && sheets.length ? <Button isDisabled={!sourceRows().length} isLoading={busy} onPress={() => void cleanWithAi()}><Sparkles aria-hidden="true" size={15} />{t("Clean up with AI")}</Button> : null}
          <Button isDisabled={!rows().length} isLoading={busy && !aiReady} onPress={() => void run("preview")} variant="primary">{applied.size ? `${t("Review")} · ${applied.size} ${t("AI changes")}` : t("Review")}</Button>
        </>}
  </div>;

  return <ControlledModalDialog footer={footer} isOpen={isOpen} onOpenChange={(open) => { if (!open) close(); }} size="lg" title={t("Import items")}>
    <div className={styles.importBody}>
      {isAiPauseMessage(error) ? <AiPauseNotice message={error} /> : error ? <Callout title={t("Could not import")} tone="danger">{error}</Callout> : null}
      {!sheets.length ? <label className={styles.drop}>
        <EmptyState illustration="upload" title={t("Choose a spreadsheet")} description={t("Excel (.xlsx) or CSV. Each sheet becomes a category.")} />
        <input accept=".xlsx,.csv,.tsv" aria-label={t("Choose a spreadsheet")} className="wd-visually-hidden" onChange={(event) => void choose(event.target.files?.[0])} type="file" />
      </label>
      : suggestions ? (suggestions.length ? <ul className={styles.suggestions} aria-label={t("AI suggestions")}>{suggestions.map((suggestion, index) => <li key={suggestion.key}>
          <Checkbox isSelected={suggestion.accepted} onChange={(accepted) => setSuggestions((current) => current!.map((entry, at) => at === index ? { ...entry, accepted } : entry))}><span className={styles.before}>{suggestion.before.name}</span></Checkbox>
          <div className={styles.after}>
            {suggestion.name ? <strong>{suggestion.name}</strong> : null}
            {([["size", t("Size")], ["colour", t("Colour")], ["brand", t("Brand")], ["unit", t("Unit")], ["category", t("Category")]] as const).map(([key, label]) => suggestion[key] ? <Badge key={key} tone="info">{label}: {suggestion[key]}</Badge> : null)}
            {suggestion.note ? <small>{suggestion.note}</small> : null}
          </div>
        </li>)}</ul> : <p className={styles.muted}>{t("AI found nothing to change.")}</p>)
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
