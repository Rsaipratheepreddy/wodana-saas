"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HrmsBootstrap, HrmsCrew, HrmsCrewState, HrmsPerson, HrmsWorker } from "@wodana/contracts";
import {
  Badge, Button, ComboboxField, DataGrid, EmptyState, ErrorState, InlineNotice, InspectorSheet, NoAccessState, NoResultsState, PhoneField, ListTabs, SelectField, Switch,
  TextInput, useDesignSystem, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { HrmsApi } from "@/lib/hrms/api";
import { HrmsError } from "@/lib/hrms/client";
import { joinPhone, phoneCountry, splitPhone } from "@/lib/phone";
import { projectApi } from "@/lib/project-core/client";
import { purchasingApi } from "@/lib/purchasing/client";
import { currencyOptions } from "@/lib/workspace/regional-options";
import { PersonDocuments } from "./documents-tab";
import { Facts } from "./hrms-controls";
import { useHrmsFormat } from "./hrms-format";
import styles from "./hrms.module.css";

export type CrewView = "crews" | "workers";
export type CrewsOpen = { crew: string | null; worker: string | null };
type Option = { id: string; label: string; description?: string };

const RATE = /^\d{1,14}(\.\d{1,4})?$/;
const decimal = (value: string) => value.replace(/[^\d.]/g, "");
const money = (locale: string, value: string, currency: string) => {
  try { return new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(value)); } catch { return `${currency} ${value}`; }
};

/**
 * The crews and workers who work without logins: HR keeps them (a trade, a lead, a subcontractor, each
 * worker's own day rate); crew leads and the people who run projects see them. Two views, one grid each.
 */
