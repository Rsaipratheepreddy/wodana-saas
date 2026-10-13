"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { parseDate } from "@internationalized/date";
import {
  Badge, Button, ComboboxField, DateField, EmptyState, ErrorState, FormDialog, FormRow, FormSection, InlineNotice, MoneyField, NumericInput, RecordTable, SegmentedControl,
  SelectField, Skeleton, TextAreaField, TextInput, useDesignSystem, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { caseRequest, type CaseAsset, type CaseRoom } from "@/lib/pre-project/content";
import {
  clientStatus, CONFIRMATION_METHODS, LEDGER_SOURCES, LEDGER_STATE_LABEL, ledgerStateTone, lineTotal, METHOD_LABEL, signedAmount, SOURCE_LABEL,
  type LedgerEntry, type LedgerVersion, type LedgerView,
} from "@/lib/pre-project/design-decisions";
import { FitCheckBadge, fitNeedsWarning, useItemFits } from "@/components/catalog/fit-check-panel";
import { libraryApi, MATERIAL_ORIGINS, ORIGIN_LABEL, scheduleApi, type FinishCategory, type MaterialOrigin, type SampleChoice } from "@/lib/pre-project/finishes";
import type { ItemFit } from "@/lib/workspace/product-sourcing";
import { AssetUpload, CaseModal } from "./case-controls";
import styles from "./design-decisions.module.css";

type Draft = {
  kind: "material" | "design"; roomId: string | null; catalogItemId: string | null; title: string; specification: string; supplier: string; quantity: string; unit: string; unitPrice: string;
  timeImpactDays: number; source: string; saidOn: string; evidence: CaseAsset | null; evidenceNote: string; note: string;
  /** PLM-144/157: own stock, a brand, or a local supplier (the outsourced one, which needs the reviewer's sign-off). */
  origin: MaterialOrigin | null;
  /** PLM-157: the library sample it was chosen from, and the photo of the sample. */
  sampleId: string | null; sampleName: string; samplePhoto: CaseAsset | null;
  /** PLM-156: its finish category and where it goes (on a new material). */
  categoryKey: string | null; location: string;
};
/** A catalog item a choice can be tied to (the quotation's catalog search), with its preferred supplier. */
type CatalogChoice = { id: string; code: string; name: string; categoryName: string | null; description: string | null; unitCode: string; supplier: string | null };
type Dialog = { kind: "add" } | { kind: "version"; entry: LedgerEntry } | { kind: "decision"; entry: LedgerEntry } | null;

/**
 * The materials and decisions ledger (plan §6.7a, PLM-054): every material or design choice with its versions —
 * where it came from, when, its evidence, its price and time impact, and the client's confirmation. Locked at the
 * design sign-off; a later change waits for the client and the reviewer while procurement keeps the locked version.
 */
export function DesignLedger({ workspaceId, caseId, rooms, clientName }: { workspaceId: string; caseId: string; rooms: CaseRoom[]; clientName?: string }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [view, setView] = useState<LedgerView | null>(null);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [open, setOpen] = useState<LedgerEntry | null>(null);
  const [approving, setApproving] = useState(false);
  // An empty answer is a failed load (error and Retry), never a reason to keep the skeleton up.
  const load = useCallback(() => caseRequest<LedgerView | null>(workspaceId, caseId, "design-ledger").then((next) => {
    if (!next || typeof next !== "object") throw new Error(t("The list didn't load"));
    setView(next); setFailure("");
  }).catch((error: unknown) => setFailure(error instanceof Error && error.message ? error.message : t("The list didn't load"))), [workspaceId, caseId, t]);
  useEffect(() => { void load(); }, [load]);
  // PLM-156: the firm's finish categories, for a new material.
  const [categories, setCategories] = useState<FinishCategory[]>([]);
  useEffect(() => {
    let live = true;
    libraryApi(workspaceId).settings().then((next) => { if (live) setCategories(next.settings.categories); }).catch(() => { if (live) setCategories([]); });
    return () => { live = false; };
  }, [workspaceId]);
  // E5-6: a choice tied to a catalog item shows whether it gets through the site's measured access. A warning here;
  // ordering is where a failing item is blocked.
  const fits = useItemFits(workspaceId, caseId, (view?.entries ?? []).filter((entry) => !entry.archivedAt).map((entry) => entry.current?.catalogItemId ?? ""));
  const fitOf = (entry: LedgerEntry) => (entry.current?.catalogItemId ? fits.get(entry.current.catalogItemId) : undefined);

  if (failure && !view) return <ErrorState title={t("The list didn't load")} description={failure} onRetry={() => void load()} />;
  if (!view) return <Skeleton lines={5} shape="rows" />;
  const day = (iso: string) => { try { return new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)); } catch { return iso; } };
  const saved = (message: string, next: LedgerView) => { setView((current) => ({ ...next, canEdit: current?.canEdit, canRecordClient: current?.canRecordClient, canApprove: current?.canApprove,
    canManageMaterials: current?.canManageMaterials, approval: next.approval !== undefined ? next.approval : current?.approval })); setNotice(message); setDialog(null); setOpen(null); };
  // PLM-157: the Material Coordinator keeps the materials (not the design choices) without editing the rest of the case.
  const canAdd = Boolean(view.canEdit || view.canManageMaterials);
  const canChange = (entry: LedgerEntry) => Boolean(view.canEdit || (view.canManageMaterials && entry.kind === "material"));
  const pendingApproval = view.approval?.status === "pending" ? view.approval : null;
  const live = view.entries.filter((entry) => !entry.archivedAt);
  const currency = view.currency ?? undefined;
  const money = (value: string | null) => value === null ? "" : `${value}${view.currency ? ` ${view.currency}` : ""}`;
  // Amounts and day counts stay left-to-right inside right-to-left text (isolated, never reordered).
  const impact = (version: LedgerVersion | null) => {
    if (!version) return null;
    const amount = signedAmount(version.priceImpact);
    const days = version.timeImpactDays ? t("{count} days", { count: `${version.timeImpactDays > 0 ? "+" : ""}${version.timeImpactDays}` }) : "";
    if (!amount && !days) return t("None");
    return <>{amount ? <bdi dir="ltr">{money(amount)}</bdi> : null}{amount && days ? " · " : null}{days ? <bdi>{days}</bdi> : null}</>;
  };
  const approve = async () => {
    setApproving(true); setFailure("");
    try {
      const next = await caseRequest<LedgerView>(workspaceId, caseId, "design-ledger/approve-changes", "POST",
        { lockNumber: view.lock?.number ?? 0, approvalVersion: pendingApproval?.version ?? null, commandId: crypto.randomUUID() });
      saved(next.state === "locked" ? t("Changes approved. The list is locked again.") : t("Approved. It moves to the next approver."), next);
      if (next.state !== "locked") void load();
    }
    catch (error) { setFailure(error instanceof Error ? error.message : t("Could not save.")); }
    finally { setApproving(false); }
  };

  const columns: DataGridColumn<LedgerEntry>[] = [
    { id: "choice", header: t("Choice"), accessorFn: (row) => row.title, meta: { primary: true }, cell: ({ row }: { row: { original: LedgerEntry } }) => <span className={styles.cell}>
      <span>{row.original.title}</span>
      {row.original.current?.specification || row.original.roomName ? <small>{[row.original.current?.specification, row.original.roomName].filter(Boolean).join(" · ")}</small> : null}
    </span> },
    { id: "kind", header: t("Type"), accessorFn: (row) => (row.kind === "material" ? t("Material") : t("Design")), meta: { priority: "low" } },
    ...(fits.size ? [{ id: "fit", header: t("Fit"), accessorFn: (row: LedgerEntry) => fitOf(row)?.result.status ?? "", meta: { priority: "medium" as const },
      cell: ({ row }: { row: { original: LedgerEntry } }) => { const fit = fitOf(row.original); return fitNeedsWarning(fit) ? <FitCheckBadge fit={fit!} /> : null; } }] : []),
    { id: "version", header: t("Version"), accessorFn: (row) => row.currentNumber, cell: ({ row }: { row: { original: LedgerEntry } }) => <span className={styles.inline}>
      <span>V{row.original.currentNumber}</span>
      {row.original.current?.afterLock ? <Badge tone="warning">{t("After sign-off")}</Badge> : null}
    </span> },
    // PLM-157: where a material comes from (own stock, a brand, a local supplier) and its supplier.
    { id: "from", header: t("Supplied from"), accessorFn: (row) => row.current?.origin ?? (row.current?.outsourced ? "local_supplier" : ""), meta: { priority: "medium" },
      cell: ({ row }: { row: { original: LedgerEntry } }) => { const current = row.original.current; const origin = current?.origin ?? (current?.outsourced ? "local_supplier" : null);
        return row.original.kind === "material" && (origin || current?.supplier) ? <span className={styles.cell}><span>{origin ? t(ORIGIN_LABEL[origin]) : current?.supplier}</span>
          {origin && current?.supplier ? <small>{current.supplier}</small> : null}</span> : null; } },
    { id: "source", header: t("Source"), accessorFn: (row) => row.current?.source ?? "", meta: { priority: "medium" },
      cell: ({ row }: { row: { original: LedgerEntry } }) => row.original.current ? <span className={styles.cell}><span>{t(SOURCE_LABEL[row.original.current.source] ?? row.original.current.source as never)}</span><small>{day(row.original.current.saidAt)}</small></span> : null },
    { id: "price", header: t("Price"), accessorFn: (row) => lineTotal(row.current?.quantity ?? null, row.current?.unitPrice ?? null) ?? "", meta: { align: "end", priority: "medium" },
      cell: ({ row }: { row: { original: LedgerEntry } }) => <bdi className={styles.amount} dir="ltr">{money(lineTotal(row.original.current?.quantity ?? null, row.original.current?.unitPrice ?? null))}</bdi> },
    { id: "impact", header: t("Impact"), accessorFn: (row) => row.current?.priceImpact ?? "", meta: { priority: "low" }, cell: ({ row }: { row: { original: LedgerEntry } }) => <span className={styles.amount}>{impact(row.original.current)}</span> },
    { id: "client", header: t("Client"), accessorFn: (row) => row.current?.status ?? "", cell: ({ row }: { row: { original: LedgerEntry } }) => {
      const status = clientStatus(row.original.current);
      const current = row.original.current;
      // PLM-144: a material from a local supplier counts once it is signed off.
      const signOff = current?.outsourced ? current.signOff === "approved" ? <Badge tone="success">{t("Outsourced · signed off")}</Badge>
        : current.signOff === "rejected" || current.signOff === "returned" ? <Badge tone="danger">{t("Outsourced · not approved")}</Badge> : <Badge tone="warning">{t("Outsourced · waiting for sign-off")}</Badge> : null;
      return <span className={styles.inline}><Badge tone={status.tone}>{t(status.key)}</Badge>{signOff}</span>;
    } },
    { id: "procurement", header: t("Procurement uses"), accessorFn: (row) => row.locked?.number ?? 0, meta: { priority: "low" },
      cell: ({ row }: { row: { original: LedgerEntry } }) => row.original.locked ? <span>V{row.original.locked.number}</span> : <span className={styles.muted}>{t("Not yet")}</span> },
  ];

  return <section className={styles.section} aria-label={t("Materials & decisions")}>
    <div className={styles.bar}>
      <Badge tone={ledgerStateTone(view.state)}>{t(LEDGER_STATE_LABEL[view.state])}</Badge>
      {view.lock ? <span className={styles.muted}>{t("Locked {date} by {name}", { date: day(view.lock.lockedAt), name: view.lock.lockedByName ?? "" })}</span> : null}
      <span className={styles.spacer} />
      {live.length ? <Link className={styles.link} href={`/print/material-list/${caseId}`} target="_blank"><FileText aria-hidden="true" size={14} />{t("Material list")}</Link> : null}
      {view.state === "changes_pending" && pendingApproval?.waitingFor.length ? <span className={styles.muted}>{t("Waiting for {names}", { names: pendingApproval.waitingFor.join(", ") })}</span> : null}
      {view.state === "changes_pending" && view.canApprove ? <Button size="compact" isLoading={approving} isDisabled={Boolean(view.lockProblem)} onPress={() => void approve()}>{t("Approve changes")}</Button> : null}
      {canAdd ? <Button size="compact" variant="primary" onPress={() => setDialog({ kind: "add" })}><Plus aria-hidden="true" size={14} />{view.canEdit ? t("Add choice") : t("Add material")}</Button> : null}
    </div>
    {view.state === "changes_pending" ? <InlineNotice tone="info" message={view.lockProblem ? `${t("Procurement keeps the signed-off versions until the changes are approved.")} ${view.lockProblem}` : t("Procurement keeps the signed-off versions until the changes are approved.")} /> : null}
    {notice ? <InlineNotice tone="success" message={notice} /> : null}
    {failure ? <InlineNotice tone="error" message={failure} /> : null}
    {live.length ? <RecordTable ariaLabel={t("Materials & decisions")} data={live} columns={columns} getRowId={(row) => row.id} showToolbar={false} selectable={false} rowNumbers={false} wrapText onRowAction={(row) => setOpen(row)} />
      : <EmptyState illustration="empty" title={t("No choices yet")} description={t("Record each material and design choice the client makes, with where it came from.")}
        action={canAdd ? <Button variant="primary" onPress={() => setDialog({ kind: "add" })}><Plus aria-hidden="true" size={14} />{view.canEdit ? t("Add choice") : t("Add material")}</Button> : undefined} />}

    {open ? <EntryHistory entry={open} fit={fitOf(open)} money={money} day={day} impact={impact} canEdit={canChange(open)} canRecordClient={Boolean(view.canRecordClient)} onClose={() => setOpen(null)}
      onVersion={() => setDialog({ kind: "version", entry: open })} onDecision={() => setDialog({ kind: "decision", entry: open })}
      onRemove={async () => saved(t("Removed from the list."), await caseRequest<LedgerView>(workspaceId, caseId, `design-ledger/entries/${open.id}/archive`, "POST", { entryVersion: open.version }))} /> : null}
    {dialog?.kind === "add" || dialog?.kind === "version" ? <EntryForm workspaceId={workspaceId} caseId={caseId} rooms={rooms} currency={currency} entry={dialog.kind === "version" ? dialog.entry : null}
      categories={categories} materialsOnly={!view.canEdit}
      onClose={() => setDialog(null)} onSubmit={async (draft) => {
        const material = draft.kind === "material";
        const fields = { catalogItemId: draft.catalogItemId, title: draft.title.trim(), specification: draft.specification.trim() || null, supplier: draft.supplier.trim() || null, quantity: draft.quantity || null, unit: draft.unit.trim() || null,
          unitPrice: draft.unitPrice || null, timeImpactDays: draft.timeImpactDays || 0, source: draft.source, saidAt: saidAt(draft.saidOn), evidenceAssetId: draft.evidence?.id ?? null,
          evidenceNote: draft.evidenceNote.trim() || null, note: draft.note.trim() || null, outsourced: material && draft.origin === "local_supplier",
          origin: material ? draft.origin : null, sampleId: material ? draft.sampleId : null, samplePhotoAssetId: material ? draft.samplePhoto?.id ?? null : null };
        if (dialog.kind === "add") saved(t("Choice added. It waits for the client's confirmation."), await caseRequest<LedgerView>(workspaceId, caseId, "design-ledger/entries", "POST",
          { id: crypto.randomUUID(), versionId: crypto.randomUUID(), kind: draft.kind, roomId: draft.roomId, ...fields,
            ...(material ? { categoryKey: draft.categoryKey, location: draft.location.trim() || null } : {}) }));
        else saved(t("New version recorded."), await caseRequest<LedgerView>(workspaceId, caseId, `design-ledger/entries/${dialog.entry.id}/versions`, "POST",
          { versionId: crypto.randomUUID(), entryVersion: dialog.entry.version, ...fields }));
      }} /> : null}
    {dialog?.kind === "decision" && dialog.entry.current ? <DecisionForm clientName={clientName} onClose={() => setDialog(null)} onSubmit={async (input) =>
      saved(input.decision === "confirmed" ? t("The client's confirmation is recorded.") : t("The client's decision is recorded."),
        await caseRequest<LedgerView>(workspaceId, caseId, `design-ledger/entries/${dialog.entry.id}/versions/${dialog.entry.current!.id}/decision`, "POST", input))} /> : null}
  </section>;
}

