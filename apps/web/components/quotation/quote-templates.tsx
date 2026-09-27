"use client";

import { useEffect, useState } from "react";
import { Bookmark, Sparkles } from "lucide-react";
import { Button, ControlledModalDialog, EmptyState, InlineNotice, RadioSet, SelectField, Skeleton, TextInput, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { quoteApi } from "@/lib/quotation/client";
import { plain } from "@/lib/quotation/format";
import type { BuilderState, LineOp, QuoteTemplate, TemplateLine } from "@/lib/quotation/types";
import styles from "./quote-builder.module.css";

type Api = ReturnType<typeof quoteApi>;

/** A template's lines as builder changes into one area: catalog items are priced from today's catalog, others keep the template's rate. */
export function templateOps(lines: TemplateLine[], areaFor: (line: TemplateLine) => string | null, canEditCosts: boolean): LineOp[] {
  return lines.map((line): LineOp => {
    const id = crypto.randomUUID();
    const shared = {
      id, areaId: areaFor(line), workPackageId: line.workPackageId, quantity: line.quantity, formula: line.formula,
      length: line.length, width: line.width, height: line.height, count: line.count, ...(line.optional ? { optional: true } : {}),
    };
    if (line.catalogItemId) return { op: "catalog", itemId: line.catalogItemId, line: shared };
    return { op: "upsert", line: {
      ...shared, title: line.title, description: line.description, unit: line.unit, kind: line.kind as never, rate: line.rate, pricingMode: line.pricingMode,
      ...(canEditCosts ? { unitCost: line.unitCost, markupPercent: line.markupPercent } : {}),
      ...(line.pricingMode === "build_up" && line.components.length ? { components: line.components } : {}),
    } };
  });
}

/** Insert a saved template into an area of this quote. */
export function InsertTemplate({ state, api, onInsert, onClose, createArea, onAskAssistant }: { state: BuilderState; api: Api; onInsert: (ops: LineOp[]) => void; onClose: () => void; createArea: (name: string) => Promise<{ id: string; name: string }>; onAskAssistant?: () => void }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [templates, setTemplates] = useState<QuoteTemplate[] | null>(null);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [area, setArea] = useState("keep");
  useEffect(() => {
    let alive = true;
    api.templates().then((result) => { if (alive) { setTemplates(result.templates); setChosen(result.templates[0]?.id ?? null); } }).catch((cause: Error) => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, [api]);
  const template = templates?.find((item) => item.id === chosen) ?? null;
  const hasAreas = Boolean(template?.lines.some((line) => line.areaName));
  const [busy, setBusy] = useState(false);
  // "Keep their areas": the template's area names map to this project's areas, adding the missing ones.
  const insert = async () => {
    if (!template) return;
    setBusy(true);
    try {
      const known = new Map(state.areas.map((item) => [item.name.trim().toLowerCase(), item.id]));
      if (area === "keep") for (const name of [...new Set(template.lines.map((line) => line.areaName?.trim()).filter((name): name is string => Boolean(name)))])
        if (!known.has(name.toLowerCase())) { const created = await createArea(name); known.set(name.toLowerCase(), created.id); }
      onInsert(templateOps(template.lines, (line) => area === "keep" ? (line.areaName ? known.get(line.areaName.trim().toLowerCase()) ?? null : null) : area === "general" ? null : area, state.canEditCosts));
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(false); }
  };
  const empty = templates !== null && !templates.length;
  return <ControlledModalDialog isOpen size="md" title={t("Insert a template")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className={styles.formActions}><span className={styles.spacer} /><Button size="compact" onPress={onClose}>{empty ? t("Close") : t("Cancel")}</Button>
      {empty ? null : <Button size="compact" variant="primary" isLoading={busy} isDisabled={!template || !template.lines.length} onPress={() => void insert()}>
        {template ? t("Insert {count} lines", { count: template.lines.length }) : t("Insert")}</Button>}</div>}>
    <div className={styles.dialogForm}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {!templates && !error ? <Skeleton lines={4} shape="rows" /> : null}
      {empty ? <EmptyState illustration={null} icon={<Bookmark aria-hidden="true" size={20} />} title={t("No templates yet")} description={t("Save an area as a template from its heading.")}
        action={onAskAssistant ? <Button size="compact" onPress={() => { onClose(); onAskAssistant(); }}><Sparkles aria-hidden="true" size={14} />{t("Ask the assistant instead")}</Button> : undefined} /> : null}
      {templates?.length ? <>
        <div className={styles.templatePick}>
          <RadioSet label={t("Template")} value={chosen ?? ""} onChange={(key) => setChosen(key)}
            items={templates.map((item) => ({ id: item.id, label: item.name, description: [item.lines.length === 1 ? t("1 line") : t("{count} lines", { count: item.lines.length }), ...[...new Set(item.lines.map((line) => line.areaName).filter(Boolean))].slice(0, 3)].join(" · ") }))} />
        </div>
        <SelectField label={t("Into")} selectedKey={area} onSelectionChange={(key) => setArea(String(key ?? "general"))}
          items={[...(hasAreas ? [{ id: "keep", label: t("Their own areas (added if missing)") }] : []), { id: "general", label: t("General") }, ...state.areas.map((item) => ({ id: item.id, label: item.name }))]} />
        {template ? <ul className={styles.templateLines}>{template.lines.map((line, index) => <li key={index}><span>{line.title}</span><small>{line.formula ? `ƒ ${line.formula}` : `${plain(line.quantity, locale)} ${line.unit}`}</small></li>)}</ul> : null}
      </> : null}
    </div>
  </ControlledModalDialog>;
}

/** Save one group's lines as a template. */
export function SaveTemplate({ api, scope, target, name, onClose, onError }: { api: Api; scope: "area" | "trade" | "quote"; target: string; name: string; onClose: () => void; onError: (message: string) => void }) {
  const t = useT();
  const [title, setTitle] = useState(name);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    try { const result = await api.saveTemplate(crypto.randomUUID(), title.trim(), scope, target); setDone(t("Saved “{name}” with {count} lines.", { name: result.name, count: result.lines })); }
    catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(false); }
  };
  return <ControlledModalDialog isOpen size="md" title={t("Save as template")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className={styles.formActions}><span className={styles.spacer} /><Button size="compact" onPress={onClose}>{done ? t("Close") : t("Cancel")}</Button>
      {done ? null : <Button size="compact" variant="primary" isLoading={busy} isDisabled={!title.trim()} onPress={() => void save()}>{t("Save")}</Button>}</div>}>
    <div className={styles.dialogForm}>
      {done ? <InlineNotice tone="success" message={done} /> : <TextInput label={t("Template name")} value={title} onChange={setTitle} />}
    </div>
  </ControlledModalDialog>;
}
