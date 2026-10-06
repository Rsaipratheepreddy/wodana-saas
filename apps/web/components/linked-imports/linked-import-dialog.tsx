"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Link2, RefreshCw } from "lucide-react";
import { Badge, Button, Callout, Checkbox, ControlledModalDialog, EmptyState, FileUploader, MenuButton, SelectField, Spinner, Switch, TextInput, formatRelativeTime, useConfirmationDialog, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { linkedImportsApi, type ColumnMapping, type ImportDetail, type ImportLink, type ImportOverview, type ImportPreview, type ImportRun, type ImportSchedule, type ImportSource,
  type ImportTarget, type PickerConfig, type PlanRow } from "@/lib/linked-imports/client";
import { pickSpreadsheet } from "@/lib/linked-imports/google-picker";
import { readImportFile, readImportImage, rowImage } from "@/lib/linked-imports/import-file";
import { IMPORT_FIELDS, chosenTabs, hasKey, headingsOf, mappedColumns, suggestMapping } from "@/lib/linked-imports/mapping";
import type { WorkbookSheet } from "@/lib/linked-imports/xlsx-workbook";
import styles from "./linked-import-dialog.module.css";

type T = ReturnType<typeof useT>;
type View = "links" | "source" | "map" | "preview";
type Draft = {
  linkId: string | null; version: number | null; source: ImportSource; connectionId: string | null; spreadsheetId: string | null;
  sheets: WorkbookSheet[]; sheetName: string | null; mapping: ColumnMapping; name: string; locationId: string | null; setsStock: boolean; itemType: string; schedule: ImportSchedule;
  /** The uploaded workbook, kept to add its pictures to the catalog items it made. */
  file: File | null;
  /** Suppliers: the company the list is for, when it's one company's list. */
  legalEntityId: string | null;
  /** Catalog: the sheet's prices are approved list prices. */
  approvedPrices: boolean;
};
const ITEM_TYPES = ["product", "ready_made", "material", "assembly", "service", "package"] as const;
const outcomeTone: Record<string, "success" | "info" | "danger" | "warning" | "neutral"> = { added: "success", changed: "info", error: "danger", missing: "warning", unchanged: "neutral" };

/** An existing link's settings, kept when its sheet is mapped or uploaded again. */
const fromLink = (link: ImportLink): Partial<Draft> => ({ linkId: link.id, version: link.version, mapping: link.mapping, sheetName: link.sheetName, name: link.name,
  setsStock: link.setsStock, locationId: link.locationId, itemType: link.itemType ?? "product", schedule: link.schedule, legalEntityId: link.legalEntityId ?? null,
  approvedPrices: link.approvedPrices === true });

function outcomeLabel(t: T, outcome: string) {
  return ({ added: t("New"), changed: t("Changed"), unchanged: t("Unchanged"), error: t("Needs a fix"), missing: t("Not in sheet") } as Record<string, string>)[outcome] ?? outcome;
}
function itemTypeLabel(t: T, type: string) {
  return ({ product: t("Product"), material: t("Material"), assembly: t("Assembly"), service: t("Service"), package: t("Package"), ready_made: t("Ready-made") } as Record<string, string>)[type] ?? type;
}
function scheduleLabel(t: T, schedule: ImportSchedule) {
  return ({ off: t("Only when refreshed"), hourly: t("Every hour"), daily: t("Every day") } as Record<ImportSchedule, string>)[schedule];
}

/**
 * Import a stock list, a product list or a supplier list from a spreadsheet: choose the source (a file, or a Google Sheet
 * linked once), map its columns, preview every row, then apply. A linked sheet then shows its last refresh,
 * what it did, the rows that need a fix, its schedule and (for stock) whether it sets quantities.
 */
export function LinkedImportDialog({ workspaceId, target, catalogId, isOpen, onClose, onImported, openLinkId = null }: {
  workspaceId: string; target: ImportTarget; catalogId?: string; isOpen: boolean; onClose: () => void; onImported: () => void; openLinkId?: string | null;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  const api = useMemo(() => linkedImportsApi(workspaceId), [workspaceId]);
  const [overview, setOverview] = useState<ImportOverview | null>(null);
  const [picker, setPicker] = useState<PickerConfig | null>(null);
  const [view, setView] = useState<View>("links");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [details, setDetails] = useState<Record<string, ImportDetail>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pictures, setPictures] = useState<{ done: number; total: number } | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();

  const load = useCallback(async () => {
    try {
      const [next, config] = await Promise.all([api.overview(target, catalogId), api.pickerConfig().catch(() => ({ configured: false, apiKey: "", appId: "" }))]);
      setOverview(next); setPicker(config); setError("");
      setConnectionId((current) => current ?? next.connections.find((connection) => connection.driveFile)?.id ?? next.connections[0]?.id ?? null);
      return next;
    } catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("Imports didn't load.")); return null; }
  }, [api, target, catalogId, t]);
  /** Shows a link's rows from its last run (read once). */
  const expand = useCallback(async (linkId: string | null) => {
    setExpanded(linkId);
    if (!linkId) return;
    try { const detail = await api.detail(linkId); setDetails((current) => ({ ...current, [linkId]: detail })); }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("Could not import.")); }
  }, [api, t]);
  useEffect(() => {
    if (!isOpen) return;
    queueMicrotask(() => void load().then((next) => {
      setView(next && !next.links.length ? "source" : "links");
      // A notice about a link's refresh opens on that link.
      if (openLinkId && next?.links.some((link) => link.id === openLinkId)) void expand(openLinkId);
    }));
  }, [isOpen, load, openLinkId, expand]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); } catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("Could not import.")); }
    finally { setBusy(false); }
  };
  const close = () => { setView("links"); setDraft(null); setPreview(null); setError(""); setExpanded(null); onClose(); };

  const newDraft = (source: ImportSource, sheets: WorkbookSheet[], name: string, link: Partial<Draft> = {}): Draft => {
    // Several tabs: the ones the sheet shows are chosen; a hidden tab (a template) isn't.
    const tabs = sheets.length > 1 ? sheets.filter((sheet) => !sheet.hidden).map((sheet) => sheet.name) : undefined;
    const shown = tabs ? sheets.filter((sheet) => tabs.includes(sheet.name)) : sheets;
    return {
      linkId: null, version: null, source, connectionId: null, spreadsheetId: null, sheets, sheetName: null, name: name.slice(0, 200), file: null,
      mapping: { ...suggestMapping(target, headingsOf(shown).map((entry) => entry.heading)), ...(tabs?.length ? { tabs } : {}) },
      locationId: overview?.locations.find((place) => place.isDefault)?.id ?? overview?.locations[0]?.id ?? null,
      setsStock: true, itemType: "product", schedule: source === "google_sheet" ? "hourly" : "off", legalEntityId: null, approvedPrices: false, ...link,
    };
  };
  const chooseFile = (file: File | undefined, link?: ImportLink) => file && run(async () => {
    const sheets = await readImportFile(file);
    if (link) {
      // A new version of an uploaded sheet goes through the link's own mapping, straight to the preview.
      const next = { ...newDraft("upload", sheets, link.name), ...fromLink(link), file };
      setDraft(next); await review(next);
      return;
    }
    setDraft({ ...newDraft("upload", sheets, file.name.replace(/\.[^.]+$/, "")), file }); setView("map");
  });
  const chooseSheet = (link?: ImportLink) => run(async () => {
    const connection = link?.connectionId ?? connectionId;
    if (!picker?.configured || !connection) return;
    let spreadsheetId = link?.spreadsheetId ?? null, title = link?.name ?? "";
    if (!link) {
      const token = await api.pickerToken(connection);
      setPicking(true);
      const picked = await pickSpreadsheet({ token: token.accessToken, apiKey: picker.apiKey, appId: picker.appId, locale, title: t("Choose the sheet to link") }).finally(() => setPicking(false));
      if (!picked) return;
      spreadsheetId = picked.id; title = picked.name;
    }
    const read = await api.source({ target, connectionId: connection, spreadsheetId: spreadsheetId! });
    const base = newDraft("google_sheet", read.sheets, title || read.title, { connectionId: connection, spreadsheetId });
    setDraft(link ? { ...base, ...fromLink(link) } : base);
    setView("map");
  });

  const body = (next: Draft) => ({
    ...(next.linkId ? { linkId: next.linkId, version: next.version } : { target, source: next.source, catalogId, connectionId: next.connectionId, spreadsheetId: next.spreadsheetId }),
    name: next.name.trim(), mapping: next.mapping, sheetName: next.sheetName, schedule: next.schedule,
    ...(target === "stock" ? { locationId: next.locationId, setsStock: next.setsStock } : target === "suppliers" ? { legalEntityId: next.legalEntityId }
      : { itemType: next.itemType, approvedPrices: next.approvedPrices }),
    // An uploaded file is sent trimmed to its chosen tabs and mapped columns (pictures stay in the browser); a linked sheet is read by Wodana.
    ...(next.source === "upload" ? { sheets: mappedColumns(next.sheetName ? next.sheets.filter((sheet) => sheet.name === next.sheetName) : next.sheets, next.mapping) } : {}),
  });
  const review = async (next: Draft) => { setPreview(await api.preview(body(next))); setView("preview"); };
  /**
   * After a catalog import from an Excel file: each row's picture goes to its item, for items that have no picture
   * yet (one at a time, through the catalog's own upload). A linked Google Sheet's pictures can't be read.
   */
  const addPictures = async (detail: ImportDetail, next: Draft) => {
    if (target !== "catalog" || !next.file || !detail.records?.length) return 0;
    const wanted = new Map<string, ReturnType<typeof rowImage>>();
    for (const record of detail.records) {
      if (record.images || wanted.has(record.recordId)) continue;
      const image = rowImage(next.sheets, record.sheet, record.line);
      if (image) wanted.set(record.recordId, image);
    }
    let failed = 0, done = 0;
    setPictures({ done, total: wanted.size });
    for (const [itemId, image] of wanted) {
      try {
        const form = new FormData();
        form.set("file", await readImportImage(next.file, image!));
        const response = await fetch(`/api/catalog-images/items/${itemId}/${crypto.randomUUID()}?${new URLSearchParams({ workspaceId })}`, { method: "POST", body: form });
        if (!response.ok) failed += 1;
      } catch { failed += 1; }
      setPictures({ done: ++done, total: wanted.size });
    }
    setPictures(null);
    return failed;
  };
  const apply = () => draft && preview && run(async () => {
    const detail = await api.apply({ ...body(draft), runId: crypto.randomUUID(), expectedFingerprint: preview.fingerprint });
    setDetails((current) => ({ ...current, [detail.link.id]: detail })); setExpanded(detail.link.id);
    const failed = await addPictures(detail, draft);
    setDraft(null); setPreview(null); await load(); setView("links"); onImported();
    if (failed) setError(t("{count} pictures couldn't be added to their items.", { count: failed }));
  });
  const refresh = (link: ImportLink) => run(async () => {
    const detail = await api.refresh(link.id, { runId: crypto.randomUUID() });
    setDetails((current) => ({ ...current, [link.id]: detail })); setExpanded(link.id); await load(); onImported();
  });
  const change = (link: ImportLink, input: Record<string, unknown>) => run(async () => {
    const result = await api.settings(link.id, { version: link.version, ...input });
    if ("link" in result) setDetails((current) => ({ ...current, [link.id]: result }));
    await load();
  });
  const stop = (link: ImportLink) => requestConfirmation({ title: t("Stop linking {name}?", { name: link.name }), body: t("Nothing imported is removed. The sheet stops refreshing."),
    confirmLabel: t("Stop linking"), onConfirm: () => void change(link, { archive: true }) });

  const set = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const canReview = Boolean(draft && draft.name.trim() && hasKey(draft.mapping) && (draft.mapping.tabs?.length ?? 1) > 0 && (target !== "stock" || draft.locationId));
  const googleReady = Boolean(picker?.configured && overview?.connections.length);
  const connection = overview?.connections.find((entry) => entry.id === connectionId);
  const footer = <div className="wd-dialog-actions">
    {view === "links" ? <>
      <Button onPress={close}>{t("Close")}</Button>
      {overview?.canManage ? <Button onPress={() => setView("source")} variant="primary">{t("Import another sheet")}</Button> : null}
    </> : view === "source" ? <Button onPress={() => (overview?.links.length ? setView("links") : close())}>{overview?.links.length ? t("Back") : t("Cancel")}</Button>
    : view === "map" ? <>
      <Button onPress={() => setView(draft?.linkId ? "links" : "source")}>{t("Back")}</Button>
      <Button isDisabled={!canReview} isLoading={busy} onPress={() => draft && void run(() => review(draft))} variant="primary">{t("Review")}</Button>
    </> : <>
      <Button onPress={() => setView(draft?.source === "upload" && draft.linkId ? "links" : "map")}>{t("Back")}</Button>
      <Button isDisabled={!preview} isLoading={busy} onPress={() => void apply()} variant="primary">{t("Import")}</Button>
    </>}
  </div>;

  return <>
    <ControlledModalDialog footer={footer} isDirty={view === "map" || view === "preview"} isOpen={isOpen && !picking} onOpenChange={(open) => { if (!open) close(); }} size="lg" title={t("Import")}>
      <div className={styles.body}>
        {error ? <Callout title={t("Could not import")} tone="danger">{error}</Callout> : null}
        {pictures ? <p className={styles.muted} role="status">{t("Adding pictures {done} of {total}", { done: pictures.done, total: pictures.total })}</p> : null}
        {!overview ? (error ? null : <div className={styles.loading}><Spinner /></div>)
          : view === "links" ? <ul className={styles.links} aria-label={t("Linked sheets")}>{overview.links.map((link) => <LinkCard key={link.id} link={link} detail={details[link.id]} t={t}
              canManage={overview.canManage} target={target} busy={busy} locale={locale} isExpanded={expanded === link.id} googleReady={googleReady}
              onExpand={() => void expand(expanded === link.id ? null : link.id)} onRefresh={() => void refresh(link)} onUpload={(file) => void chooseFile(file, link)}
              onColumns={() => void chooseSheet(link)} onChange={(input) => void change(link, input)} onStop={() => stop(link)} />)}</ul>
          : view === "source" ? <div className={styles.sources}>
              <section aria-label={t("Upload a file")}>
                <FileUploader accept=".xlsx,.csv,.tsv" label={t("Upload a spreadsheet")} multiple={false} onFiles={(files) => void chooseFile(files[0])} />
                <small className={styles.muted}>{t("Excel (.xlsx) up to 512 MB, or CSV up to 2 MB.")}</small>
              </section>
              {googleReady ? <section aria-label={t("Link a Google Sheet")} className={styles.google}>
                {overview.connections.length > 1 ? <SelectField items={overview.connections.map((entry) => ({ id: entry.id, label: entry.account ? `${entry.name} · ${entry.account}` : entry.name }))}
                  label={t("Google account")} onSelectionChange={(key) => setConnectionId(String(key))} selectedKey={connectionId} /> : null}
                <Button isDisabled={!connection?.driveFile} isLoading={busy} onPress={() => void chooseSheet()}><Link2 aria-hidden="true" size={15} />{t("Link a Google Sheet")}</Button>
                <small className={styles.muted}>{connection?.driveFile ? t("Wodana reads only the sheet you pick, and refreshes it on a schedule.")
                  : t("Turn on Drive files for the Google connection in Connections first.")}</small>
              </section> : null}
            </div>
          : view === "map" && draft ? <MapStep draft={draft} overview={overview} set={set} t={t} target={target} />
          : view === "preview" && preview ? <PreviewStep preview={preview} t={t} />
          : <EmptyState title={t("Nothing to import yet")} />}
      </div>
    </ControlledModalDialog>
    {confirmationDialog}
  </>;
}