/** When the choice was made: the chosen day at the current time of day, never in the future. */
function saidAt(day: string) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  return day >= today ? now.toISOString() : `${day}T12:00:00.000Z`;
}

/** E5-2: one choice's history — every version with who, when, where from, evidence and the client's word. */
function EntryHistory({ entry, fit, money, day, impact, canEdit, canRecordClient, onClose, onVersion, onDecision, onRemove }: {
  entry: LedgerEntry; fit?: ItemFit; money: (value: string | null) => string; day: (iso: string) => string; impact: (version: LedgerVersion | null) => ReactNode; canEdit: boolean; canRecordClient: boolean;
  onClose: () => void; onVersion: () => void; onDecision: () => void; onRemove: () => Promise<unknown>;
}) {
  const t = useT();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const remove = async () => { setRemoving(true); setError(""); try { await onRemove(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); } finally { setRemoving(false); } };
  return <CaseModal title={entry.title} size="md" layout="sheet" onClose={onClose}
    footer={<div className={styles.bar}>
      {canEdit ? <Button size="compact" variant="quiet" isLoading={removing} onPress={() => void remove()}>{t("Remove")}</Button> : null}
      <span className={styles.spacer} />
      {canRecordClient && entry.current?.status === "proposed" ? <Button size="compact" onPress={onDecision}>{t("Record client's decision")}</Button> : null}
      {canEdit ? <Button size="compact" variant="primary" onPress={onVersion}>{t("New version")}</Button> : null}
    </div>}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <FitWarning fit={fit} />
    <ol className={styles.history} aria-label={t("Versions")}>{entry.versions.map((version) => {
      const status = clientStatus(version);
      return <li className={styles.version} data-current={version.number === entry.currentNumber || undefined} key={version.id}>
        <span className={styles.versionNumber}>V{version.number}</span>
        <div className={styles.stack}>
          <div className={styles.inline}><strong>{version.title}</strong><Badge tone={status.tone}>{t(status.key)}</Badge>
            {entry.locked?.id === version.id ? <Badge tone="success">{t("Signed off")}</Badge> : null}{version.afterLock ? <Badge tone="warning">{t("After sign-off")}</Badge> : null}</div>
          <dl className={styles.facts}>
            {version.specification ? <><dt>{t("Finish or specification")}</dt><dd>{version.specification}</dd></> : null}
            {version.quantity ? <><dt>{t("Quantity")}</dt><dd><bdi dir="ltr">{version.quantity}</bdi> {version.unit}</dd></> : null}
            {version.unitPrice ? <><dt>{t("Unit price")}</dt><dd className={styles.amount}><bdi dir="ltr">{money(version.unitPrice)}</bdi></dd></> : null}
            <dt>{t("Impact")}</dt><dd className={styles.amount}>{impact(version)}</dd>
            <dt>{t("Source")}</dt><dd>{t(SOURCE_LABEL[version.source] ?? version.source as never)} · {day(version.saidAt)}</dd>
            <dt>{t("Recorded by")}</dt><dd>{version.recordedByName ?? ""} · {day(version.recordedAt)}</dd>
            {version.evidenceName || version.evidenceNote ? <><dt>{t("Evidence")}</dt><dd>{[version.evidenceName, version.evidenceNote].filter(Boolean).join(" · ")}</dd></> : null}
            {version.confirmedAt ? <><dt>{version.status === "declined" ? t("Declined by") : t("Confirmed by")}</dt>
              <dd>{version.confirmedByName} · {t(METHOD_LABEL[version.confirmationMethod ?? ""] ?? version.confirmationMethod as never)} · {day(version.confirmedAt)}</dd></> : null}
            {version.note ? <><dt>{t("Note")}</dt><dd>{version.note}</dd></> : null}
          </dl>
        </div>
      </li>;
    })}</ol>
  </CaseModal>;
}

