"use client";

import { useCallback, useState } from "react";
import { Plus, Receipt, Trash2 } from "lucide-react";
import { Button, Callout, IconButton, InlineNotice, SelectField, SideSheet, Skeleton, Switch, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { previewNumber, type NumberingRow, type TaxNumbering, type TaxRate } from "@/lib/workspace/tax-numbering";
import styles from "./tax-numbering-sheet.module.css";

const DIGITS = [3, 4, 5, 6, 7, 8].map((value) => ({ id: String(value), label: String(value) }));

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message ?? "");
  return payload as T;
}

/** Tax rates and document numbering for one legal entity. */
export function TaxNumberingSheet({ workspaceId, entityId, entityName, canManage }: { workspaceId: string; entityId: string; entityName: string; canManage: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TaxNumbering | null>(null);
  const [loadError, setLoadError] = useState("");
  const load = useCallback(async () => {
    setLoadError("");
    try { setData(await send<TaxNumbering>(`/api/workspace/legal-entities/${entityId}/tax-numbering?workspaceId=${workspaceId}`)); }
    catch (error) { setLoadError((error instanceof Error && error.message) || t("Something went wrong. Try again.")); }
  }, [entityId, workspaceId, t]);
  const toggle = (next: boolean) => { setOpen(next); if (next && !data) void load(); };

  return <SideSheet isOpen={open} onOpenChange={toggle} size="lg" title={t("Tax & numbering")} description={entityName}
    trigger={<Button aria-label={`${t("Tax & numbering")} · ${entityName}`} size="compact" variant="quiet"><Receipt aria-hidden="true" size={14} />{t("Tax & numbering")}</Button>}>
    {loadError ? <Callout title={t("Could not load")} tone="danger" actions={<Button size="compact" onPress={() => void load()}>{t("Retry")}</Button>}>{loadError}</Callout>
      : !data ? <Skeleton lines={6} shape="form" />
      : <div className={styles.sheet}>
          <TaxSection canManage={canManage} data={data} entityId={entityId} onSaved={setData} workspaceId={workspaceId} />
          <NumberingSection canManage={canManage} data={data} entityId={entityId} onSaved={setData} workspaceId={workspaceId} />
        </div>}
  </SideSheet>;
}

function TaxSection({ data, canManage, workspaceId, entityId, onSaved }: { data: TaxNumbering; canManage: boolean; workspaceId: string; entityId: string; onSaved: (next: TaxNumbering) => void }) {
  const t = useT();
  const label = data.taxModel.label ?? t("Tax");
  const [rates, setRates] = useState<TaxRate[]>(() => data.tax?.rates.map((rate) => ({ ...rate, rate: String(Number(rate.rate)) })) ?? []);
  const [pricesIncludeTax, setPricesIncludeTax] = useState(data.tax?.pricesIncludeTax ?? false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  if (data.taxModel.model === "none") {
    return <section className={styles.section} aria-labelledby="tax-heading"><h3 id="tax-heading">{t("Tax")}</h3>
      <InlineNotice message={t("This country has no sales tax. Quotes and invoices show no tax.")} /></section>;
  }
  const update = (index: number, patch: Partial<TaxRate>) => setRates((current) => current.map((rate, at) => at === index ? { ...rate, ...patch } : patch.isDefault ? { ...rate, isDefault: false } : rate));
  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      const next = await send<TaxNumbering>(`/api/workspace/legal-entities/${entityId}/tax`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, version: data.tax?.version, pricesIncludeTax, rates: rates.map((rate) => ({ ...rate, code: rate.code || rate.label })) }),
      });
      onSaved(next); setMessage({ tone: "success", text: t("Saved. New rates apply from now; issued documents keep theirs.") });
    } catch (error) { setMessage({ tone: "error", text: (error instanceof Error && error.message) || t("Something went wrong. Try again.") }); }
    finally { setSaving(false); }
  };

  return <section className={styles.section} aria-labelledby="tax-heading">
    <header className={styles.sectionHeader}>
      <h3 id="tax-heading">{label}</h3>
      <span className={styles.meta}><bdi>{data.taxModel.registrationLabel ?? t("Tax registration number")}</bdi>: <bdi>{data.entity.taxRegistrationNumber || t("Not added")}</bdi></span>
    </header>
    {message ? <InlineNotice message={message.text} tone={message.tone} /> : null}
    {!data.tax && !rates.length ? <InlineNotice message={`${label} ${t("is not set up yet. Documents add no tax until you add a rate.")}`} /> : null}
    <div className={styles.rates} role="list" aria-label={t("Rates")}>
      {rates.map((rate, index) => <div className={styles.rate} key={index} role="listitem">
        <TextInput isDisabled={!canManage} isRequired label={t("Name")} onChange={(value) => update(index, { label: value, code: data.tax?.rates.some((saved) => saved.code === rate.code) ? rate.code : "" })} value={rate.label} />
        <TextInput inputType="text" isDisabled={!canManage} isRequired label={t("Rate")} onChange={(value) => update(index, { rate: value.replace(/[^\d.]/g, "") })} suffix="%" value={rate.rate} />
        <Switch isDisabled={!canManage} isSelected={rate.isDefault} onChange={(value) => value && update(index, { isDefault: true })}>{t("Default")}</Switch>
        {canManage ? <IconButton aria-label={`${t("Remove")} ${rate.label}`} onPress={() => setRates((current) => current.filter((_, at) => at !== index))}><Trash2 aria-hidden="true" size={15} /></IconButton> : null}
      </div>)}
    </div>
    {canManage ? <Button size="compact" variant="quiet" onPress={() => setRates((current) => [...current, { code: "", label: current.length ? "" : t("Standard"), rate: "", isDefault: current.length === 0 }])}><Plus aria-hidden="true" size={14} />{t("Add rate")}</Button> : null}
    <Switch isDisabled={!canManage} isSelected={pricesIncludeTax} onChange={setPricesIncludeTax}>{t("Prices include tax")}</Switch>
    {canManage ? <div className={styles.actions}><Button isLoading={saving} onPress={() => void save()} variant="primary">{t("Save tax")}</Button></div> : null}
  </section>;
}

