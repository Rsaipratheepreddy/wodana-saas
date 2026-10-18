"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { parseDate } from "@internationalized/date";
import {
  Badge, Button, DataGrid, DateField, EmptyState, ErrorState, FormDialog, InlineNotice, ListTabs, NoResultsState, Skeleton, TextAreaField, TextInput, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { FactoryApi } from "@/lib/factory/client";
import type { SampleRequest, SamplesState } from "@/lib/factory/types";
import { Cell } from "../operations/ops";
import { useProjectFormat } from "../project-core/format";
import styles from "./factory.module.css";

/** "SR-0007". */
export const sampleNumber = (number: number) => `SR-${String(number).padStart(4, "0")}`;
const TONE: Record<SampleRequest["status"], "info" | "success" | "neutral"> = { requested: "info", ready: "success", cancelled: "neutral" };

function useSampleWords() {
  const t = useT();
  return useMemo(() => ({ status: { requested: t("Requested"), ready: t("Ready"), cancelled: t("Withdrawn") } as Record<SampleRequest["status"], string> }), [t]);
}

/** Where a sample is for: the project once it started, otherwise the case. */
const recordHref = (sample: SampleRequest) => (sample.projectId ? `/workspace/projects/${sample.projectId}` : `/workspace/pre-projects/cases/${sample.caseId}/overview`);

type Dialog = { kind: "ready" | "cancel"; sample: SampleRequest } | null;

/** Marking a sample ready (with an optional note), or withdrawing a request (with why). */
function SampleDecision({ dialog, onClose, onSave }: { dialog: NonNullable<Dialog>; onClose: () => void; onSave: (text: string) => Promise<void> }) {
  const t = useT();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const ready = dialog.kind === "ready";
  return <FormDialog size="md" title={ready ? t("Mark {sample} ready", { sample: sampleNumber(dialog.sample.number) }) : t("Withdraw {sample}", { sample: sampleNumber(dialog.sample.number) })}
    description={dialog.sample.title} onClose={onClose} error={error || undefined} isDirty={Boolean(text.trim())} isSubmitDisabled={!ready && !text.trim()}
    submitLabel={ready ? t("Mark ready") : t("Withdraw")} onSubmit={async () => {
      setError("");
      try { await onSave(text.trim()); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    }}>
    <TextAreaField label={ready ? t("Note") : t("Why")} isRequired={!ready} maxLength={500} value={text} onChange={setText} />
  </FormDialog>;
}

/**
 * PLM-061 in the Factory: the samples the design team asked for, open ones first by the day they're needed (with the
 * material selection they're for), and the one action on each: mark it ready.
 */
export function FactorySamples({ api, openId = null }: { api: FactoryApi; openId?: string | null }) {
  const t = useT();
  const format = useProjectFormat();
  const words = useSampleWords();
  const [state, setState] = useState<SamplesState | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"open" | "all">("open");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const load = useCallback(async () => {
    try { setState(await api.samples()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The samples didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  // A notice's link opens its request.
  useEffect(() => {
    const sample = openId ? state?.samples.find((item) => item.id === openId) : null;
    if (sample?.status === "requested" && state?.canMake) queueMicrotask(() => setDialog({ kind: "ready", sample }));
  }, [openId, state]);

  const columns = useMemo<DataGridColumn<SampleRequest>[]>(() => [
    { id: "sample", header: t("Sample"), accessorFn: (row) => row.number, size: 280, meta: { primary: true, renderCell: (row) =>
      <Cell title={row.title} meta={[sampleNumber(row.number), row.note].filter(Boolean).join(" · ")} /> } },
    { id: "for", header: t("For"), accessorFn: (row) => row.projectReference ?? row.caseReference ?? "", size: 200, meta: { mobileHidden: true, renderCell: (row) =>
      <Cell title={<Link href={recordHref(row)} onClick={(event) => event.stopPropagation()}>{row.projectReference ?? row.caseReference ?? t("Case")}</Link>}
        meta={[row.clientName, row.requestedByName].filter(Boolean).join(" · ")} /> } },
    { id: "due", header: t("Needed by"), accessorFn: (row) => row.dueOn, size: 200, meta: { renderCell: (row) => {
      const until = row.status === "requested" ? format.until(row.dueOn) : null;
      return <Cell title={<span className={styles.number}>{format.short(row.dueOn)}</span>}
        meta={[until?.text, row.appointmentOn ? t("Material selection {date}", { date: format.short(row.appointmentOn) }) : ""].filter(Boolean).join(" · ") || null}
        tone={until?.late ? "danger" : undefined} />;
    } } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, size: 170, meta: { renderCell: (row) =>
      <Cell title={<Badge tone={TONE[row.status]}>{words.status[row.status]}</Badge>}
        meta={row.status === "ready" ? [row.readyByName, row.readyAt ? format.when(row.readyAt) : "", row.readyNote].filter(Boolean).join(" · ")
          : row.status === "cancelled" ? row.cancelReason : null} /> } },
    { id: "next", header: t("Next"), accessorFn: () => "", size: 140, meta: { align: "end", renderCell: (row) => row.status === "requested" && state?.canMake
      ? <Button size="compact" variant="secondary" aria-label={`${t("Mark ready")} ${sampleNumber(row.number)}`} onPress={() => setDialog({ kind: "ready", sample: row })}>{t("Mark ready")}</Button>
      : null } },
  ], [t, format, words, state?.canMake]);

  if (error && !state) return <ErrorState description={error} onRetry={() => void load()} />;
  const needle = search.trim().toLocaleLowerCase();
  const all = (state?.samples ?? []).filter((row) => !needle || `${sampleNumber(row.number)} ${row.title} ${row.projectReference ?? ""} ${row.caseReference ?? ""} ${row.clientName}`
    .toLocaleLowerCase().includes(needle));
  const open = all.filter((row) => row.status === "requested");
  return <div className={styles.stack}>
    <DataGrid<SampleRequest> ariaLabel={t("Samples")} columns={columns} data={view === "open" ? open : all} getRowId={(row) => row.id} isLoading={!state} rowNumbers={false} wrapText
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search samples")}
      toolbarLeading={<ListTabs label={t("Samples")} value={view} onChange={setView} items={[{ id: "open", label: t("To make"), count: open.length }, { id: "all", label: t("All") }]} />}
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={view === "open" ? t("No samples to make") : t("No sample requests yet")} />} />
    {dialog ? <SampleDecision dialog={dialog} onClose={() => setDialog(null)} onSave={async (text) => {
      setState(await api.sampleCommand(dialog.sample.id, dialog.kind, dialog.kind === "ready" ? { note: text, version: dialog.sample.version } : { reason: text, version: dialog.sample.version }));
      setDialog(null);
    }} /> : null}
  </div>;
}

/**
 * PLM-061 on a case (and its project): the samples asked for it, and asking the factory for one, needed by a day
 * before the material selection appointment when one is booked. The person who asked withdraws an open request.
 */
export function SampleRequests({ api, caseId }: { api: FactoryApi; caseId: string }) {
  const t = useT();
  const format = useProjectFormat();
  const words = useSampleWords();
  const [state, setState] = useState<SamplesState | null>(null);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const load = useCallback(async () => {
    try { setState(await api.samples(caseId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The samples didn't load.")); }
  }, [api, caseId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (error && !state) return <InlineNotice tone="error" message={error} />;
  if (!state) return <Skeleton lines={2} shape="rows" />;
  const samples = state.samples ?? [];
  // Nothing asked and nothing to ask: the section stays out of the way.
  if (!samples.length && !state.canRequest) return null;
  return <section className={styles.stack} aria-labelledby={`samples-${caseId}`}>
    <div className={styles.toolbar}>
      <h3 id={`samples-${caseId}`} className={styles.subhead}>{t("Samples")}</h3>
      {state.canRequest ? <Button size="compact" variant="secondary" onPress={() => setAsking(true)}>{t("Request a sample")}</Button> : null}
    </div>
    {samples.length ? <ul className={styles.list}>{samples.map((sample) => {
      const until = sample.status === "requested" ? format.until(sample.dueOn) : null;
      const mine = sample.status === "requested" && (sample.requestedBy === state.me || state.canWithdrawAny);
      return <li key={sample.id}>
        <span className={styles.nameCell}><span>{`${sampleNumber(sample.number)} · ${sample.title}`}</span>
          <small>{[sample.status === "ready" ? [sample.readyByName, sample.readyNote].filter(Boolean).join(" · ") : t("Needed by {date}", { date: format.short(sample.dueOn) }),
            until?.late ? until.text : "", sample.status === "cancelled" ? sample.cancelReason : ""].filter(Boolean).join(" · ")}</small></span>
        <span className={styles.filters}>
          <Badge tone={until?.late ? "danger" : TONE[sample.status]}>{words.status[sample.status]}</Badge>
          {sample.status === "requested" && state.canMake ? <Button size="compact" variant="quiet" onPress={() => setDialog({ kind: "ready", sample })}>{t("Mark ready")}</Button> : null}
          {mine ? <Button size="compact" variant="quiet" onPress={() => setDialog({ kind: "cancel", sample })}>{t("Withdraw")}</Button> : null}
        </span>
      </li>;
    })}</ul> : <p className={styles.muted}>{t("No samples asked for yet.")}</p>}
    {asking ? <RequestSampleDialog state={state} onClose={() => setAsking(false)} onSave={async (input) => {
      setState(await api.requestSample({ ...input, caseId }));
      setAsking(false);
    }} /> : null}
    {dialog ? <SampleDecision dialog={dialog} onClose={() => setDialog(null)} onSave={async (text) => {
      setState(await api.sampleCommand(dialog.sample.id, dialog.kind, { ...(dialog.kind === "ready" ? { note: text } : { reason: text }), version: dialog.sample.version, caseId }));
      setDialog(null);
    }} /> : null}
  </section>;
}

/** What sample, for when: by default the day before the material selection (never on or after it). */
function RequestSampleDialog({ state, onClose, onSave }: { state: SamplesState; onClose: () => void; onSave: (input: { id: string; title: string; note: string; dueOn: string }) => Promise<void> }) {
  const t = useT();
  const format = useProjectFormat();
  const [id] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [dueOn, setDueOn] = useState(state.suggestedDueOn);
  const [error, setError] = useState("");
  const upcoming = state.appointmentOn && state.appointmentOn > state.today ? state.appointmentOn : null;
  const tooLate = Boolean(upcoming && dueOn >= upcoming);
  return <FormDialog size="md" title={t("Request a sample")} onClose={onClose} error={error || undefined} isDirty={Boolean(title.trim() || note.trim())}
    isSubmitDisabled={!title.trim() || !dueOn || dueOn < state.today || tooLate} submitLabel={t("Request")} onSubmit={async () => {
      setError("");
      try { await onSave({ id, title: title.trim(), note: note.trim(), dueOn }); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    }}>
    <TextInput label={t("Sample")} isRequired maxLength={200} value={title} onChange={setTitle} />
    <DateField label={t("Needed by")} isRequired value={dueOn ? parseDate(dueOn) : null} minValue={parseDate(state.today)}
      onChange={(value) => setDueOn(value ? value.toString() : "")} isInvalid={tooLate}
      description={upcoming ? t("Material selection {date}", { date: format.short(upcoming) }) : undefined}
      errorMessage={tooLate ? t("Needed before the material selection.") : undefined} />
    <TextAreaField label={t("Note")} maxLength={1000} value={note} onChange={setNote} />
  </FormDialog>;
}