/** E5-6: a warning (never a block) when the chosen item doesn't get through the site's measured access. */
function FitWarning({ fit }: { fit?: ItemFit }) {
  const t = useT();
  if (!fit || !fitNeedsWarning(fit)) return null;
  return <div className={styles.inline}><FitCheckBadge fit={fit} /><span className={styles.muted}>{fit.override ? t("Let through: {reason}", { reason: fit.override.reason })
    : fit.result.status === "tight" ? t("Only just gets through the measured access.") : t("Doesn't get through the measured access. Ordering waits for an override.")}</span></div>;
}

/**
 * The sample or catalog item behind a choice: typing searches the sample library first (in stock, the firm's own stock
 * before brands, PLM-144/157), then the catalog; clearing the text unties the choice from it.
 */
function CatalogItemField({ workspaceId, caseId, value, initialText, onChange, onSample }: {
  workspaceId: string; caseId: string; value: string | null; initialText: string; onChange: (item: CatalogChoice | null) => void; onSample: (sample: SampleChoice) => void;
}) {
  const t = useT();
  const [text, setText] = useState(initialText);
  const [items, setItems] = useState<CatalogChoice[]>([]);
  const [samples, setSamples] = useState<SampleChoice[]>([]);
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      caseRequest<{ items: CatalogChoice[]; samples?: SampleChoice[] }>(workspaceId, caseId, `design-ledger/catalog?q=${encodeURIComponent(text.trim())}`)
        .then((next) => { if (live) { setItems(Array.isArray(next?.items) ? next.items : []); setSamples(Array.isArray(next?.samples) ? next.samples : []); } })
        .catch(() => { if (live) { setItems([]); setSamples([]); } });
    }, text.trim() ? 160 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [workspaceId, caseId, text]);
  const options = [
    ...samples.map((sample) => ({ id: `sample:${sample.id}`, label: sample.name, description: [t("Sample"), t(ORIGIN_LABEL[sample.origin]), sample.priceBandLabel, sample.inStock ? sample.location : t("Out of stock")]
      .filter(Boolean).join(" · ") })),
    ...items.map((item) => ({ id: item.id, label: item.name, description: [item.code, item.categoryName].filter(Boolean).join(" · ") })),
  ];
  if (value && initialText && !options.some((option) => option.id === value)) options.unshift({ id: value, label: initialText, description: "" });
  return <ComboboxField label={t("Sample or catalog item")} placeholder={t("Search the samples and the catalog")} items={options} inputValue={text} selectedKey={value}
    onInputChange={(next) => { setText(next); if (!next.trim() && value) onChange(null); }}
    onSelectionChange={(key) => {
      const id = String(key);
      const sample = id.startsWith("sample:") ? samples.find((option) => option.id === id.slice(7)) : undefined;
      if (sample) { setText(sample.name); onSample(sample); return; }
      const item = items.find((option) => option.id === id); if (item) { setText(item.name); onChange(item); }
    }} />;
}