function MapStep({ draft, overview, set, t, target }: { draft: Draft; overview: ImportOverview; set: (patch: Partial<Draft>) => void; t: T; target: ImportTarget }) {
  const sheets = draft.sheetName ? draft.sheets.filter((sheet) => sheet.name === draft.sheetName) : chosenTabs(draft.sheets, draft.mapping);
  const headings = headingsOf(sheets.length ? sheets : draft.sheets);
  const tabs = draft.mapping.tabs ?? draft.sheets.map((sheet) => sheet.name);
  const entities = overview.entities ?? [];
  const perTab = target === "suppliers" && entities.length > 1 && draft.sheets.length > 1;
  // Ticking tabs replaces a linked sheet's single tab: every chosen tab is read.
  const tick = (name: string, on: boolean) => {
    const current = draft.sheetName ? [draft.sheetName] : tabs;
    const next = draft.sheets.map((sheet) => sheet.name).filter((tab) => (tab === name ? on : current.includes(tab)));
    set({ sheetName: null, mapping: { ...draft.mapping, tabs: next } });
  };
  const company = (name: string, entityId: string) => {
    const chosen = Object.fromEntries(Object.entries(draft.mapping.entities ?? {}).filter(([tab]) => tab !== name));
    if (entityId) chosen[name] = entityId;
    set({ mapping: { ...draft.mapping, entities: chosen } });
  };
  const fields = [{ id: "", label: t("Don't import") }, ...IMPORT_FIELDS[target].map((field) => ({ id: field.id, label: t(field.label) }))];
  const choose = (heading: string, field: string) => {
    // A field comes from one column, except across tabs that spell its heading differently (chosen again for each).
    const columns = Object.fromEntries(Object.entries(draft.mapping.columns).filter(([key]) => key !== heading));
    if (field) columns[heading] = field;
    set({ mapping: { ...draft.mapping, columns } });
  };
  return <div className={styles.map}>
    <div className={styles.settings}>
      <TextInput isRequired label={t("Name")} maxLength={200} onChange={(name) => set({ name })} value={draft.name} />

      {target === "stock" ? <SelectField isRequired items={overview.locations.map((place) => ({ id: place.id, label: place.name }))} label={t("Place")}
        description={t("Where the quantities are, unless a row names its place.")} onSelectionChange={(key) => set({ locationId: String(key) })} selectedKey={draft.locationId} /> : null}
      {target === "catalog" ? <SelectField items={ITEM_TYPES.map((type) => ({ id: type, label: itemTypeLabel(t, type) }))} label={t("New items are")}
        onSelectionChange={(key) => set({ itemType: String(key) })} selectedKey={draft.itemType} /> : null}
      {target === "suppliers" && entities.length > 1 && !perTab ? <SelectField items={[{ id: "", label: t("Every company") }, ...overview.entities!.map((entity) => ({ id: entity.id, label: entity.name }))]}
        label={t("Company")} onSelectionChange={(key) => set({ legalEntityId: String(key ?? "") || null })} selectedKey={draft.legalEntityId ?? ""} /> : null}
      {draft.source === "google_sheet" ? <SelectField items={(["hourly", "daily", "off"] as ImportSchedule[]).map((id) => ({ id, label: scheduleLabel(t, id) }))} label={t("Refresh")}
        onSelectionChange={(key) => set({ schedule: String(key) as ImportSchedule })} selectedKey={draft.schedule} /> : null}
      {target === "stock" ? <Switch isSelected={draft.setsStock} onChange={(setsStock) => set({ setsStock })}>{t("Sheet sets stock quantities")}</Switch> : null}
      {target === "catalog" ? <div className={styles.option}>
        <Checkbox isDisabled={!overview.canApprovePrices} isSelected={draft.approvedPrices} onChange={(approvedPrices) => set({ approvedPrices })}>{t("Prices are approved list prices")}</Checkbox>
        {overview.canApprovePrices ? null : <small className={styles.muted}>{t("Only someone who approves prices can turn this on.")}</small>}
      </div> : null}
      {target === "suppliers" ? <Switch isSelected={draft.mapping.fillOnly === true} onChange={(fillOnly) => set({ mapping: { ...draft.mapping, fillOnly } })}>
        {t("Only fill in what known suppliers are missing")}</Switch> : null}
    </div>
    {draft.sheets.length > 1 ? <ul className={styles.tabs} aria-label={t("Tabs")}>{draft.sheets.map((sheet) => {
      const on = draft.sheetName ? sheet.name === draft.sheetName : tabs.includes(sheet.name);
      return <li key={sheet.name}>
        <Checkbox isSelected={on} onChange={(value) => tick(sheet.name, value)}><bdi>{sheet.name}</bdi></Checkbox>
        {perTab && on ? <SelectField aria-label={t("Company for {tab}", { tab: sheet.name })} accent="neutral" label=""
          items={[{ id: "", label: draft.legalEntityId ? t("The import's company") : t("Every company") }, ...entities.map((entity) => ({ id: entity.id, label: entity.name }))]}
          onSelectionChange={(key) => company(sheet.name, String(key ?? ""))} selectedKey={draft.mapping.entities?.[sheet.name] ?? ""} /> : null}
      </li>;
    })}</ul> : null}
    {headings.length ? <ul className={styles.columns} aria-label={t("Columns")}>{headings.map(({ heading, sample }) => {
      const field = draft.mapping.columns[heading] ?? "";
      return <li key={heading}>
        <span className={styles.heading}><strong>{heading}</strong>{sample ? <small dir="auto">{sample}</small> : null}</span>
        <SelectField aria-label={t("Field for {column}", { column: heading })} accent="neutral" items={fields}
          label="" onSelectionChange={(key) => choose(heading, String(key ?? ""))} selectedKey={field} />
      </li>;
    })}</ul> : <EmptyState title={t("No columns found")} description={t("The sheet has no heading row.")} />}
    {!hasKey(draft.mapping) && headings.length ? <small className={styles.danger}>{target === "suppliers" ? t("Choose the column with the supplier's code or name: rows are matched by it.")
      : t("Choose the column with the item code or name: rows are matched by it.")}</small> : null}
  </div>;
}

