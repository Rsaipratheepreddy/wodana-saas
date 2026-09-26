"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Check, CircleCheck, CircleDashed, Plus, Upload } from "lucide-react";
import { Badge, Button, EmptyState, InlineNotice, SelectField, Skeleton, TextAreaField, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { caseRequest, type CaseAsset, type CaseContent, type CaseDesign, type CaseRoom, type DesignOptions } from "@/lib/pre-project/content";
import { mergeDesigns } from "@/lib/pre-project/design-workflow";
import { DESIGN_STATUS_LABEL, designStatusTone, isDeliverableStage, latestOf, nextStep, STAGE_DOCUMENT_TYPE, stageDetail, type JourneyStageKey, type JourneyView } from "@/lib/pre-project/design-workspace";
import { CaseModal } from "./case-controls";
import { DesignActions } from "./design-actions";
import { FileCover } from "./design-file-preview";
import { DesignReviewModal } from "./design-review-modal";
import { RoomField } from "./room-manager";
import styles from "./design-workspace.module.css";

type Listing = DesignOptions & { items: CaseDesign[] };
const NO_ROOM = "no-room";

/**
 * Design: the package's stages as a compact timeline; each design stage holds its deliverables per
 * room. Reviews and approvals happen on the drawing. A stage completes when its deliverables are
 * approved; sign-off hands the design to quoting.
 */
const NO_OPTIONS: DesignOptions = { folders: [], reviewers: [], actorId: "", canReview: false, canRecordClient: false };

export function DesignWorkspace({ initialData, initialDesigns, options = NO_OPTIONS }: { initialData: CaseContent; initialDesigns: CaseDesign[]; options?: DesignOptions }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState(initialData);
  const [designs, setDesigns] = useState(initialDesigns);
  const [review, setReview] = useState(options);
  const [journey, setJourney] = useState<JourneyView | null>(null);
  const [journeyError, setJourneyError] = useState("");
  const [picked, setPicked] = useState<JourneyStageKey | "other" | null>(null);
  const [roomFilter, setRoomFilter] = useState("all");
  const [uploading, setUploading] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { workspaceId, caseId } = data;

  const loadJourney = useCallback(async () => {
    try { setJourney(await caseRequest<JourneyView>(workspaceId, caseId, "design-journey")); setJourneyError(""); }
    catch (cause) { setJourneyError(cause instanceof Error ? cause.message : t("Could not load the design stages.")); }
  }, [workspaceId, caseId, t]);
  const loadDesigns = useCallback(async () => {
    const listing = await caseRequest<Listing>(workspaceId, caseId, "designs");
    setDesigns((current) => mergeDesigns(current, listing.items));
    setReview((current) => ({ ...current, ...listing }));
  }, [workspaceId, caseId]);
  useEffect(() => {
    let alive = true;
    caseRequest<JourneyView>(workspaceId, caseId, "design-journey")
      .then((value) => { if (alive) { setJourney(value); setJourneyError(""); } })
      .catch((cause: Error) => { if (alive) setJourneyError(cause.message); });
    return () => { alive = false; };
  }, [workspaceId, caseId]);
  useEffect(() => {
    // Other people review and upload too: refresh on return to the tab and every 20 seconds.
    const refresh = () => { if (!document.hidden) void loadDesigns().catch(() => undefined); };
    const timer = window.setInterval(refresh, 20000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [loadDesigns]);

  const current = designs.filter((design) => !design.archivedAt);
  // Inspiration and the site visit live on Moodboard and Site; Design shows only design stages.
  const stages = (journey?.stages ?? []).filter((stage) => isDeliverableStage(stage.stage) || stage.stage === "approval");
  const activeStage = stages.find((stage) => stage.status === "active")?.stage;
  const unstaged = current.filter((design) => !isDeliverableStage(design.stage));
  const shown: JourneyStageKey | "other" = picked ?? activeStage ?? stages.find((stage) => isDeliverableStage(stage.stage))?.stage ?? (unstaged.length ? "other" : "concepts");
  const stageView = stages.find((stage) => stage.stage === shown);
  const inStage = shown === "other" ? unstaged : current.filter((design) => design.stage === shown);
  const roomName = (id: string | null) => id ? data.rooms.find((room) => room.id === id)?.name ?? t("Room") : t("No room");
  const groups = [...new Set(inStage.map((design) => design.roomId ?? NO_ROOM))]
    .sort((a, b) => a === NO_ROOM ? 1 : b === NO_ROOM ? -1 : roomName(a).localeCompare(roomName(b)))
    .map((key) => ({ key, name: key === NO_ROOM ? t("No room") : roomName(key), items: inStage.filter((design) => (design.roomId ?? NO_ROOM) === key) }));
  const visibleGroups = roomFilter === "all" ? groups : groups.filter((group) => group.key === roomFilter);

  const openFile = (id: string | null) => {
    const query = new URLSearchParams(params.toString());
    if (id) query.set("file", id); else query.delete("file");
    router.replace(`${pathname}${query.size ? `?${query}` : ""}`, { scroll: false });
  };
  const selected = designs.find((design) => design.id === params.get("file")) ?? null;
  const updated = (design: CaseDesign) => { setDesigns((items) => items.map((item) => item.id === design.id ? design : item)); void loadJourney(); };

  const stageAction = async (path: string, body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try { setJourney(await caseRequest<JourneyView>(workspaceId, caseId, path, "POST", body)); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); return false; }
    finally { setBusy(false); }
  };

  if (journeyError && !journey) return <EmptyState illustration="error" title={t("Design didn't load")} description={journeyError} action={<Button size="compact" onPress={() => void loadJourney()}>{t("Retry")}</Button>} />;
  if (!journey) return <Skeleton lines={6} />;

  return <section className={styles.page} aria-label={t("Design")}>
    {!journey.journey ? <div className={styles.notStarted}>
      <EmptyState illustration="calendar" title={t("Design hasn't started")} description={t("It starts when the design fee is paid.")}
        action={journey.canStart ? <Button size="compact" variant="primary" isLoading={busy} onPress={() => void stageAction("design-journey/start", {})}>{t("Start design")}</Button> : undefined} />
    </div> : <ol className={styles.timeline} aria-label={t("Design stages")}>
      {stages.map((stage) => <li key={stage.stage} data-state={stage.status} data-selected={stage.stage === shown || undefined}>
        <button type="button" aria-current={stage.stage === shown ? "step" : undefined} onClick={() => { setPicked(stage.stage); setRoomFilter("all"); }}>
          <span className={styles.dot} aria-hidden="true">{stage.status === "done" ? <Check size={10} strokeWidth={3} /> : null}</span>
          <span className={styles.stageText}><strong>{t(stage.label as never)}</strong><small data-overdue={stage.overdue || undefined}>{(() => { const detail = stageDetail(stage); return t(detail.key as never, detail.values); })()}</small></span>
        </button>
      </li>)}
    </ol>}

    {error ? <InlineNotice tone="error" message={error} /> : null}

    {shown === "approval" ? <SignOff designs={current} journey={journey} canReview={review.canReview} busy={busy}
      onSignOff={(note) => void stageAction("design-journey/sign-off", { version: stageView?.version ?? 1, note })} /> : <>
      <div className={styles.toolbar}>
        {groups.length > 1 ? <SelectField aria-label={t("Room")} accent="neutral" label={null} items={[{ id: "all", label: t("All rooms") }, ...groups.map((group) => ({ id: group.key, label: group.name }))]} selectedKey={roomFilter} onSelectionChange={(key) => setRoomFilter(String(key ?? "all"))} /> : null}
        <span className={styles.spacer} />
        {review.canReview && stageView?.status === "active" && isDeliverableStage(shown) && !inStage.length ? <Button size="compact" onPress={() => setSkipping(true)}>{t("Not needed")}</Button> : null}
        {data.canEdit && shown !== "other" ? <Button size="compact" variant="primary" onPress={() => setUploading(true)}><Upload aria-hidden="true" size={14} />{t("Upload")}</Button> : null}
      </div>
      {!inStage.length ? <EmptyState illustration="upload" title={shown === "other" ? t("No other files") : t("Nothing here yet")}
        description={shown === "other" ? undefined : t("Upload this stage's drawings room by room.")}
        action={data.canEdit && shown !== "other" ? <Button size="compact" variant="primary" onPress={() => setUploading(true)}><Plus aria-hidden="true" size={14} />{t("Upload")}</Button> : undefined} />
        : visibleGroups.map((group) => <section key={group.key} className={styles.room} aria-label={group.name}>
          <h3>{group.name}<span>{group.items.length}</span></h3>
          <ul className={styles.cards}>{group.items.map((design) => {
            const latest = latestOf(design);
            const status = latest?.status ?? "draft";
            return <li key={design.id}><button type="button" className={styles.card} onClick={() => openFile(design.id)}>
              <span className={styles.cover}><FileCover data={data} design={design} /></span>
              <span className={styles.cardBody}>
                <strong>{design.title}</strong>
                <span className={styles.cardMeta}><Badge tone={designStatusTone(status)}>{t((DESIGN_STATUS_LABEL[status] ?? status) as never)}</Badge><span>R{latest?.number ?? 1}</span></span>
                {status === "approved" ? null : <small><CircleDashed aria-hidden="true" size={12} />{status === "client_review" && latest?.clientReviewExpiresAt
                  ? t("Decision due {date}", { date: new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short" }).format(new Date(latest.clientReviewExpiresAt)) })
                  : (() => { const step = nextStep(design, review); return t(step.key as never, step.values); })()}</small>}
              </span>
            </button></li>;
          })}</ul>
        </section>)}
      {shown !== "other" && unstaged.length ? <button type="button" className={styles.otherLink} onClick={() => setPicked("other")}>{unstaged.length === 1 ? t("1 file without a stage") : t("{count} files without a stage", { count: unstaged.length })}</button> : null}
    </>}

    {uploading && isDeliverableStage(shown) ? <UploadSheet data={data} stage={shown} roomId={roomFilter !== "all" && roomFilter !== NO_ROOM ? roomFilter : null}
      onRoomAdded={(room) => setData((value) => ({ ...value, rooms: [...value.rooms, room] }))}
      onClose={() => setUploading(false)} onUploaded={(items) => { setDesigns((value) => mergeDesigns(value, items)); setUploading(false); void loadJourney(); }} /> : null}
    {skipping && stageView ? <CaseModal title={t("{stage} isn't needed", { stage: t(stageView.label as never) })} size="md" onClose={() => setSkipping(false)} busy={busy}
      footer={<SkipFooter busy={busy} onSkip={async (note) => { if (await stageAction(`design-journey/stages/${stageView.stage}/skip`, { version: stageView.version, note })) setSkipping(false); }} />}>
      <p className={styles.muted}>{t("The next stage opens straight away.")}</p>
    </CaseModal> : null}
    {selected ? <DesignReviewModal data={data} design={selected} options={review} onClose={() => openFile(null)} onUpdate={updated}
      actions={<DesignActions data={data} design={selected} options={review} onUpdate={(design) => { if (design.archivedAt) openFile(null); updated(design); }} onRoomAdded={(room) => setData((value) => ({ ...value, rooms: [...value.rooms, room] }))} />} /> : null}
  </section>;
}

function SkipFooter({ busy, onSkip }: { busy: boolean; onSkip: (note: string) => void }) {
  const t = useT();
  const [note, setNote] = useState("");
  return <div className={styles.skipFooter}>
    <TextAreaField autoFocus isRequired label={t("Why")} value={note} onChange={setNote} />
    <Button size="compact" variant="primary" isLoading={busy} isDisabled={!note.trim()} onPress={() => onSkip(note.trim())}>{t("Skip stage")}</Button>
  </div>;
}

/** Sign-off: a checklist of what must be true, and the reviewer's button. */
function SignOff({ designs, journey, canReview, busy, onSignOff }: { designs: CaseDesign[]; journey: JourneyView; canReview: boolean; busy: boolean; onSignOff: (note: string) => void }) {
  const t = useT();
  const [note, setNote] = useState("");
  const stage = journey.stages.find((item) => item.stage === "approval");
  const staged = designs.filter((design) => isDeliverableStage(design.stage));
  const waiting = staged.filter((design) => latestOf(design)?.status !== "approved");
  const blocking = staged.reduce((sum, design) => sum + (design.threads ?? []).filter((thread) => thread.blocking && thread.status === "open").length, 0);
  const openStages = journey.stages.filter((item) => item.stage !== "approval" && item.status !== "done");
  const checks = [
    { ok: !openStages.length, label: openStages.length ? t("Finish {stages}", { stages: openStages.map((item) => t(item.label as never)).join(", ") }) : t("Every design stage is done") },
    { ok: !waiting.length, label: waiting.length ? waiting.length === 1 ? t("1 design waiting for approval") : t("{count} designs waiting for approval", { count: waiting.length }) : t("Every design is approved") },
    { ok: !blocking, label: blocking ? blocking === 1 ? t("1 blocking comment open") : t("{count} blocking comments open", { count: blocking }) : t("No blocking comments") },
  ];
  if (stage?.status === "done") return <EmptyState illustration="done" title={t("Design signed off")} description={t("It's ready to quote.")} />;
  return <div className={styles.signOff}>
    <ul>{checks.map((check) => <li key={check.label} data-ok={check.ok || undefined}>{check.ok ? <CircleCheck aria-hidden="true" size={16} /> : <CircleDashed aria-hidden="true" size={16} />}{check.label}</li>)}</ul>
    {canReview && stage?.status === "active" ? <>
      <TextAreaField label={t("Note · optional")} value={note} onChange={setNote} />
      <div className={styles.signOffAction}><Button size="compact" variant="primary" isLoading={busy} isDisabled={checks.some((check) => !check.ok)} onPress={() => onSignOff(note.trim())}>{t("Sign off design")}</Button></div>
    </> : null}
  </div>;
}

type Pending = { key: string; file: File; title: string; documentType: string };

/** Upload this stage's files into a room; each file keeps its own title and type. */
function UploadSheet({ data, stage, roomId, onRoomAdded, onClose, onUploaded }: { data: CaseContent; stage: string; roomId: string | null; onRoomAdded: (room: CaseRoom) => void; onClose: () => void; onUploaded: (items: CaseDesign[]) => void }) {
  const t = useT();
  const [room, setRoom] = useState<string | null>(roomId);
  const [files, setFiles] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const add = (list: FileList | null) => setFiles((current) => [...current, ...[...(list ?? [])].filter((file) => file.type.startsWith("image/") || file.type === "application/pdf").map((file) => ({ key: crypto.randomUUID(), file, title: file.name.replace(/\.[^.]+$/, "").slice(0, 240), documentType: STAGE_DOCUMENT_TYPE[stage] ?? "Other" }))].slice(0, 20));
  const save = async () => {
    if (!files.length) { setError(t("Choose at least one image or PDF.")); return; }
    if (files.some((file) => !file.title.trim())) { setError(t("Give every file a title.")); return; }
    setBusy(true); setError("");
    try {
      const uploaded = [];
      for (const pending of files) {
        const body = new FormData(); body.append("file", pending.file);
        const asset = await caseRequest<CaseAsset>(data.workspaceId, data.caseId, `assets/${crypto.randomUUID()}`, "POST", body);
        uploaded.push({ id: crypto.randomUUID(), versionId: crypto.randomUUID(), assetId: asset.id, title: pending.title.trim(), documentType: pending.documentType });
      }
      const result = await caseRequest<{ items: CaseDesign[] }>(data.workspaceId, data.caseId, "designs/upload", "POST", { folderId: null, stage, roomId: room, scopeEntryId: null, note: "", files: uploaded });
      onUploaded(result.items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not upload.")); setBusy(false); }
  };
  return <CaseModal title={t("Upload designs")} size="md" onClose={onClose} busy={busy} dirty={files.length > 0}
    footer={<Button size="compact" variant="primary" isLoading={busy} isDisabled={!files.length} onPress={() => void save()}>{files.length > 1 ? t("Upload {count} files", { count: files.length }) : t("Upload")}</Button>}>
    <div className={styles.uploadForm}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <RoomField data={data} value={room} onChange={(item) => setRoom(item.id)} onRoomAdded={onRoomAdded} />
      <label className={styles.drop}>
        <input type="file" multiple accept="image/*,application/pdf" onChange={(event) => { add(event.target.files); event.target.value = ""; }} />
        <Upload aria-hidden="true" size={18} /><span>{t("Choose images or PDFs")}</span>
      </label>
      {files.length ? <ul className={styles.pending}>{files.map((pending) => <li key={pending.key}>
        <input aria-label={t("Title")} value={pending.title} maxLength={240} onChange={(event) => setFiles((current) => current.map((item) => item.key === pending.key ? { ...item, title: event.target.value } : item))} />
        <Button size="compact" variant="quiet" aria-label={t("Remove {name}", { name: pending.title })} onPress={() => setFiles((current) => current.filter((item) => item.key !== pending.key))}>{t("Remove")}</Button>
      </li>)}</ul> : null}
    </div>
  </CaseModal>;
}