function EntryForm({ workspaceId, caseId, rooms, currency, entry, categories, materialsOnly, onClose, onSubmit }: {
  workspaceId: string; caseId: string; rooms: CaseRoom[]; currency?: string; entry: LedgerEntry | null; categories: FinishCategory[]; materialsOnly: boolean; onClose: () => void; onSubmit: (draft: Draft) => Promise<unknown>;
}) {
  const t = useT();
  const current = entry?.current;
  const [draft, setDraft] = useState<Draft>(() => ({ kind: entry?.kind ?? "material", roomId: entry?.roomId ?? null, catalogItemId: current?.catalogItemId ?? null, title: current?.title ?? "", specification: current?.specification ?? "",
    supplier: current?.supplier ?? "", quantity: current?.quantity ?? "", unit: current?.unit ?? "", unitPrice: current?.unitPrice ?? "", timeImpactDays: 0, source: "showroom",
    saidOn: new Date().toISOString().slice(0, 10), evidence: null, evidenceNote: "", note: "",
    // A version recorded before origins read from its outsourced flag.
    origin: current?.origin ?? (current?.outsourced ? "local_supplier" : null), sampleId: current?.sampleId ?? null, sampleName: current?.sampleName ?? "",
    samplePhoto: current?.samplePhotoAssetId ? { id: current.samplePhotoAssetId, name: current.samplePhotoName ?? "", mimeType: "image/*", byteSize: 0, hasPreview: true } : null,
    categoryKey: entry?.categoryKey ?? null, location: entry?.location ?? "" }));
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => setDraft((value0) => ({ ...value0, [key]: value }));
  // Choosing a catalog item fills the name, finish and supplier from it; each stays editable.
  const pick = (item: CatalogChoice | null) => setDraft((value0) => item ? { ...value0, catalogItemId: item.id, title: item.name, specification: item.description?.trim() || value0.specification,
    supplier: item.supplier ?? value0.supplier, unit: value0.unit || item.unitCode, sampleId: null, sampleName: "" } : { ...value0, catalogItemId: null });
  // PLM-157: choosing a library sample fills the name, where it comes from and its supplier (and its catalog item, when it has one).
  const pickSample = (sample: SampleChoice) => setDraft((value0) => ({ ...value0, sampleId: sample.id, sampleName: sample.name, title: value0.title || sample.name, origin: sample.origin,
    supplier: sample.supplier || value0.supplier, catalogItemId: sample.catalogItemId ?? value0.catalogItemId, categoryKey: value0.categoryKey ?? sample.categoryKey }));
  const fit = useItemFits(workspaceId, caseId, draft.catalogItemId ? [draft.catalogItemId] : []).get(draft.catalogItemId ?? "");
  const finishes = useMemo(() => scheduleApi({ kind: "case", workspaceId, caseId }), [workspaceId, caseId]);
  const material = draft.kind === "material";
  const NONE = "none";
  return <FormDialog title={entry ? t("New version of {title}", { title: entry.title }) : materialsOnly ? t("Add material") : t("Add choice")} onClose={onClose} isDirty submitLabel={t("Save")} error={error || undefined}
    isSubmitDisabled={!draft.title.trim() || uploading} onSubmit={() => onSubmit(draft)}>
    <FormSection title={t("Choice")}>
      {!entry && !materialsOnly ? <SegmentedControl label={t("Type")} value={draft.kind} onChange={(kind) => set("kind")(kind as Draft["kind"])} options={[{ id: "material", label: t("Material") }, { id: "design", label: t("Design") }]} /> : null}
      <CatalogItemField workspaceId={workspaceId} caseId={caseId} value={draft.sampleId ? `sample:${draft.sampleId}` : draft.catalogItemId}
        initialText={draft.sampleId ? draft.sampleName : current?.catalogItemId ? current.title : ""} onChange={pick} onSample={pickSample} />
      <FitWarning fit={fit} />
      <TextInput isRequired autoFocus label={t("Name")} maxLength={240} value={draft.title} onChange={set("title")} />
      <TextAreaField label={t("Finish or specification")} maxLength={2000} value={draft.specification} onChange={set("specification")} />
      {!entry && rooms.length ? <SelectField label={t("Room")} items={[{ id: NONE, label: t("Whole home") }, ...rooms.map((room) => ({ id: room.id, label: room.name }))]}
        selectedKey={draft.roomId ?? NONE} onSelectionChange={(key) => set("roomId")(key === NONE ? null : String(key))} /> : null}
      {!entry && material && categories.length ? <FormRow>
        <SelectField label={t("Category")} items={[{ id: NONE, label: t("No category") }, ...categories.map((item) => ({ id: item.key, label: item.label }))]}
          selectedKey={draft.categoryKey ?? NONE} onSelectionChange={(key) => set("categoryKey")(key === NONE ? null : String(key))} />
        <TextInput label={t("Where it goes")} maxLength={200} value={draft.location} onChange={set("location")} />
      </FormRow> : null}
    </FormSection>
    {material ? <FormSection title={t("Supplied from")}>
      <SegmentedControl label={t("Supplied from")} value={draft.origin ?? ""} onChange={(origin) => set("origin")(origin as MaterialOrigin)}
        options={MATERIAL_ORIGINS.map((origin) => ({ id: origin, label: t(ORIGIN_LABEL[origin]) }))} />
      {draft.origin === "local_supplier" ? <p className={styles.muted}>{t("A material from a local supplier needs the reviewer's sign-off.")}</p> : null}
      {draft.samplePhoto ? <p className={styles.muted}>{t("Sample photo: {name}", { name: draft.samplePhoto.name || t("Sample photo") })}</p>
        : <AssetUpload workspaceId={workspaceId} caseId={caseId} multiple={false} label={t("Add a photo of the sample")} onBusy={setUploading} onError={setError}
          uploadFile={(file, id) => file.type.startsWith("image/") ? finishes.upload(caseId, file, id) : Promise.reject(new Error(t("Choose a photo of the sample.")))}
          onUploaded={(asset) => set("samplePhoto")(asset)} />}
    </FormSection> : null}
    <FormSection title={t("Price and time")}>
      <FormRow>
        <TextInput label={t("Quantity")} inputMode="decimal" value={draft.quantity} onChange={(value) => set("quantity")(value.replace(/[^\d.]/g, ""))} />
        <TextInput label={t("Unit")} maxLength={40} value={draft.unit} onChange={set("unit")} />
      </FormRow>
      <MoneyField label={t("Unit price")} currency={currency} value={draft.unitPrice} onChange={set("unitPrice")} />
      <NumericInput label={t("Time impact (days)")} minValue={-365} maxValue={365} step={1} value={draft.timeImpactDays} onChange={(value) => set("timeImpactDays")(Number.isFinite(value) ? Math.trunc(value) : 0)} />
      <TextInput label={t("Supplier")} maxLength={200} value={draft.supplier} onChange={set("supplier")} />
    </FormSection>
    <FormSection title={t("Where it came from")}>
      <FormRow>
        <SelectField isRequired label={t("Source")} items={LEDGER_SOURCES.filter((source) => source !== "portal").map((source) => ({ id: source, label: t(SOURCE_LABEL[source]) }))} selectedKey={draft.source} onSelectionChange={(key) => set("source")(String(key))} />
        <DateField isRequired label={t("Said on")} maxValue={parseDate(new Date().toISOString().slice(0, 10))} value={draft.saidOn ? parseDate(draft.saidOn) : null} onChange={(date) => set("saidOn")(date?.toString() ?? "")} />
      </FormRow>
      {draft.evidence ? <p className={styles.muted}>{t("Evidence: {name}", { name: draft.evidence.name })}</p>
        : <AssetUpload workspaceId={workspaceId} caseId={caseId} multiple={false} label={t("Attach evidence")} onBusy={setUploading} onError={setError} onUploaded={(asset) => set("evidence")(asset)} />}
      <TextInput label={t("Evidence note")} maxLength={2000} value={draft.evidenceNote} onChange={set("evidenceNote")} />
      <TextAreaField label={t("Note")} maxLength={2000} value={draft.note} onChange={set("note")} />
    </FormSection>
  </FormDialog>;
}

