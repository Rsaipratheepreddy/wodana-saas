"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LocateFixed } from "lucide-react";
import type { WorkContext, WorkLocation } from "@wodana/contracts";
import {
  Badge, Button, DataGrid, EmptyState, ErrorState, FormSection, InlineNotice, InspectorSheet, NumericInput, SegmentedControl, SelectField, Switch, TextAreaField, TextInput, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { HrmsApi } from "@/lib/hrms/api";
import { useHrmsFormat } from "./hrms-format";
import { Facts } from "./hrms-controls";
import styles from "./hrms.module.css";

type Places = { locations: WorkLocation[]; contexts: WorkContext[] };
const contextOf = (location: Pick<WorkLocation, "projectId" | "caseId">, contexts: WorkContext[]) =>
  contexts.find((context) => (context.kind === "project" ? context.id === location.projectId : context.id === location.caseId && !location.projectId)) ?? null;

/** Where people check in: offices, and the sites of projects; each with its location and how far from it counts as there. */
export function WorkplaceSettings({ api, creating, onCreateDone }: { api: HrmsApi; creating: boolean; onCreateDone: () => void }) {
  const t = useT();
  const format = useHrmsFormat();
  const [places, setPlaces] = useState<Places | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<WorkLocation | null>(null);
  const load = useCallback(async () => {
    try {
      const [locations, contexts] = await Promise.all([api.locations(), api.contexts()]);
      setPlaces({ locations, contexts }); setError("");
    } catch (cause) { setError(format.failure(cause, t("Workplaces didn't load."))); }
  }, [api, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const kind = useCallback((row: WorkLocation) => row.kind === "office" ? t("Office")
    : [t("Site"), contextOf(row, places?.contexts ?? [])?.name].filter(Boolean).join(" · "), [t, places]);
  const columns = useMemo<DataGridColumn<WorkLocation>[]>(() => [
    { id: "name", header: t("Name"), accessorFn: (row) => row.name, size: 220, meta: { primary: true } },
    { id: "kind", header: t("Kind"), accessorFn: kind, size: 240 },
    { id: "address", header: t("Address"), accessorFn: (row) => row.address, size: 260, meta: { mobileHidden: true } },
    { id: "radius", header: t("Radius"), accessorFn: (row) => row.radiusM, size: 100, meta: { renderCell: (row) => <span className={styles.number}>{format.metres(row.radiusM)}</span> } },
    { id: "active", header: t("Active"), accessorFn: (row) => row.active, size: 120,
      meta: { renderCell: (row) => <Badge tone={row.active ? "success" : "neutral"}>{row.active ? t("Active") : t("Not in use")}</Badge> } },
  ], [t, format, kind]);
  if (error && !places) return <ErrorState description={error} onRetry={() => void load()} />;
  const saved = () => { setEditing(null); onCreateDone(); void load(); };
  return <>
    <DataGrid<WorkLocation> ariaLabel={t("Workplaces")} columns={columns} data={[...(places?.locations ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))}
      getRowId={(row) => row.id} isLoading={!places} onRowAction={setEditing} rowNumbers={false} selectable={false} wrapText searchLabel={t("Search workplaces")}
      emptyContent={<EmptyState title={t("No workplaces yet")} />} />
    {places && editing ? <WorkplaceSheet key={editing.id} api={api} location={editing} contexts={places.contexts} onClose={() => setEditing(null)} onSaved={saved} /> : null}
    {places && creating ? <WorkplaceSheet key="new" api={api} location={null} contexts={places.contexts} onClose={onCreateDone} onSaved={saved} /> : null}
  </>;
}

/** An office or a project's site: where it is (from an address and coordinates, or where I stand now) and how far from it counts. Its kind and project are fixed once saved. */
function WorkplaceSheet({ api, location, contexts, onClose, onSaved }: { api: HrmsApi; location: WorkLocation | null; contexts: WorkContext[]; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const format = useHrmsFormat();
  const initial = {
    kind: location?.kind ?? ("office" as WorkLocation["kind"]), contextId: location ? contextOf(location, contexts)?.id ?? null : null, name: location?.name ?? "", address: location?.address ?? "",
    latitude: location ? Number(location.latitude) : NaN, longitude: location ? Number(location.longitude) : NaN, radiusM: location?.radiusM ?? 150, active: location?.active ?? true,
  };
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const context = contexts.find((item) => item.id === form.contextId) ?? null;
  const coordinates = Number.isFinite(form.latitude) && Math.abs(form.latitude) <= 90 && Number.isFinite(form.longitude) && Math.abs(form.longitude) <= 180;
  const radius = Number.isInteger(form.radiusM) && form.radiusM >= 25 && form.radiusM <= 2000;
  const valid = Boolean(form.name.trim()) && coordinates && radius && (form.kind === "office" || Boolean(context));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const locate = () => {
    if (!navigator.geolocation) { setError(t("Location unavailable")); return; }
    setLocating(true); setError("");
    navigator.geolocation.getCurrentPosition((fix) => {
      setForm((current) => ({ ...current, latitude: Number(fix.coords.latitude.toFixed(6)), longitude: Number(fix.coords.longitude.toFixed(6)) }));
      setLocating(false);
    }, () => { setError(t("Location unavailable")); setLocating(false); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  };
  const save = async () => {
    setBusy(true); setError("");
    try {
      await api.saveLocation({ ...(location ? { id: location.id } : {}), version: location?.version ?? 0, name: form.name.trim(), kind: form.kind,
        projectId: form.kind === "site" && context?.kind === "project" ? context.id : null, caseId: form.kind === "site" && context?.kind === "pre_project" ? context.id : null,
        address: form.address.trim(), latitude: form.latitude, longitude: form.longitude, radiusM: form.radiusM, active: form.active });
      onSaved();
    } catch (cause) { setError(format.failure(cause, t("Could not save."))); setBusy(false); }
  };
  return <InspectorSheet isOpen size="md" title={location?.name ?? t("New workplace")} isDirty={dirty && !busy} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={<div className="wd-dialog-actions"><span className={styles.spacer} />
      <Button variant="primary" isLoading={busy} isDisabled={!dirty || !valid} onPress={() => void save()}>{t("Save")}</Button></div>}>
    <div className={styles.sheet}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <FormSection>
        {location ? <Facts items={[[t("Kind"), location.kind === "office" ? t("Office") : t("Site")], location.kind === "site" ? [t("Project"), context?.name ?? ""] : null]} /> : <>
          <SegmentedControl label={t("Kind")} value={form.kind} onChange={(value) => set("kind", value as WorkLocation["kind"])} options={[{ id: "office", label: t("Office") }, { id: "site", label: t("Site") }]} />
          {form.kind === "site" ? <SelectField label={t("Project")} isRequired placeholder={t("Choose")} selectedKey={form.contextId} onSelectionChange={(key) => set("contextId", key ? String(key) : null)}
            items={contexts.map((item) => ({ id: item.id, label: item.name, description: item.customerName }))} /> : null}
        </>}
        <TextInput label={t("Name")} isRequired value={form.name} onChange={(value) => set("name", value)} maxLength={160} />
        <Switch isSelected={form.active} onChange={(value) => set("active", value)}>{t("Active")}</Switch>
      </FormSection>
      <FormSection title={t("Location")}>
        <TextAreaField label={t("Address")} value={form.address} onChange={(value) => set("address", value)} maxLength={500} />
        <NumericInput label={t("Latitude")} isRequired minValue={-90} maxValue={90} formatOptions={{ maximumFractionDigits: 7 }} value={form.latitude} onChange={(value) => set("latitude", value)} />
        <NumericInput label={t("Longitude")} isRequired minValue={-180} maxValue={180} formatOptions={{ maximumFractionDigits: 7 }} value={form.longitude} onChange={(value) => set("longitude", value)} />
        <div><Button size="compact" isLoading={locating} onPress={locate}><LocateFixed aria-hidden="true" size={14} />{t("Use my location")}</Button></div>
        <NumericInput label={t("Radius")} isRequired suffix={format.unit("meter")} minValue={25} maxValue={2000} step={1} value={form.radiusM} onChange={(value) => set("radiusM", value)} />
      </FormSection>
    </div>
  </InspectorSheet>;
}
