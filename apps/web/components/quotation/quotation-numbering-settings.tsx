"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, InlineNotice, SelectField, SettingsRow, SettingsSection, Skeleton, Switch, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { proposalsPath } from "@/lib/proposals/client";
import { previewNumber, type NumberingRow } from "@/lib/workspace/tax-numbering";
import styles from "./quotation-settings.module.css";

type Entity = { id: string; code: string; name: string; quotation: NumberingRow | null };
type Loaded = { canManage: boolean; entities: Entity[] };
const DIGITS = [3, 4, 5, 6, 7, 8].map((value) => ({ id: String(value), label: String(value) }));

async function call<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, cache: "no-store", headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : "Could not save.");
  return data as T;
}

/**
 * Quotation numbers per company (second client's #13): prefix, number, suffix and the next number, with the
 * number the next sent quotation gets. Numbers are given out once, in order, when a quotation is first sent;
 * an uploaded external quotation keeps its own. The same sequence Finance sees under Business records.
 */
export function QuotationNumberingSettings({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const next = await call<Loaded>(proposalsPath(workspaceId, "numbering"));
      if (!next || !Array.isArray(next.entities)) throw new Error(t("Could not load the settings."));
      setData(next); setError("");
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load the settings.")); }
  }, [workspaceId, t]);
  useEffect(() => { void load(); }, [load]);

  return <SettingsSection id="numbering" title={t("Quotation numbers")}>
    {error && !data ? <div className={styles.actions}><InlineNotice tone="error" message={error} /><Button size="compact" onPress={() => void load()}>{t("Retry")}</Button></div>
      : !data ? <Skeleton lines={3} shape="form" />
        : !data.entities.length ? <p className={styles.muted}>{t("Add your company under Business records to number quotations.")}</p>
          : data.entities.map((entity) => entity.quotation ? <EntityNumbering key={`${entity.id}:${entity.quotation.version}`} workspaceId={workspaceId} entity={entity} row={entity.quotation}
            readOnly={!data.canManage} onSaved={load} /> : null)}
  </SettingsSection>;
}

function EntityNumbering({ workspaceId, entity, row, readOnly, onSaved }: { workspaceId: string; entity: Entity; row: NumberingRow; readOnly: boolean; onSaved: () => Promise<void> }) {
  const t = useT();
  const [form, setForm] = useState(row);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const dirty = form.prefix !== row.prefix || (form.suffix ?? "") !== (row.suffix ?? "") || form.padding !== row.padding || form.resetPolicy !== row.resetPolicy || form.nextNumber !== row.nextNumber;
  const set = (patch: Partial<NumberingRow>) => { setForm({ ...form, ...patch }); setMessage(null); };
  const save = async () => {
    setBusy(true); setMessage(null);
    try {
      await call(`/api/workspace/legal-entities/${entity.id}/numbering/QUOTATION`, "PATCH", { workspaceId, version: row.version, prefix: form.prefix, suffix: form.suffix ?? "", padding: form.padding,
        resetPolicy: form.resetPolicy, ...(form.nextNumber !== row.nextNumber ? { nextNumber: form.nextNumber } : {}) });
      await onSaved();
    } catch (cause) { setMessage({ tone: "error", text: cause instanceof Error ? cause.message : t("Could not save.") }); }
    finally { setBusy(false); }
  };
  return <>
    <SettingsRow label={entity.name} hint={t("Next quotation: {number}", { number: previewNumber(form.prefix, form.padding, form.nextNumber, undefined, form.suffix ?? "") })}>
      <div className={styles.numbering}>
        <TextInput label={t("Prefix")} description={t("Use {YYYY} for the year.")} isReadOnly={readOnly} value={form.prefix} onChange={(prefix) => set({ prefix })} />
        <TextInput label={t("Suffix")} isReadOnly={readOnly} value={form.suffix ?? ""} onChange={(suffix) => set({ suffix })} />
        <SelectField label={t("Digits")} accent="neutral" isDisabled={readOnly} items={DIGITS} selectedKey={String(form.padding)} onSelectionChange={(key) => set({ padding: Number(key) })} />
        <TextInput label={t("Next number")} isReadOnly={readOnly} inputMode="numeric" value={String(form.nextNumber)} onChange={(value) => set({ nextNumber: Number(value.replace(/\D/g, "")) || 1 })} />
        <Switch isDisabled={readOnly} isSelected={form.resetPolicy === "annual"}
          onChange={(annual) => set({ resetPolicy: annual ? "annual" : "never", prefix: annual && !form.prefix.includes("{YYYY}") ? `${form.prefix}{YYYY}-` : form.prefix })}>{t("Start again each year")}</Switch>
      </div>
    </SettingsRow>
    {message ? <InlineNotice tone={message.tone} message={message.text} /> : null}
    {!readOnly && dirty ? <div className={styles.actions}>
      <Button size="compact" onPress={() => { setForm(row); setMessage(null); }}>{t("Cancel")}</Button>
      <Button size="compact" variant="primary" isLoading={busy} onPress={() => void save()}>{t("Save")}</Button>
    </div> : null}
  </>;
}