function NumberingSection({ data, canManage, workspaceId, entityId, onSaved }: { data: TaxNumbering; canManage: boolean; workspaceId: string; entityId: string; onSaved: (next: TaxNumbering) => void }) {
  const t = useT();
  const documentLabel = { QUOTATION: t("Quotations"), INVOICE: t("Invoices"), CREDIT_NOTE: t("Credit notes"), PURCHASE_ORDER: t("Purchase orders"), DEAL_FILE: t("Deal files") };
  const [rows, setRows] = useState<NumberingRow[]>(data.numbering);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const update = (type: NumberingRow["documentType"], patch: Partial<NumberingRow>) => setRows((current) => current.map((row) => row.documentType === type ? { ...row, ...patch } : row));
  const changed = rows.filter((row) => { const saved = data.numbering.find((item) => item.documentType === row.documentType)!; return !row.exists || row.prefix !== saved.prefix || (row.suffix ?? "") !== (saved.suffix ?? "") || row.padding !== saved.padding || row.resetPolicy !== saved.resetPolicy || row.nextNumber !== saved.nextNumber; });
  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      let next: TaxNumbering | null = null;
      for (const row of changed) {
        const saved = data.numbering.find((item) => item.documentType === row.documentType)!;
        next = await send<TaxNumbering>(`/api/workspace/legal-entities/${entityId}/numbering/${row.documentType}`, {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId, version: row.version, prefix: row.prefix, suffix: row.suffix ?? "", padding: row.padding, resetPolicy: row.resetPolicy, ...(row.nextNumber !== saved.nextNumber ? { nextNumber: row.nextNumber } : {}) }),
        });
      }
      if (next) { onSaved(next); setRows(next.numbering); }
      setMessage({ tone: "success", text: t("Numbering saved.") });
    } catch (error) { setMessage({ tone: "error", text: (error instanceof Error && error.message) || t("Something went wrong. Try again.") }); }
    finally { setSaving(false); }
  };

  return <section className={styles.section} aria-labelledby="numbering-heading">
    <header className={styles.sectionHeader}><h3 id="numbering-heading">{t("Document numbering")}</h3></header>
    {message ? <InlineNotice message={message.text} tone={message.tone} /> : null}
    {rows.map((row) => <fieldset className={styles.sequence} key={row.documentType}>
      <legend>{documentLabel[row.documentType]}<output className={styles.preview} dir="ltr">{previewNumber(row.prefix, row.padding, row.nextNumber, undefined, row.suffix ?? "")}</output></legend>
      <TextInput description={t("Use {YYYY} for the year.")} isDisabled={!canManage} isRequired label={t("Prefix")} onChange={(value) => update(row.documentType, { prefix: value })} value={row.prefix} />
      <TextInput isDisabled={!canManage} label={t("Suffix")} onChange={(value) => update(row.documentType, { suffix: value })} value={row.suffix ?? ""} />
      <SelectField isDisabled={!canManage} items={DIGITS} label={t("Digits")} onSelectionChange={(key) => update(row.documentType, { padding: Number(key) })} selectedKey={String(row.padding)} />
      <TextInput isDisabled={!canManage} label={t("Next number")} onChange={(value) => update(row.documentType, { nextNumber: Number(value.replace(/\D/g, "")) || 1 })} value={String(row.nextNumber)} />
      <Switch isDisabled={!canManage} isSelected={row.resetPolicy === "annual"} onChange={(value) => update(row.documentType, { resetPolicy: value ? "annual" : "never", prefix: value && !row.prefix.includes("{YYYY}") ? `${row.prefix}{YYYY}-` : row.prefix })}>{t("Start again each year")}</Switch>
    </fieldset>)}
    {canManage ? <div className={styles.actions}><Button isDisabled={!changed.length} isLoading={saving} onPress={() => void save()} variant="primary">{t("Save numbering")}</Button></div> : null}
  </section>;
}
