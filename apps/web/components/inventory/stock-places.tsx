"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, SelectField, SettingsPage, SettingsSection, Skeleton, Switch, TextInput, isNoAccessError, NoAccessState, FormDialog } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { inventoryApi } from "@/lib/inventory/client";
import type { LocationKind, StockLocation } from "@/lib/inventory/types";
import styles from "./inventory.module.css";

type Draft = { id: string; kind: LocationKind; name: string; address: string; isDefault: boolean; active: boolean; isNew: boolean };

/** Settings → Stock places: warehouses, the factory and other places stock is kept. A project's site is added by its first delivery. */
export function StockPlacesSettings({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const api = useMemo(() => inventoryApi(workspaceId), [workspaceId]);
  const [data, setData] = useState<{ locations: StockLocation[]; canManage: boolean } | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const kinds = useMemo(() => ({ warehouse: t("Warehouse"), factory: t("Factory"), site: t("Project site"), other: t("Other") } satisfies Record<LocationKind, string>), [t]);
  const load = useCallback(async () => {
    try { setData(await api.locations()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load the settings.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (error && !data) return isNoAccessError(error) ? <NoAccessState area={t("Stock places")} /> : <EmptyState illustration="error" title={t("Settings didn't load")} description={error} action={<Button size="compact" onPress={() => void load()}>{t("Retry")}</Button>} />;
  if (!data) return <Skeleton lines={6} shape="rows" />;
  const edit = (location: StockLocation) => setDraft({ id: location.id, kind: location.kind, name: location.name, address: location.address, isDefault: location.isDefault, active: location.active, isNew: false });
  return <SettingsPage title={t("Stock places")}>
    <SettingsSection id="places" title={t("Places")}>
      {!data.locations.length ? <EmptyState illustration={null} title={t("No places yet")} description={t("The first delivery adds the warehouse or the project's site.")} />
        : <ul className={styles.places}>{data.locations.map((location) => <li key={location.id}>
          <span className={styles.nameCell}><span>{location.name}</span>
            <small>{[kinds[location.kind], location.isDefault ? t("Default") : "", location.active ? "" : t("Closed"), location.address].filter(Boolean).join(" · ")}</small></span>
          {data.canManage ? <Button size="compact" variant="quiet" onPress={() => edit(location)}>{t("Edit")}</Button> : null}
        </li>)}</ul>}
      {data.canManage ? <div className={styles.actions}><Button size="compact" onPress={() => setDraft({ id: crypto.randomUUID(), kind: "warehouse", name: "", address: "", isDefault: false, active: true, isNew: true })}>
        {t("Add place")}</Button></div> : null}
    </SettingsSection>
    {draft ? <PlaceDialog draft={draft} kinds={kinds} onClose={() => setDraft(null)} onSave={async (next) => {
      const saved = await api.saveLocation({ id: next.id, kind: next.kind, name: next.name.trim(), address: next.address.trim(), isDefault: next.isDefault, active: next.active });
      setData({ ...data, locations: saved.locations }); setDraft(null);
    }} /> : null}
  </SettingsPage>;
}

function PlaceDialog({ draft, kinds, onClose, onSave }: { draft: Draft; kinds: Record<LocationKind, string>; onClose: () => void; onSave: (draft: Draft) => Promise<void> }) {
  const t = useT();
  const [value, setValue] = useState(draft);
  const [error, setError] = useState("");
  const site = value.kind === "site";
  return <FormDialog size="md" title={draft.isNew ? t("Add place") : draft.name} onClose={onClose} error={error || undefined} isSubmitDisabled={!value.name.trim()} submitLabel={t("Save")} onSubmit={async () => { setError("");
        try { await onSave(value); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
      }}>
      <TextInput label={t("Name")} isRequired value={value.name} onChange={(name) => setValue({ ...value, name })} />
      {site ? <TextInput label={t("Kind")} isReadOnly value={kinds.site} onChange={() => undefined} /> : <SelectField label={t("Kind")} isDisabled={!draft.isNew} selectedKey={value.kind}
        onSelectionChange={(key) => setValue({ ...value, kind: key as LocationKind })} items={(["warehouse", "factory", "other"] as const).map((id) => ({ id, label: kinds[id] }))} />}
      <TextInput label={t("Address")} value={value.address} onChange={(address) => setValue({ ...value, address })} />
      {site ? null : <>
        <Switch isSelected={value.isDefault} onChange={(isDefault) => setValue({ ...value, isDefault })}>{t("Default place of this kind")}</Switch>
        {draft.isNew ? null : <Switch isSelected={value.active} onChange={(active) => setValue({ ...value, active })}>{t("Open")}</Switch>}
      </>}
  </FormDialog>;
}
