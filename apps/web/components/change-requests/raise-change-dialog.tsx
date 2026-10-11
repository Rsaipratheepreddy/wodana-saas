"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, FormDialog, FormRow, FormSection, IconButton, MoneyField, SearchInput, SelectField, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { REASON_LABEL, type ChangeReason, type ChangeRecord, type ChangeSources, type ProjectChangesApi, type RaisedLine } from "@/lib/change-requests/project";
import styles from "./project-changes.module.css";

type Draft = { id: string; source: RaisedLine["source"]; action: RaisedLine["action"]; title: string; quantity: string; unit: string; unitPrice: string; roomId: string | null;
  catalogItemId: string | null; boqLineId: string | null };
const NONE = "__none";

const blank = (): Draft => ({ id: crypto.randomUUID(), source: "custom", action: "add", title: "", quantity: "1", unit: "", unitPrice: "", roomId: null, catalogItemId: null, boqLineId: null });

/**
 * Raise (or, while it's raised, edit) a change on the project: its name, why, what changes in words, and its lines —
 * new work, an item from the catalogue, or an item already in the scope removed, replaced or moved. The variation
 * quotation prices it afterwards; the days per stage are set on its Timeline impact.
 */
export function RaiseChangeDialog({ api, change, onClose, onSaved }: { api: ProjectChangesApi; change?: ChangeRecord["change"]; onClose: () => void; onSaved: (record: ChangeRecord) => void }) {
  const t = useT();
  const [id] = useState(() => change?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(change?.title ?? "");
  const [reason, setReason] = useState<ChangeReason>(change?.reason ?? "client_request");
  const [description, setDescription] = useState(change?.description ?? "");
  const [lines, setLines] = useState<Draft[]>(() => (change?.lines ?? []).filter((line) => ["custom", "catalog", "boq_line"].includes(line.source)).map((line) => ({
    id: line.id, source: line.source, action: line.action, title: line.title, quantity: line.quantity ?? "", unit: line.unit, unitPrice: line.unitPrice ?? "", roomId: line.roomId,
    catalogItemId: line.catalogItemId, boqLineId: line.boqLineId })));
  const [sources, setSources] = useState<ChangeSources | null>(null);
  const linesEditable = !change || change.status === "draft";
  useEffect(() => { let alive = true; api.sources().then((next) => { if (alive) setSources(next); }).catch(() => undefined); return () => { alive = false; }; }, [api]);
  const set = (index: number, patch: Partial<Draft>) => setLines((current) => current.map((line, at) => (at === index ? { ...line, ...patch } : line)));
  const rooms = [{ id: NONE, label: t("General") }, ...(sources?.rooms ?? []).map((room) => ({ id: room.id, label: room.name }))];
  const body = () => ({
    title: title.trim(), reason, description: description.trim(),
    ...(linesEditable ? { lines: lines.map((line) => ({ id: line.id, source: line.source, action: line.source === "boq_line" ? line.action : "add", title: line.title.trim(),
      quantity: line.source === "boq_line" && line.action === "move" ? null : line.quantity, unit: line.unit, unitPrice: line.source === "custom" ? line.unitPrice || null : null,
      roomId: line.roomId, catalogItemId: line.catalogItemId, boqLineId: line.boqLineId })) } : {}),
  });
  const submit = async () => {
    const record = change ? await api.save(change.id, { ...body(), version: change.version }) : await api.raise({ id, ...body() });
    onSaved(record);
  };
  const ready = Boolean(title.trim()) && lines.every((line) => line.title.trim() && (line.source !== "catalog" || line.catalogItemId) && (line.source !== "boq_line" || line.boqLineId)
    && (line.source === "boq_line" && line.action === "move" ? Boolean(line.roomId) : Number(line.quantity) > 0));
  return <FormDialog title={change ? t("Edit {reference}", { reference: change.reference }) : t("Raise a change")} onClose={onClose} isDirty submitLabel={change ? t("Save") : t("Raise")}
    size="lg" isSubmitDisabled={!ready} onSubmit={submit}>
    <FormSection>
      <TextInput isRequired autoFocus label={t("Name")} maxLength={240} value={title} onChange={setTitle} />
      <SelectField label={t("Reason")} items={(Object.keys(REASON_LABEL) as ChangeReason[]).map((key) => ({ id: key, label: t(REASON_LABEL[key]) }))} selectedKey={reason}
        onSelectionChange={(key) => setReason(String(key) as ChangeReason)} />
      <TextAreaField label={t("What changes")} maxLength={4000} value={description} onChange={setDescription} />
    </FormSection>
    {linesEditable ? <FormSection title={t("Lines")}>
      <div className={styles.lines}>
        {lines.map((line, index) => <LineEditor key={line.id} line={line} index={index} sources={sources} api={api} rooms={rooms} onChange={(patch) => set(index, patch)}
          onRemove={() => setLines((current) => current.filter((_, at) => at !== index))} />)}
        <div><Button size="compact" onPress={() => setLines((current) => [...current, blank()])}><Plus aria-hidden="true" size={14} />{t("Add a line")}</Button></div>
      </div>
    </FormSection> : null}
  </FormDialog>;
}

function LineEditor({ line, index, sources, api, rooms, onChange, onRemove }: {
  line: Draft; index: number; sources: ChangeSources | null; api: ProjectChangesApi; rooms: Array<{ id: string; label: string }>; onChange: (patch: Partial<Draft>) => void; onRemove: () => void;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<ChangeSources["catalog"]>([]);
  useEffect(() => {
    if (line.source !== "catalog" || search.trim().length < 2) return;
    let alive = true;
    const timer = window.setTimeout(() => { api.sources(search.trim()).then((next) => { if (alive) setHits(next.catalog); }).catch(() => undefined); }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [api, line.source, search]);
  const scope = sources?.scope ?? [];
  const picked = scope.find((item) => item.id === line.boqLineId);
  return <div className={styles.line}>
    <FormRow>
      <SelectField label={t("From")} selectedKey={line.source} onSelectionChange={(key) => onChange({ source: String(key) as Draft["source"], action: String(key) === "boq_line" ? "omit" : "add",
        catalogItemId: null, boqLineId: null, title: "" })}
        items={[{ id: "custom", label: t("New work") }, { id: "catalog", label: t("Catalogue") }, { id: "boq_line", label: t("In the scope") }]} />
      {line.source === "boq_line" ? <SelectField label={t("Change")} selectedKey={line.action} onSelectionChange={(key) => onChange({ action: String(key) as Draft["action"] })}
        items={[{ id: "omit", label: t("Remove") }, { id: "replace", label: t("Replace") }, { id: "move", label: t("Move") }]} /> : null}
      <IconButton aria-label={t("Remove line {number}", { number: index + 1 })} onPress={onRemove}><Trash2 size={14} /></IconButton>
    </FormRow>
    {line.source === "custom" ? <>
      <TextInput isRequired label={t("Line")} maxLength={240} value={line.title} onChange={(value) => onChange({ title: value })} />
      <FormRow>
        <TextInput isRequired label={t("Quantity")} inputMode="decimal" value={line.quantity} onChange={(value) => onChange({ quantity: value.replace(/[^\d.]/g, "") })} />
        <TextInput label={t("Unit")} maxLength={40} value={line.unit} onChange={(value) => onChange({ unit: value })} />
        <MoneyField label={t("Estimate")} value={line.unitPrice} onChange={(value) => onChange({ unitPrice: value })} />
      </FormRow>
    </> : line.source === "catalog" ? <>
      {line.catalogItemId ? <p className={styles.muted}>{line.title}</p> : <>
        <SearchInput label={t("Search the catalogue")} value={search} onChange={setSearch} />
        {hits.length ? <ul className={styles.picks} aria-label={t("Catalogue items")}>{hits.map((item) => <li key={item.id}><button type="button"
          onClick={() => onChange({ catalogItemId: item.id, title: item.name, unit: item.unit })}><span>{item.name}</span><span className={styles.muted}>{item.code}</span></button></li>)}</ul> : null}
      </>}
      <TextInput isRequired label={t("Quantity")} inputMode="decimal" value={line.quantity} onChange={(value) => onChange({ quantity: value.replace(/[^\d.]/g, "") })} />
    </> : <>
      <SelectField label={t("Item")} placeholder={t("Choose an item")} selectedKey={line.boqLineId} items={scope.map((item) => ({ id: item.id,
        label: [item.title, item.areaName ?? t("General"), `${item.quantity} ${item.unit}`.trim()].join(" · ") }))}
        onSelectionChange={(key) => { const item = scope.find((entry) => entry.id === String(key)); onChange({ boqLineId: String(key), title: item?.title ?? "", unit: item?.unit ?? "", quantity: item ? String(Number(item.quantity)) : "" }); }} />
      {line.action === "move" ? null
        : <TextInput isRequired label={line.action === "replace" ? t("How much to replace") : t("How much to remove")} inputMode="decimal" value={line.quantity}
          description={picked ? t("Up to {quantity} {unit}", { quantity: String(Number(picked.quantity)), unit: picked.unit }) : undefined}
          onChange={(value) => onChange({ quantity: value.replace(/[^\d.]/g, "") })} />}
    </>}
    {line.source !== "boq_line" || line.action === "move" ? <SelectField label={line.action === "move" ? t("Move to") : t("Room")} selectedKey={line.roomId ?? NONE}
      onSelectionChange={(key) => onChange({ roomId: String(key) === NONE ? null : String(key) })}
      items={line.action === "move" ? rooms.filter((room) => room.id !== (picked?.areaId ?? NONE)) : rooms} /> : null}
  </div>;
}