export function CrewsTab({ api, boot, workspaceId, view, onView, creating, onCreate, open, onOpen, onOpenDocument }: {
  api: HrmsApi; boot: HrmsBootstrap; workspaceId: string; view: CrewView; onView: (view: CrewView) => void;
  /** A new crew or worker being written (from the page's primary action), or nothing. */
  creating: CrewView | null; onCreate: (kind: CrewView | null) => void; open: CrewsOpen; onOpen: (open: Partial<CrewsOpen>) => void; onOpenDocument?: (id: string) => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const { locale } = useDesignSystem();
  const [state, setState] = useState<HrmsCrewState | null>(null);
  const [error, setError] = useState<{ message: string; denied: boolean } | null>(null);
  const [search, setSearch] = useState("");
  const load = useCallback(async () => {
    try { setState(await api.crews()); setError(null); }
    catch (cause) { setError({ message: format.failure(cause, t("Crews didn't load.")), denied: cause instanceof HrmsError && cause.status === 403 }); }
  }, [api, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const manage = state?.canManage ?? boot.permissions.manage;
  const crewName = useCallback((id: string | null) => (id ? state?.crews.find((crew) => crew.id === id)?.name ?? "" : ""), [state]);
  const crewColumns = useMemo<DataGridColumn<HrmsCrew>[]>(() => [
    { id: "name", header: t("Name"), accessorFn: (row) => row.name, size: 220, meta: { primary: true } },
    { id: "trade", header: t("Trade"), accessorFn: (row) => row.trade, size: 160 },
    { id: "lead", header: t("Lead"), accessorFn: (row) => row.leadName ?? "", size: 180, meta: { mobileHidden: true } },
    { id: "vendor", header: t("Subcontractor"), accessorFn: (row) => row.vendorName ?? "", size: 200, meta: { mobileHidden: true } },
    { id: "workers", header: t("Workers"), accessorFn: (row) => row.workers, size: 100, meta: { align: "end", renderCell: (row) => <span className={styles.number}>{format.number(row.workers)}</span> } },
    { id: "active", header: t("Active"), accessorFn: (row) => row.active, size: 110, meta: { renderCell: (row) => <ActiveBadge active={row.active} /> } },
  ], [t, format]);
  const workerColumns = useMemo<DataGridColumn<HrmsWorker>[]>(() => [
    { id: "name", header: t("Name"), accessorFn: (row) => row.name, size: 240, meta: { primary: true,
      renderCell: (row) => <span className={styles.nameCell}><span>{row.name}</span>{row.workerCode ? <small>{row.workerCode}</small> : null}</span> } },
    { id: "trade", header: t("Trade"), accessorFn: (row) => row.trade, size: 160 },
    { id: "crew", header: t("Crew"), accessorFn: (row) => crewName(row.crewId), size: 180, meta: { mobileHidden: true } },
    ...(manage ? [{ id: "rate", header: t("Day rate"), accessorFn: (row: HrmsWorker) => row.dayRate ?? "", size: 150, meta: { align: "end" as const, mobileHidden: true,
      renderCell: (row: HrmsWorker) => row.dayRate && row.currency ? <span className={styles.number}>{money(locale, row.dayRate, row.currency)}</span>
        : <span className={styles.muted}>{t("Trade rate")}</span> } }] : []),
    { id: "active", header: t("Active"), accessorFn: (row) => row.active, size: 110, meta: { renderCell: (row) => <ActiveBadge active={row.active} /> } },
  ], [t, crewName, manage, locale]);
  const switcher = <ListTabs label={t("Show")} value={view} onChange={(value) => { setSearch(""); onView(value); }}
    items={[{ id: "crews", label: t("Crews") }, { id: "workers", label: t("Workers") }]} />;
  if (error && !state) return error.denied ? <NoAccessState /> : <><div className={styles.toolbar}>{switcher}</div><ErrorState description={error.message} onRetry={() => void load()} /></>;
  const needle = search.trim().toLocaleLowerCase();
  const matches = (...values: Array<string | null>) => !needle || values.some((value) => value?.toLocaleLowerCase().includes(needle));
  const crewRows = (state?.crews ?? []).filter((crew) => matches(crew.name, crew.trade, crew.leadName, crew.vendorName));
  const workerRows = (state?.workers ?? []).filter((worker) => matches(worker.name, worker.trade, worker.workerCode, worker.phone, crewName(worker.crewId)));
  const crew = creating === "crews" ? "new" : open.crew ? state?.crews.find((item) => item.id === open.crew) ?? null : null;
  const worker = creating === "workers" ? "new" : open.worker ? state?.workers.find((item) => item.id === open.worker) ?? null : null;
  const close = () => { if (creating) onCreate(null); else onOpen({ crew: null, worker: null }); };
  const saved = (next: HrmsCrewState) => { setState(next); close(); };
  const empty = (title: string) => needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={title} />;
  return <>
    {view === "crews"
      ? <DataGrid<HrmsCrew> ariaLabel={t("Crews")} columns={crewColumns} data={crewRows} getRowId={(row) => row.id} isLoading={!state}
          onRowAction={(row) => onOpen({ crew: row.id, worker: null })} onSearchChange={setSearch} searchValue={search} searchLabel={t("Search crews")} rowNumbers={false} selectable={false}
          wrapText toolbarLeading={switcher} emptyContent={empty(t("No crews yet"))} />
      : <DataGrid<HrmsWorker> ariaLabel={t("Workers")} columns={workerColumns} data={workerRows} getRowId={(row) => row.id} isLoading={!state}
          onRowAction={(row) => onOpen({ worker: row.id, crew: null })} onSearchChange={setSearch} searchValue={search} searchLabel={t("Search workers")} rowNumbers={false} selectable={false}
          wrapText toolbarLeading={switcher} emptyContent={empty(t("No workers yet"))} />}
    {state && crew ? <CrewSheet key={crew === "new" ? "new" : crew.id} api={api} workspaceId={workspaceId} state={state} crew={crew === "new" ? null : crew}
      manage={manage} onClose={close} onSaved={saved} /> : null}
    {state && worker ? <WorkerSheet key={worker === "new" ? "new" : worker.id} api={api} workspaceId={workspaceId} state={state}
      worker={worker === "new" ? null : worker} manage={manage} onClose={close} onSaved={saved} onOpenDocument={onOpenDocument} /> : null}
  </>;
}

function ActiveBadge({ active }: { active: boolean }) {
  const t = useT();
  return <Badge tone={active ? "success" : "neutral"}>{active ? t("Active") : t("Inactive")}</Badge>;
}

/** Trades already in use (crews, workers and priced labour), for the trade field's suggestions. */
function useTrades(workspaceId: string, state: HrmsCrewState, needed: boolean) {
  const [priced, setPriced] = useState<string[]>([]);
  useEffect(() => {
    if (!needed) return;
    let live = true;
    projectApi(workspaceId).labourRates().then((rates) => { if (live) setPriced(rates.trades.map((trade) => trade.name)); }).catch(() => undefined);
    return () => { live = false; };
  }, [workspaceId, needed]);
  return useMemo(() => {
    const seen = new Map<string, string>();
    for (const name of [...state.crews.map((crew) => crew.trade), ...state.workers.map((worker) => worker.trade), ...priced])
      if (name.trim() && !seen.has(name.trim().toLocaleLowerCase())) seen.set(name.trim().toLocaleLowerCase(), name.trim());
    return [...seen.values()].sort((a, b) => a.localeCompare(b)).map((name) => ({ id: name, label: name }));
  }, [state, priced]);
}

/** A free-text trade, suggesting the ones already in use. */
function TradeField({ value, onChange, options, isReadOnly }: { value: string; onChange: (value: string) => void; options: Option[]; isReadOnly?: boolean }) {
  const t = useT();
  return <ComboboxField label={t("Trade")} isRequired isReadOnly={isReadOnly} allowsCustomValue items={options} inputValue={value} onInputChange={onChange}
    placeholder={t("e.g. Carpentry")} />;
}

function useLoaded<T>(load: () => Promise<T>, needed: boolean) {
  const [value, setValue] = useState<{ items: T } | { failed: true } | null>(null);
  useEffect(() => {
    if (!needed) return;
    let live = true;
    load().then((items) => { if (live) setValue({ items }); }).catch(() => { if (live) setValue({ failed: true }); });
    return () => { live = false; };
  }, [load, needed]);
  return value;
}

/** A crew: its name, trade, lead and subcontractor, whether it's working now, and its workers. */
function CrewSheet({ api, workspaceId, state, crew, manage, onClose, onSaved }: {
  api: HrmsApi; workspaceId: string; state: HrmsCrewState; crew: HrmsCrew | null; manage: boolean; onClose: () => void; onSaved: (state: HrmsCrewState) => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const [id] = useState(() => crew?.id ?? crypto.randomUUID());
  const initial = { name: crew?.name ?? "", trade: crew?.trade ?? "", leadMembershipId: crew?.leadMembershipId ?? null, vendorId: crew?.vendorId ?? null, active: crew?.active ?? true };
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const trades = useTrades(workspaceId, state, manage);
  const people = useLoaded(useCallback(() => api.people(), [api]), manage);
  const suppliers = useLoaded(useCallback(() => purchasingApi(workspaceId).suppliers(), [workspaceId]), manage);
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const valid = Boolean(draft.name.trim() && draft.trade.trim());
  const members = people && "items" in people ? people.items.filter((person: HrmsPerson) => person.status === "active" || person.membershipId === draft.leadMembershipId) : [];
  const leadItems: Option[] = [{ id: "none", label: t("No one") }, ...members.map((person) => ({ id: person.membershipId, label: person.name, description: person.designation || undefined })),
    ...(crew?.leadMembershipId && !members.some((person) => person.membershipId === crew.leadMembershipId) ? [{ id: crew.leadMembershipId, label: crew.leadName ?? "" }] : [])];
  const vendors = suppliers && "items" in suppliers ? suppliers.items.suppliers.filter((supplier) => supplier.status !== "archived" || supplier.id === draft.vendorId) : [];
  const vendorItems: Option[] = [{ id: "none", label: t("Our own crew") }, ...vendors.map((supplier) => ({ id: supplier.id, label: supplier.name })),
    ...(crew?.vendorId && !vendors.some((supplier) => supplier.id === crew.vendorId) ? [{ id: crew.vendorId, label: crew.vendorName ?? "" }] : [])];
  const workers = state.workers.filter((worker) => worker.crewId === crew?.id);
  const save = async () => {
    setBusy(true); setError("");
    try {
      onSaved(await api.saveCrew({ id, version: crew?.version ?? 0, name: draft.name.trim(), trade: draft.trade.trim(), leadMembershipId: draft.leadMembershipId,
        vendorId: draft.vendorId, active: draft.active }));
    } catch (cause) { setError(format.failure(cause, t("Could not save."))); setBusy(false); }
  };
  return <InspectorSheet isOpen size="md" title={crew ? crew.name : t("New crew")} description={crew ? crew.trade : undefined} isDirty={manage && dirty && !busy}
    onOpenChange={(value) => { if (!value) onClose(); }}
    footer={manage ? <div className="wd-dialog-actions"><span className={styles.spacer} />
      <Button variant="primary" isLoading={busy} isDisabled={!dirty || !valid} onPress={() => void save()}>{t("Save")}</Button></div> : null}>
    <div className={styles.sheet}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {manage ? <>
        <TextInput label={t("Name")} isRequired value={draft.name} onChange={(value) => set("name", value)} maxLength={120} />
        <TradeField value={draft.trade} onChange={(value) => set("trade", value)} options={trades} />
        <SelectField label={t("Lead")} isDisabled={!people} selectedKey={draft.leadMembershipId ?? "none"} items={leadItems}
          onSelectionChange={(key) => set("leadMembershipId", key && key !== "none" ? String(key) : null)} />
        <SelectField label={t("Subcontractor")} isDisabled={!suppliers || "failed" in suppliers} selectedKey={draft.vendorId ?? "none"} items={vendorItems}
          onSelectionChange={(key) => set("vendorId", key && key !== "none" ? String(key) : null)} />
        <Switch isSelected={draft.active} onChange={(value) => set("active", value)}>{t("Active")}</Switch>
      </> : <Facts items={[
        [t("Trade"), crew?.trade],
        [t("Lead"), crew?.leadName ?? t("No one")],
        [t("Subcontractor"), crew?.vendorName ?? t("Our own crew")],
        [t("Active"), crew?.active ? t("Yes") : t("No")],
      ]} />}
      {crew ? <section className={styles.part} aria-label={t("Workers")}>
        <h3 className={styles.subhead}>{t("Workers")}</h3>
        {workers.length ? <ul className={styles.list}>{workers.map((worker) => <li key={worker.id}>
          <span className={styles.grow}><span>{worker.name}</span><small>{[worker.workerCode, worker.trade].filter(Boolean).join(" · ")}</small></span>
          {worker.active ? null : <Badge tone="neutral">{t("Inactive")}</Badge>}
        </li>)}</ul> : <p className={styles.muted}>{t("No workers in this crew")}</p>}
      </section> : null}
    </div>
  </InspectorSheet>;
}

/** A worker: name, trade, crew, code and phone, and their own day rate when it isn't their trade's. */
function WorkerSheet({ api, workspaceId, state, worker, manage, onClose, onSaved, onOpenDocument }: {
  api: HrmsApi; workspaceId: string; state: HrmsCrewState; worker: HrmsWorker | null; manage: boolean; onClose: () => void; onSaved: (state: HrmsCrewState) => void;
  onOpenDocument?: (id: string) => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const { locale, currency: home } = useDesignSystem();
  const country = phoneCountry(null, locale) ?? "";
  const phone = splitPhone(worker?.phone ?? "", country);
  const [id] = useState(() => worker?.id ?? crypto.randomUUID());
  const initial = {
    name: worker?.name ?? "", trade: worker?.trade ?? "", crewId: worker?.crewId ?? null, workerCode: worker?.workerCode ?? "", phoneCountry: phone.country, phone: phone.national,
    dayRate: worker?.dayRate ? worker.dayRate.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : "", currency: worker?.currency ?? home, active: worker?.active ?? true,
  };
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const trades = useTrades(workspaceId, state, manage);
  const currencies = useMemo(() => currencyOptions(locale), [locale]);
  const set = <K extends keyof typeof draft>(key: K) => (value: (typeof draft)[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const badRate = Boolean(draft.dayRate) && !RATE.test(draft.dayRate);
  const valid = Boolean(draft.name.trim() && draft.trade.trim()) && !badRate && (!draft.dayRate || Boolean(draft.currency));
  const crews: Option[] = [{ id: "none", label: t("No crew") }, ...state.crews.filter((crew) => crew.active || crew.id === draft.crewId).map((crew) => ({ id: crew.id, label: crew.name, description: crew.trade }))];
  const save = async () => {
    setBusy(true); setError("");
    try {
      onSaved(await api.saveWorker({ id, version: worker?.version ?? 0, name: draft.name.trim(), trade: draft.trade.trim(), crewId: draft.crewId, workerCode: draft.workerCode.trim(),
        phone: draft.phone.trim() ? joinPhone(draft.phoneCountry, draft.phone) : "", dayRate: draft.dayRate || null, currency: draft.dayRate ? draft.currency : null, active: draft.active }));
    } catch (cause) { setError(format.failure(cause, t("Could not save."))); setBusy(false); }
  };
  const crewName = state.crews.find((crew) => crew.id === worker?.crewId)?.name;
  return <InspectorSheet isOpen size="md" title={worker ? worker.name : t("New worker")} description={worker ? [worker.workerCode, worker.trade].filter(Boolean).join(" · ") : undefined}
    isDirty={manage && dirty && !busy} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={manage ? <div className="wd-dialog-actions"><span className={styles.spacer} />
      <Button variant="primary" isLoading={busy} isDisabled={!dirty || !valid} onPress={() => void save()}>{t("Save")}</Button></div> : null}>
    <div className={styles.sheet}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {manage ? <>
        <TextInput label={t("Name")} isRequired value={draft.name} onChange={set("name")} maxLength={120} />
        <div className={styles.pair}>
          <TradeField value={draft.trade} onChange={set("trade")} options={trades} />
          <SelectField label={t("Crew")} selectedKey={draft.crewId ?? "none"} items={crews} onSelectionChange={(key) => set("crewId")(key && key !== "none" ? String(key) : null)} />
        </div>
        <div className={styles.pair}>
          <TextInput label={t("Worker code")} value={draft.workerCode} onChange={set("workerCode")} maxLength={40} />
          <PhoneField label={t("Phone")} kind="any" locale={locale} value={draft.phone} onChange={set("phone")} countryCode={draft.phoneCountry} onCountryChange={set("phoneCountry")} />
        </div>
        <div className={styles.pair}>
          <TextInput label={t("Day rate")} inputMode="decimal" suffix={draft.dayRate ? draft.currency : undefined} placeholder={t("Trade rate")} value={draft.dayRate}
            onChange={(value) => set("dayRate")(decimal(value))} isInvalid={badRate} errorMessage={badRate ? t("Up to four decimal places.") : undefined} />
          <SelectField label={t("Currency")} isRequired={Boolean(draft.dayRate)} isDisabled={!draft.dayRate} selectedKey={draft.currency || null} items={currencies}
            onSelectionChange={(key) => set("currency")(key ? String(key) : "")} />
        </div>
        <Switch isSelected={draft.active} onChange={set("active")}>{t("Active")}</Switch>
      </> : <Facts items={[
        [t("Trade"), worker?.trade],
        [t("Crew"), crewName ?? t("No crew")],
        worker?.workerCode ? [t("Worker code"), worker.workerCode] : null,
        worker?.phone ? [t("Phone"), <span key="phone" dir="ltr">{worker.phone}</span>] : null,
        [t("Active"), worker?.active ? t("Yes") : t("No")],
      ]} />}
      {worker && manage && onOpenDocument ? <PersonDocuments api={api} workerId={worker.id} onOpen={onOpenDocument} /> : null}
    </div>
  </InspectorSheet>;
}

