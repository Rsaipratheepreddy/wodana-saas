"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, EditableFieldList, EmptyState, ErrorState, FactRow, FileUploader, FormDialog, InlineNotice, PageShell, SelectField, Skeleton, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { factoryApi } from "@/lib/factory/client";
import type { InspectionState } from "@/lib/factory/types";
import { shrinkPhoto } from "@/lib/site/shrink-photo";
import { Cell, NextStep, Section, operationsStyles as ops, projectHref } from "../operations/ops";
import { useProjectFormat } from "../project-core/format";
import { SavedPhotos } from "../purchasing/delivery-photos";
import { quantityText } from "../purchasing/order-labels";
import { INSPECTION_TONE, orderNumber, useInspectionLabels } from "./factory-labels";
import styles from "./factory.module.css";

type Severity = "minor" | "major" | "critical";
type SnagLine = { key: string; title: string; severity: Severity };

/**
 * PLM-150: one design inspection, as the designer opens it at the factory (often on a phone): the item and when it's
 * due, the photos taken (each saved as it's taken), then pass it or fail it with what to fix (each a snag for the
 * factory). Below: the snags and every round of the item.
 */
export function InspectionRecord({ workspaceId, inspectionId }: { workspaceId: string; inspectionId: string }) {
  const t = useT();
  const format = useProjectFormat();
  const labels = useInspectionLabels();
  const api = useMemo(() => factoryApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<InspectionState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<"pass" | "fail" | null>(null);
  const [uploading, setUploading] = useState(0);
  const [fixing, setFixing] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setState(await api.inspection(inspectionId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The inspection didn't load.")); }
  }, [api, inspectionId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  /** Each photo is saved as soon as it's chosen (shrunk on the device first), once by its own id. */
  const addPhotos = async (files: File[]) => {
    setNotice("");
    for (const file of files.filter((entry) => entry.type.startsWith("image/")).slice(0, 10)) {
      setUploading((count) => count + 1);
      try { setState(await api.uploadInspectionPhoto(inspectionId, crypto.randomUUID(), await shrinkPhoto(file))); }
      catch (cause) { setNotice(cause instanceof Error ? cause.message : t("The photo could not be uploaded.")); }
      finally { setUploading((count) => count - 1); }
    }
  };
  /** Records the result; a clash with someone else's change reloads the round and says so. */
  const record = async (action: "pass" | "fail", input: Record<string, unknown>) => {
    if (!state) return;
    try { setState(await api.recordInspection(inspectionId, action, { version: state.row.version, ...input })); setDialog(null); }
    catch (cause) {
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      throw cause;
    }
  };

  /** The factory marks one snag fixed; the round reloads (a clash with someone else's change too). */
  const fixSnag = async (snag: { id: string; version: number }) => {
    setFixing(snag.id); setNotice("");
    try { setState(await api.fixSnag(inspectionId, snag)); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); await load(); }
    finally { setFixing(null); }
  };

  if (error && !state) return <PageShell kind="record" title={t("Design inspection")}><ErrorState description={error} onRetry={() => void load()} /></PageShell>;
  if (!state) return <PageShell kind="record" title={t("Design inspection")}><Skeleton lines={8} shape="facts" /></PageShell>;
  const { row } = state;
  const stage = labels.stage(row.stage, state.stages);
  const open = row.status === "due";
  const canRecord = open && state.canRecord;
  const late = open && row.dueOn < format.today();
  const openSnags = (inspectionId: string) => state.snags.filter((snag) => snag.inspectionId === inspectionId && ["todo", "in_progress"].includes(snag.status)).length;
  const step = open ? { title: t("Inspect it by {date}", { date: format.day(row.dueOn) }), tone: late ? "danger" as const : undefined,
      detail: [row.inspectorName ?? t("Nobody on the team inspects"), state.managers.length ? t("{names} may attend", { names: state.managers.join(", ") }) : ""].filter(Boolean).join(" · ") }
    : row.status === "passed" ? { title: t("Passed by {name} on {date}", { name: row.resultByName ?? "", date: (row.resultAt ? format.when(row.resultAt) : format.day(row.dueOn)) }),
      detail: row.stage === "final" ? t("It can go to site.") : t("Finishing can go ahead.") }
    : row.status === "failed" ? { title: t("Failed by {name} on {date}", { name: row.resultByName ?? "", date: (row.resultAt ? format.when(row.resultAt) : format.day(row.dueOn)) }), tone: "warning" as const,
      detail: openSnags(row.id) === 1 ? t("1 snag for the factory to fix") : openSnags(row.id) ? t("{count} snags for the factory to fix", { count: openSnags(row.id) })
        : t("The factory fixed the snags: it goes back for inspection.") }
    : { title: t("Withdrawn"), detail: null };
  const severity = { minor: t("Minor"), major: t("Major"), critical: t("Critical") } as Record<string, string>;
  const snagStatus = { todo: t("To fix"), in_progress: t("Being fixed"), in_review: t("Fixed"), done: t("Closed"), cancelled: t("Cancelled") } as Record<string, string>;

  return <PageShell kind="record" title={`${stage} · ${row.title}`}
    action={canRecord ? <Button variant="primary" onPress={() => setDialog("pass")}>{t("Pass")}</Button> : null}>
    <div className={styles.sheet}>
      <div className={ops.recordHead}>
        <div className={ops.recordFacts}>
          <Badge tone={INSPECTION_TONE[row.status]}>{labels.round[row.status]}</Badge>
          <span>{[orderNumber(row.number), row.round > 1 ? t("Round {round}", { round: row.round }) : ""].filter(Boolean).join(" · ")}</span>
        </div>
        <NextStep title={step.title} detail={step.detail} tone={step.tone}
          actions={canRecord ? <Button variant="secondary" onPress={() => setDialog("fail")}>{t("Fail")}</Button> : null} />
      </div>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      {open && !state.canRecord ? <InlineNotice tone="info" message={row.requestedByMe ? t("You marked it ready: someone in the design team records the inspection.")
        : t("Only the inspecting designer or a manager records it.")} /> : null}
      <EditableFieldList>
        <FactRow label={t("Item")}>{[`${quantityText(row.quantity)} ${row.unit}`.trim(), row.title, row.specification].filter(Boolean).join(" · ")}</FactRow>
        <FactRow label={t("Project")}><Link className={ops.projectLink} href={projectHref(row.projectId)}>{row.projectReference}</Link><span>{row.projectName}</span></FactRow>
        <FactRow label={t("Inspector")}>{row.inspectorName ?? t("Nobody on the team inspects")}</FactRow>
        <FactRow label={t("Marked ready")}>{t("{name} on {date}", { name: row.requestedByName, date: format.when(row.requestedAt) })}</FactRow>
        {row.comments ? <FactRow label={t("Comments")}>{row.comments}</FactRow> : null}
        {state.canSeeFactory ? <FactRow label={t("Work order")}>
          <Link className={ops.projectLink} href={`/workspace/factory/orders?order=${row.workOrderId}`}>{orderNumber(row.number)}</Link></FactRow> : null}
      </EditableFieldList>
      <Section title={t("Photos")} action={canRecord ? <FileUploader appearance="button" accept="image/*" label={uploading ? t("Saving the photo") : t("Add a photo")}
        onFiles={(files) => void addPhotos(files)} /> : null}>
        {state.photos.length ? <SavedPhotos photos={state.photos} url={api.inspectionPhotoUrl} />
          : <EmptyState illustration={null} title={t("No photos.")} description={canRecord ? t("Take a photo of each problem before failing it.") : undefined} />}
      </Section>
      {state.snags.length ? <Section title={t("Snags")}>
        <ul className={ops.list}>{state.snags.map((snag) => <li key={snag.id}>
          <Cell title={<Link className={ops.projectLink} href={`${projectHref(row.projectId, "plan")}?item=${snag.id}`}>{`#${snag.number} ${snag.title}`}</Link>}
            meta={[severity[snag.severity], snag.assigneeName, snag.dueDate ? t("Due {date}", { date: format.day(snag.dueDate) }) : "",
              snag.inspectionId !== row.id ? labels.stage(state.rounds.find((round) => round.id === snag.inspectionId)?.stage ?? row.stage, state.stages) : ""].filter(Boolean).join(" · ")}
            tone={["todo", "in_progress"].includes(snag.status) ? "danger" : undefined} />
          {/* PLM-150: the factory marks each snag fixed here, as on the work order. */}
          {snag.canFix ? <Button size="compact" variant="secondary" isLoading={fixing === snag.id} isDisabled={Boolean(fixing)} onPress={() => void fixSnag(snag)}>{t("Mark fixed")}</Button>
            : <Badge tone={snag.status === "done" ? "success" : snag.status === "in_review" ? "info" : snag.status === "cancelled" ? "neutral" : "warning"}>{snagStatus[snag.status] ?? snag.status}</Badge>}
        </li>)}</ul>
      </Section> : null}
      {state.rounds.length > 1 ? <Section title={t("Rounds")}>
        <ul className={ops.list}>{state.rounds.map((round) => <li key={round.id}>
          <Cell title={round.id === row.id ? `${labels.stage(round.stage, state.stages)} · ${t("Round {round}", { round: round.round })}`
              : <Link className={ops.projectLink} href={`/workspace/inspections/${round.id}`}>{`${labels.stage(round.stage, state.stages)} · ${t("Round {round}", { round: round.round })}`}</Link>}
            meta={[round.resultAt ? [round.resultByName, format.when(round.resultAt)].filter(Boolean).join(" · ") : t("Due {date}", { date: format.day(round.dueOn) }),
              round.snags ? t("{count} snags", { count: round.snags }) : "", round.comments].filter(Boolean).join(" · ")} />
          <Badge tone={INSPECTION_TONE[round.status]}>{labels.round[round.status]}</Badge>
        </li>)}</ul>
      </Section> : null}
    </div>
    {dialog === "pass" ? <PassDialog stage={stage} onClose={() => setDialog(null)} onSave={(comments) => record("pass", { comments })} /> : null}
    {dialog === "fail" ? <FailDialog stage={stage} photos={state.photos.length} onClose={() => setDialog(null)} onSave={(input) => record("fail", input)} /> : null}
  </PageShell>;
}

/** Passing: an optional comment. */
function PassDialog({ stage, onClose, onSave }: { stage: string; onClose: () => void; onSave: (comments: string) => Promise<void> }) {
  const t = useT();
  const [comments, setComments] = useState("");
  const [error, setError] = useState("");
  return <FormDialog size="md" title={t("Pass {stage}", { stage })} onClose={onClose} error={error || undefined} submitLabel={t("Pass")}
    onSubmit={async () => { setError(""); try { await onSave(comments.trim()); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); } }}>
    <TextAreaField label={t("Comments")} value={comments} onChange={setComments} />
  </FormDialog>;
}

/** Failing: what's wrong, and each thing to fix (a snag for the factory) with how serious it is; the photos come first. */
function FailDialog({ stage, photos, onClose, onSave }: { stage: string; photos: number; onClose: () => void;
  onSave: (input: { comments: string; snags: Array<{ title: string; severity: Severity }> }) => Promise<void> }) {
  const t = useT();
  const [comments, setComments] = useState("");
  const [lines, setLines] = useState<SnagLine[]>(() => [{ key: crypto.randomUUID(), title: "", severity: "major" }]);
  const [error, setError] = useState("");
  const filled = lines.filter((line) => line.title.trim());
  const change = (key: string, patch: Partial<SnagLine>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  return <FormDialog size="md" title={t("Fail {stage}", { stage })} onClose={onClose} error={error || undefined} submitLabel={t("Fail")} submitVariant="danger"
    isSubmitDisabled={!photos || !comments.trim() || !filled.length}
    onSubmit={async () => { setError("");
      try { await onSave({ comments: comments.trim(), snags: filled.map((line) => ({ title: line.title.trim(), severity: line.severity })) }); }
      catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); } }}>
    {!photos ? <InlineNotice tone="info" message={t("Add a photo of what's wrong first.")} /> : null}
    <TextAreaField label={t("What's wrong")} isRequired value={comments} onChange={setComments} />
    {lines.map((line, index) => <div key={line.key} className={styles.snagLine}>
      <TextInput label={t("Snag {number}", { number: index + 1 })} value={line.title} onChange={(title) => change(line.key, { title })} />
      <SelectField label={t("How serious")} selectedKey={line.severity} onSelectionChange={(key) => change(line.key, { severity: (key ? String(key) : "major") as Severity })}
        items={[{ id: "minor", label: t("Minor") }, { id: "major", label: t("Major") }, { id: "critical", label: t("Critical") }]} />
    </div>)}
    {lines.length < 30 ? <span><Button size="compact" variant="quiet" onPress={() => setLines((current) => [...current, { key: crypto.randomUUID(), title: "", severity: "major" }])}>
      {t("Add a snag")}</Button></span> : null}
  </FormDialog>;
}