function PreviewStep({ preview, t }: { preview: ImportPreview; t: T }) {
  const { summary } = preview;
  return <>
    <div className={styles.summary} role="status">
      <span><strong>{summary.added}</strong> {t("new")}</span>
      <span><strong>{summary.changed}</strong> {t("changed")}</span>
      <span><strong>{summary.unchanged}</strong> {t("unchanged")}</span>
      <span data-tone={summary.errors ? "danger" : undefined}><strong>{summary.errors}</strong> {t("need a fix")}</span>
      <span><strong>{summary.missing}</strong> {t("not in sheet")}</span>
    </div>
    {preview.prices?.refused ? <Callout tone="warning" title={t("You can't approve prices")}>{t("This import drafts them for review.")}</Callout> : null}
    {preview.skippedTabs.length ? <small className={styles.muted}>{t("Tabs without the mapped columns are skipped: {tabs}", { tabs: preview.skippedTabs.join(", ") })}</small> : null}
    <Rows rows={preview.rows} t={t} empty={t("Nothing changes.")} />
  </>;
}

function Rows({ rows, t, empty }: { rows: PlanRow[]; t: T; empty: string }) {
  if (!rows.length) return <p className={styles.muted}>{empty}</p>;
  return <ul className={styles.rows} aria-label={t("Rows")}>{rows.map((row, index) => <li data-outcome={row.outcome} key={`${row.sheet}-${row.line}-${row.key}-${index}`}>
    <Badge tone={outcomeTone[row.outcome]}>{outcomeLabel(t, row.outcome)}</Badge>
    <span className={styles.rowText}>
      <strong>{row.name || row.key}</strong>
      <small><bdi dir="ltr">{[row.key, row.line ? `${row.sheet} · ${row.line}` : ""].filter(Boolean).join(" · ")}</bdi></small>
      {row.message || row.changes?.length ? <span>{[row.message, ...(row.changes ?? [])].filter(Boolean).join(" · ")}</span> : null}
    </span>
  </li>)}</ul>;
}