function DecisionForm({ clientName, onClose, onSubmit }: { clientName?: string; onClose: () => void; onSubmit: (input: { decision: "confirmed" | "declined"; method: string; decidedBy: string; note: string | null }) => Promise<unknown> }) {
  const t = useT();
  const [decision, setDecision] = useState<"confirmed" | "declined">("confirmed");
  const [method, setMethod] = useState<string>("in_person");
  const [decidedBy, setDecidedBy] = useState(clientName ?? "");
  const [note, setNote] = useState("");
  return <FormDialog title={t("Record client's decision")} onClose={onClose} isDirty submitLabel={t("Save")}
    isSubmitDisabled={!decidedBy.trim() || (decision === "declined" && !note.trim())} onSubmit={() => onSubmit({ decision, method, decidedBy: decidedBy.trim(), note: note.trim() || null })}>
    <SegmentedControl label={t("Decision")} value={decision} onChange={(value) => setDecision(value as "confirmed" | "declined")} options={[{ id: "confirmed", label: t("Confirmed") }, { id: "declined", label: t("Declined") }]} />
    <SelectField isRequired label={t("How")} items={CONFIRMATION_METHODS.map((id) => ({ id, label: t(METHOD_LABEL[id]) }))} selectedKey={method} onSelectionChange={(key) => setMethod(String(key))} />
    <TextInput isRequired label={t("Who decided")} maxLength={200} value={decidedBy} onChange={setDecidedBy} />
    <TextAreaField isRequired={decision === "declined"} label={decision === "declined" ? t("What the client wants instead") : t("Note")} maxLength={2000} value={note} onChange={setNote} />
  </FormDialog>;
}
