"use client";

import { useState } from "react";
import { Button, Checkbox, ControlledModalDialog, FileUploader, InlineNotice, SelectField, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { readCatalogImportFile } from "@/lib/workspace/catalog-import-file";
import type { PurchasingApi } from "@/lib/purchasing/client";
import { guessCompany, readSupplierSheet, supplierRows, type SupplierColumn, type SupplierSheet } from "@/lib/purchasing/import";
import type { SupplierImportPlan, SupplierState } from "@/lib/purchasing/types";
import { useSupplierLabels } from "./supplier-labels";
import styles from "./purchasing.module.css";

type Sheet = SupplierSheet & { use: boolean; entityId: string | null };

/**
 * Imports the supplier list a firm already keeps (Excel or CSV, one sheet per company is fine): pick
 * the file, confirm which company each sheet is for, see what will be added or merged, then import.
 */
export function SupplierImport({ api, state, onClose, onImported }: { api: PurchasingApi; state: SupplierState; onClose: () => void; onImported: (state: SupplierState) => void }) {
  const t = useT();
  const labels = useSupplierLabels();
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [plan, setPlan] = useState<SupplierImportPlan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fields: Record<SupplierColumn, string> = { name: t("Name"), categories: t("Categories"), approval: t("Approval"), deal: t("Discount or commission"), terms: t("Payment terms"),
    contactName: t("Contact"), phone: t("Phone"), email: t("Email"), locality: t("Location"), notes: t("Notes") };
  const rows = () => (sheets ?? []).filter((sheet) => sheet.use).flatMap((sheet) => supplierRows(sheet, sheet.entityId));

  const read = async (file: File) => {
    setError(""); setPlan(null);
    try {
      const tables = await readCatalogImportFile(file);
      const found = tables.map((table) => readSupplierSheet(table.name, table.rows)).filter((sheet) => sheet.header >= 0)
        .map((sheet) => ({ ...sheet, use: sheet.likely, entityId: guessCompany(sheet.name, state.entities) }));
      if (!found.length) throw new Error(t("No sheet has a column for the supplier's name."));
      setSheets(found);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("The file couldn't be read.")); }
  };
  const review = async () => {
    setBusy(true); setError("");
    try { setPlan(await api.previewImport(rows())); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not check the file.")); }
    setBusy(false);
  };
  const commit = async () => {
    setBusy(true); setError("");
    try { onImported(await api.commitImport(rows())); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not import.")); setBusy(false); }
  };
  const count = plan?.plan.length ?? 0;
  const skipped = plan?.plan.filter((item) => item.approvalSkipped).length ?? 0;

  return <ControlledModalDialog isOpen size="lg" title={t("Import suppliers")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions">
      {plan ? <Button onPress={() => setPlan(null)}>{t("Back")}</Button> : null}
      <span className={styles.spacer} />
      <Button onPress={onClose}>{t("Cancel")}</Button>
      {plan ? <Button variant="primary" isLoading={busy} isDisabled={!count} onPress={() => void commit()}>{count === 1 ? t("Import 1 supplier") : t("Import {count} suppliers", { count })}</Button>
        : <Button variant="primary" isLoading={busy} isDisabled={!sheets?.some((sheet) => sheet.use)} onPress={() => void review()}>{t("Review")}</Button>}
    </div>}>
    <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {!sheets ? <FileUploader accept=".xlsx,.csv,.tsv" multiple={false} label={t("Choose an Excel or CSV file")} onFiles={(files) => { if (files[0]) void read(files[0]); }} />
        : !plan ? <ul className={styles.sheets} aria-label={t("Sheets")}>
          {sheets.map((sheet, index) => <li key={sheet.name}>
            <Checkbox isSelected={sheet.use} onChange={(use) => setSheets(sheets.map((item, at) => (at === index ? { ...item, use } : item)))}>
              <span className={styles.nameCell}><span>{sheet.name}</span>
                <small>{t("{count} rows", { count: supplierRows(sheet, null).length })} · {(Object.keys(sheet.columns) as SupplierColumn[]).map((key) => fields[key]).join(", ")}</small></span>
            </Checkbox>
            {state.entities.length > 1 ? <SelectField aria-label={t("Company for {sheet}", { sheet: sheet.name })} label={null} accent="neutral" placeholder={t("Which company buys")}
              isDisabled={!sheet.use} selectedKey={sheet.entityId} onSelectionChange={(key) => setSheets(sheets.map((item, at) => (at === index ? { ...item, entityId: key === null ? null : String(key) } : item)))}
              items={state.entities.map((entity) => ({ id: entity.id, label: entity.name }))} /> : null}
          </li>)}
        </ul>
        : busy && !plan ? <Skeleton lines={5} />
        : <>
          <p className={styles.dialogText}>{t("{create} new, {merge} already in the register (they gain the new companies and categories).", {
            create: plan.plan.filter((item) => item.action === "create").length, merge: plan.plan.filter((item) => item.action === "merge").length })}</p>
          {skipped ? <InlineNotice tone="info" message={t("{count} approvals in the file need someone who approves suppliers; they come in as not reviewed.", { count: skipped })} /> : null}
          <ul className={styles.importList} aria-label={t("Suppliers to import")}>
            {plan.plan.map((item) => <li key={item.name}>
              <span className={styles.nameCell}><span>{item.name}</span><small>{item.categories.join(", ")}</small></span>
              <span className={styles.muted}>{item.action === "merge" ? t("Already in the register") : t("New")}</span>
              <span className={styles.approval} data-approval={item.approval}>{labels.approval[item.approval]}</span>
              <span className={styles.muted}>{labels.termsText(item)}</span>
            </li>)}
          </ul>
        </>}
    </div>
  </ControlledModalDialog>;
}