function LinkCard({ link, detail, t, canManage, target, busy, locale, isExpanded, googleReady, onExpand, onRefresh, onUpload, onColumns, onChange, onStop }: {
  link: ImportLink; detail?: ImportDetail; t: T; canManage: boolean; target: ImportTarget; busy: boolean; locale: string; isExpanded: boolean; googleReady: boolean;
  onExpand: () => void; onRefresh: () => void; onUpload: (file: File | undefined) => void; onColumns: () => void; onChange: (input: Record<string, unknown>) => void; onStop: () => void;
}) {
  const last: ImportRun | null | undefined = detail?.runs[0] ?? link.lastRun;
  const google = link.source === "google_sheet";
  const status = !last ? null : last.status === "failed" ? <Badge tone="danger">{t("Failed")}</Badge> : last.errors ? <Badge tone="warning">{t("Some rows need a fix")}</Badge> : <Badge tone="success">{t("Up to date")}</Badge>;
  return <li className={styles.link}>
    <header>
      <FileSpreadsheet aria-hidden="true" size={16} />
      <strong>{link.name}</strong>
      <Badge tone="neutral">{google ? t("Google Sheet") : t("Uploaded file")}</Badge>
      {status}
    </header>
    {last ? <p className={styles.muted}>{t("Last import {time}", { time: formatRelativeTime(last.at, { locale }) })}{last.trigger === "manual" && last.byName ? ` · ${last.byName}` : ""}
      {google ? ` · ${scheduleLabel(t, link.schedule)}` : ""}</p> : null}
    {last?.status === "failed" ? <p className={styles.danger}>{last.message}</p> : last ? <p className={styles.counts}>
      {t("{added} new · {changed} changed · {unchanged} unchanged · {errors} need a fix · {missing} not in sheet", { added: last.added, changed: last.changed, unchanged: last.unchanged, errors: last.errors, missing: last.missing })}</p> : null}
    {canManage ? <div className={styles.controls}>
      {google ? <SelectField accent="neutral" items={(["hourly", "daily", "off"] as ImportSchedule[]).map((id) => ({ id, label: scheduleLabel(t, id) }))} label={t("Refresh")}
        onSelectionChange={(key) => { if (String(key) !== link.schedule) onChange({ schedule: String(key) }); }} selectedKey={link.schedule} /> : null}
      {target === "stock" ? <Switch isSelected={link.setsStock} onChange={(setsStock) => onChange({ setsStock })}>{t("Sheet sets stock quantities")}</Switch> : null}
    </div> : null}
    <div className={styles.actions}>
      {canManage && google ? <Button isLoading={busy} onPress={onRefresh} size="compact"><RefreshCw aria-hidden="true" size={14} />{t("Refresh now")}</Button> : null}
      {canManage && !google ? <FileUploader accept=".xlsx,.csv,.tsv" appearance="button" label={t("Upload a new version")} multiple={false} onFiles={(files) => onUpload(files[0])} /> : null}
      <Button onPress={onExpand} size="compact" variant="quiet">{isExpanded ? t("Hide rows") : t("Show rows")}</Button>
      {canManage ? <MenuButton size="compact" label={t("More")} onAction={(id) => (id === "columns" ? onColumns() : onStop())}
        items={[...(google && googleReady ? [{ id: "columns", label: t("Change columns") }] : []), { id: "stop", label: t("Stop linking") }]} /> : null}
    </div>
    {isExpanded ? (detail ? <Rows rows={detail.rows} t={t} empty={t("Nothing changed in the last import.")} /> : <Spinner />) : null}
  </li>;
}
