"use client";

import { RecordHistory } from "../history/record-history";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, CircleCheck, CircleDashed, Folder, Plus, Upload } from "lucide-react";
import { parseDate } from "@internationalized/date";
import { Badge, Button, DateField, EmptyState, FileUploader, FormSection, InlineNotice, PillTabs, SegmentedControl, SelectField, Skeleton, TextAreaField, TextInput, useDesignSystem, VisuallyHidden } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { caseRequest, type CaseAsset, type CaseContent, type CaseDesign, type CaseRoom, type DesignOptions } from "@/lib/pre-project/content";
import { mergeDesigns } from "@/lib/pre-project/design-workflow";
import { DESIGN_STATUS_LABEL, designStatusTone, isDeliverableStage, latestOf, nextStep, STAGE_DOCUMENT_TYPE, stageDetail, type JourneyStageKey, type JourneyView } from "@/lib/pre-project/design-workspace";
import { AssetUpload, CaseModal } from "./case-controls";
import { DesignLedger } from "./design-ledger";
import { FinishesSchedule } from "../finishes/finishes-schedule";
import { DesignPresentations } from "./design-presentations";
import { METHOD_LABEL } from "@/lib/pre-project/design-decisions";
import { RevisionChips } from "./revision-chips";
import { DesignActions } from "./design-actions";
import { FileCover } from "./design-file-preview";
import { DesignViewer } from "./design-viewer";
import { RoomField } from "./room-manager";
import styles from "./design-workspace.module.css";

type Listing = DesignOptions & { items: CaseDesign[] };
/** A design stage, the files of no stage, the materials and decisions, the finishes schedule (PLM-156) or the history. */
type Tab = JourneyStageKey | "other" | "ledger" | "finishes" | "history";
const NO_ROOM = "no-room";

/**
 * Design: the package's stages as simple tabs; each stage holds its drawings, each tagged with its
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
  // A notice or a link can open a stage, the approval or the materials and decisions list (?stage=…).
  const [picked, setPicked] = useState<Tab | null>(() => (params.get("stage") as Tab | null) ?? null);
  const [view, setView] = useState<"folders" | "all">("folders");
  const [folder, setFolder] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { workspaceId, caseId } = data;

  // An answer without the stages is a failed load (error and Retry), never a reason to keep the skeleton up.
  const readJourney = useCallback(async () => {
    const value = await caseRequest<JourneyView | null>(workspaceId, caseId, "design-journey");
    if (!value || typeof value !== "object" || !Array.isArray(value.stages)) throw new Error(t("Could not load the design stages."));
    return value;
  }, [workspaceId, caseId, t]);
  const loadJourney = useCallback(async () => {
    try { setJourney(await readJourney()); setJourneyError(""); }
    catch (cause) { setJourneyError(cause instanceof Error && cause.message ? cause.message : t("Could not load the design stages.")); }
  }, [readJourney, t]);
  const loadDesigns = useCallback(async () => {
    const listing = await caseRequest<Listing>(workspaceId, caseId, "designs");
    setDesigns((current) => mergeDesigns(current, listing.items));
    setReview((current) => ({ ...current, ...listing }));
  }, [workspaceId, caseId]);
  useEffect(() => {
    let alive = true;
    readJourney()
      .then((value) => { if (alive) { setJourney(value); setJourneyError(""); } })
      .catch((cause: unknown) => { if (alive) setJourneyError(cause instanceof Error && cause.message ? cause.message : t("Could not load the design stages.")); });
    return () => { alive = false; };
  }, [readJourney, t]);
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
  const shown: Tab = picked ?? activeStage ?? stages.find((stage) => isDeliverableStage(stage.stage))?.stage ?? (unstaged.length ? "other" : "concepts");
  const stageView = stages.find((stage) => stage.stage === shown);
  // Concepts (and renders on the newer flow) are worked through presentations: that block carries the stage's empty state.
  const presenting = (shown === "moodboards" || shown === "concepts" || (shown === "renders" && Number(journey?.journey?.flowVersion) >= 2)) && Boolean(journey?.journey);
  const stageChip = stageView && shown !== "other" ? <Badge tone={stageView.status === "done" ? "success" : stageView.overdue && stageView.status === "active" ? "danger" : stageView.status === "active" ? "info" : "neutral"}>
    {(() => { const detail = stageDetail(stageView); return t(detail.key as never, detail.values); })()}</Badge> : null;
  const inStage = shown === "other" ? unstaged : shown === "ledger" || shown === "finishes" ? [] : current.filter((design) => design.stage === shown);
  const roomName = (id: string | null) => id ? data.rooms.find((room) => room.id === id)?.name ?? t("Room") : t("General");
  const groups = [...new Set(inStage.map((design) => design.roomId ?? NO_ROOM))]
    .sort((a, b) => a === NO_ROOM ? 1 : b === NO_ROOM ? -1 : roomName(a).localeCompare(roomName(b)))
    .map((key) => ({ key, name: key === NO_ROOM ? t("General") : roomName(key), items: inStage.filter((design) => (design.roomId ?? NO_ROOM) === key) }));
  // Rooms are folders. With one room (or none) there is nothing to group, so the files show straight away.
  const openGroup = groups.find((group) => group.key === folder) ?? null;
  const foldered = groups.length > 1 && view === "folders";
  const files = openGroup ? openGroup.items : inStage;

  const openFile = (id: string | null) => {
    const query = new URLSearchParams(params.toString());
    if (id) query.set("file", id); else query.delete("file");
    router.replace(`${pathname}${query.size ? `?${query}` : ""}`, { scroll: false });
  };
  const selected = designs.find((design) => design.id === params.get("file")) ?? null;
  const updated = (design: CaseDesign) => { setDesigns((items) => items.map((item) => item.id === design.id ? design : item)); void loadJourney(); };

  const stageAction = async (path: string, body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try { const next = await caseRequest<JourneyView>(workspaceId, caseId, path, "POST", body); setJourney((current) => ({ ...next, canStart: current?.canStart, canManage: current?.canManage, canEdit: current?.canEdit, canReview: current?.canReview, canRecordClient: current?.canRecordClient })); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); return false; }
    finally { setBusy(false); }
  };

  if (journeyError && !journey) return <EmptyState illustration="error" title={t("Design didn't load")} description={journeyError} action={<Button size="compact" onPress={() => void loadJourney()}>{t("Retry")}</Button>} />;
  if (!journey) return <Skeleton lines={6} shape="rows" />;

  return <section className={styles.page} aria-label={t("Design")}>
    {/* One message, matching the case: why the stages can't start yet, or the one action that starts them; files already
        shared stay listed under a compact line, never under a "hasn't started" page. */}
    {!journey.journey ? (current.length ? <div className={styles.notStartedBar}>
      <span>{journey.startBlocker ? translateKnown(t, journey.startBlocker) : t("The design stages haven't started")}</span>
      {journey.canStart ? <Button size="compact" variant="primary" isLoading={busy} onPress={() => void stageAction("design-journey/start", {})}>{t("Start design")}</Button> : null}
    </div> : <div className={styles.notStarted}>
      <EmptyState illustration="calendar" title={t("Design hasn't started")} description={journey.startBlocker ? translateKnown(t, journey.startBlocker) : journey.canStart ? t("Start the design stages when the team is ready.") : t("The design stages start from the paid design deal.")}
        action={journey.canStart ? <Button size="compact" variant="primary" isLoading={busy} onPress={() => void stageAction("design-journey/start", {})}>{t("Start design")}</Button> : undefined} />
    </div>) : <PillTabs ariaLabel={t("Design stages")} selectedKey={shown} onSelectionChange={(key) => { setPicked(key as Tab); setFolder(null); }}
      items={[...stages.map((stage) => ({ id: stage.stage, label: t(stage.label as never), done: stage.status === "done" })), ...(unstaged.length ? [{ id: "other", label: t("Other") }] : []),
        { id: "ledger", label: t("Materials & decisions") }, { id: "finishes", label: t("Finishes") }, { id: "history", label: t("History") }]} />}

    {error ? <InlineNotice tone="error" message={error} /> : null}

    {shown === "history" ? <RecordHistory workspaceId={workspaceId} recordType="design" recordId={caseId} />
    : shown === "ledger" ? <DesignLedger workspaceId={workspaceId} caseId={caseId} rooms={data.rooms} />
    : shown === "finishes" ? <FinishesSchedule source={{ kind: "case", workspaceId, caseId }} rooms={data.rooms} onAddMaterials={() => setPicked("ledger")} />
    : shown === "approval" ? <SignOff data={data} designs={current} journey={journey} canReview={review.canRecordClient} busy={busy}
      onSignOff={(input) => void stageAction("design-journey/sign-off", { version: stageView?.version ?? 1, ...input })} /> : <>
      {presenting ? <DesignPresentations workspaceId={workspaceId} caseId={caseId} stage={shown} designs={designs} canEdit={data.canEdit}
        canRecordClient={review.canRecordClient} onChanged={() => void loadJourney()} status={inStage.length ? undefined : stageChip} /> : null}
      {presenting && !inStage.length ? null : <div className={styles.toolbar}>
        {stageChip}
        {stageView && shown !== "other" && !presenting ? <RevisionChips revisions={stageView.revisions} workspaceId={workspaceId} caseId={caseId} stage={shown} canEdit={data.canEdit} onChanged={() => void loadJourney()} /> : null}
        {openGroup ? <nav className={styles.crumbs} aria-label={t("Folders")}><button type="button" onClick={() => setFolder(null)}>{t("All rooms")}</button><ChevronRight aria-hidden="true" size={14} /><span aria-current="page">{openGroup.name}</span></nav>
          : groups.length > 1 ? <SegmentedControl label={t("View")} value={view} onChange={(value) => setView(value as "folders" | "all")} options={[{ id: "folders", label: t("Rooms") }, { id: "all", label: t("All files") }]} /> : null}
        <span className={styles.spacer} />
        {review.canReview && stageView?.status === "active" && isDeliverableStage(shown) && !inStage.length ? <Button size="compact" onPress={() => setSkipping(true)}>{t("Not needed")}</Button> : null}
        {data.canEdit && shown !== "other" && (inStage.length || !presenting) ? <Button size="compact" variant={presenting ? "secondary" : "primary"} onPress={() => setUploading(true)}><Upload aria-hidden="true" size={14} />{t("Upload")}</Button> : null}
      </div>}
      {!inStage.length && presenting ? null : !inStage.length ? <EmptyState illustration="upload" title={shown === "other" ? t("No other files") : t("Nothing here yet")}
        description={shown === "other" ? undefined : t("Upload this stage's drawings room by room.")}
        action={undefined} />
        : foldered && !openGroup ? <ul className={styles.cards} aria-label={t("Rooms")}>{groups.map((group) => {
            const approved = group.items.filter((design) => latestOf(design)?.status === "approved").length;
            return <li key={group.key}><button type="button" className={styles.card} onClick={() => setFolder(group.key)}>
              <span className={styles.mosaic} data-count={Math.min(group.items.length, 4)}>{group.items.slice(0, 4).map((design) => <FileCover key={design.id} data={data} design={design} />)}</span>
              <span className={styles.cardBody}>
                <strong><Folder aria-hidden="true" size={14} />{group.name}</strong>
                <span className={styles.cardMeta}>{group.items.length === 1 ? t("1 file") : t("{count} files", { count: group.items.length })}<span aria-hidden="true">·</span>{t("{approved} of {total} approved", { approved, total: group.items.length })}</span>
              </span>
            </button></li>;
          })}</ul>
        : <ul className={styles.cards} aria-label={t("Designs")}>{files.map((design) => {
            const latest = latestOf(design);
            const status = latest?.status ?? "draft";
            return <li key={design.id}><button type="button" className={styles.card} onClick={() => openFile(design.id)}>
              <span className={styles.cover}><FileCover data={data} design={design} /></span>
              <span className={styles.cardBody}>
                <strong>{design.title}</strong>
                <span className={styles.cardMeta}><Badge tone={designStatusTone(status)}>{t((DESIGN_STATUS_LABEL[status] ?? status) as never)}</Badge><span>R{latest?.number ?? 1}</span>{openGroup ? null : <span className={styles.cardRoom}>{roomName(design.roomId)}</span>}</span>
                {status === "approved" ? null : <small><CircleDashed aria-hidden="true" size={12} />{status === "client_review" && latest?.clientReviewExpiresAt
                  ? t("Decision due {date}", { date: new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short" }).format(new Date(latest.clientReviewExpiresAt)) })
                  : (() => { const step = nextStep(design, review); return t(step.key as never, step.values); })()}</small>}
              </span>
            </button></li>;
          })}</ul>}
    </>}

    {uploading && isDeliverableStage(shown) ? <UploadSheet data={data} stage={shown} roomId={openGroup && openGroup.key !== NO_ROOM ? openGroup.key : null}
      onRoomAdded={(room) => setData((value) => ({ ...value, rooms: [...value.rooms, room] }))}
      onClose={() => setUploading(false)} onUploaded={(items) => { setDesigns((value) => mergeDesigns(value, items)); setUploading(false); void loadJourney(); }} /> : null}
    {skipping && stageView ? <CaseModal title={t("{stage} isn't needed", { stage: t(stageView.label as never) })} size="md" onClose={() => setSkipping(false)} busy={busy}
      footer={<SkipFooter busy={busy} onSkip={async (note) => { if (await stageAction(`design-journey/stages/${stageView.stage}/skip`, { version: stageView.version, note })) setSkipping(false); }} />}>
      <p className={styles.muted}>{t("The next stage opens straight away.")}</p>
    </CaseModal> : null}
    {selected ? <DesignViewer data={data} design={selected} options={review} onClose={() => openFile(null)} onUpdate={updated}
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

/**
 * PLM-053: the design approval — a checklist of what must be true (stages, approvals, blocking comments, every
 * material and design choice confirmed by the client), then the day the client approved, who signed, how, and the
 * signed file. It locks the materials and decisions list and hands off to the Proposal 2 estimate.
 */
function SignOff({ data, designs, journey, canReview, busy, onSignOff }: { data: CaseContent; designs: CaseDesign[]; journey: JourneyView; canReview: boolean; busy: boolean;
  onSignOff: (input: { note: string | null; approvedOn: string; signer: string; method: string; assetId: string }) => void }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [note, setNote] = useState("");
  const [approvedOn, setApprovedOn] = useState(today);
  const [signer, setSigner] = useState("");
  const [method, setMethod] = useState("signed_document");
  const [file, setFile] = useState<CaseAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const stage = journey.stages.find((item) => item.stage === "approval");
  const staged = designs.filter((design) => isDeliverableStage(design.stage) && design.stage !== "concepts");
  const waiting = staged.filter((design) => latestOf(design)?.status !== "approved");
  const blocking = designs.filter((design) => isDeliverableStage(design.stage)).reduce((sum, design) => sum + (design.threads ?? []).filter((thread) => thread.blocking && thread.status === "open").length, 0);
  const openStages = journey.stages.filter((item) => item.stage !== "approval" && item.status !== "done");
  const unconfirmed = journey.ledger?.waiting ?? 0;
  const checks = [
    { ok: !openStages.length, label: openStages.length ? t("Finish {stages}", { stages: openStages.map((item) => t(item.label as never)).join(", ") }) : t("Every design stage is done") },
    { ok: !waiting.length, label: waiting.length ? waiting.length === 1 ? t("1 design waiting for approval") : t("{count} designs waiting for approval", { count: waiting.length }) : t("Every design is approved") },
    { ok: !blocking, label: blocking ? blocking === 1 ? t("1 blocking comment open") : t("{count} blocking comments open", { count: blocking }) : t("No blocking comments") },
    { ok: !unconfirmed, label: unconfirmed ? t("{count} choices waiting for the client's confirmation", { count: unconfirmed }) : t("Every material and design choice is confirmed") },
  ];
  const day = (ymd: string) => { try { return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${ymd}T00:00:00Z`)); } catch { return ymd; } };
  const when = (iso: string) => { try { return new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso)); } catch { return iso; } };
  if (stage?.status === "done") {
    const facts = journey.journey;
    return <div className={styles.signOff}>
      <EmptyState illustration="done" title={facts?.designComplete ? t("Design complete") : t("Design approved")} description={facts?.approvedOn ? [t("Approved {date}", { date: day(facts.approvedOn) }), facts.approvalSigner, facts.approvalMethod ? t(METHOD_LABEL[facts.approvalMethod] ?? facts.approvalMethod as never) : "", facts.approvalAssetName].filter(Boolean).join(" · ") : undefined} />
      {facts?.estimateDueAt ? <p className={styles.muted}>{t("Estimate due {date}", { date: when(facts.estimateDueAt) })}</p> : null}
      {journey.handoff?.problem ? <InlineNotice tone="info" message={journey.handoff.problem} /> : null}
    </div>;
  }
  return <div className={styles.signOff}>
    <ul>{checks.map((check) => <li key={check.label} data-ok={check.ok || undefined}>{check.ok ? <CircleCheck aria-hidden="true" size={16} /> : <CircleDashed aria-hidden="true" size={16} />}{check.label}</li>)}</ul>
    {canReview && stage?.status === "active" ? <>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <FormSection title={t("Client's approval")}>
        <DateField isRequired label={t("Approved on")} maxValue={parseDate(today)} value={approvedOn ? parseDate(approvedOn) : null} onChange={(date) => setApprovedOn(date?.toString() ?? "")} />
        <TextInput isRequired label={t("Signed by")} maxLength={200} value={signer} onChange={setSigner} />
        <SelectField isRequired label={t("How")} items={["signed_document", "email", "in_person", "message"].map((id) => ({ id, label: t(METHOD_LABEL[id]) }))} selectedKey={method} onSelectionChange={(key) => setMethod(String(key))} />
        {file ? <p className={styles.muted}>{t("Signed approval: {name}", { name: file.name })}</p>
          : <AssetUpload workspaceId={data.workspaceId} caseId={data.caseId} multiple={false} label={t("Attach the signed approval")} onBusy={setUploading} onError={setError} onUploaded={setFile} />}
        <TextAreaField label={t("Note · optional")} value={note} onChange={setNote} />
      </FormSection>
      <div className={styles.signOffAction}><Button size="compact" variant="primary" isLoading={busy} isDisabled={checks.some((check) => !check.ok) || !approvedOn || !signer.trim() || !file || uploading}
        onPress={() => file && onSignOff({ note: note.trim() || null, approvedOn, signer: signer.trim(), method, assetId: file.id })}>{t("Record the approval")}</Button></div>
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
  const add = (list: File[]) => setFiles((current) => [...current, ...list.filter((file) => file.type.startsWith("image/") || file.type === "application/pdf").map((file) => ({ key: crypto.randomUUID(), file, title: file.name.replace(/\.[^.]+$/, "").slice(0, 240), documentType: STAGE_DOCUMENT_TYPE[stage] ?? "Other" }))].slice(0, 20));
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
      <FileUploader appearance="button" accept="image/*,application/pdf" label={t("Choose images or PDFs")} onFiles={add} />
      {files.length ? <ul className={styles.pending}>{files.map((pending) => <li key={pending.key}>
        <TextInput label={<VisuallyHidden>{t("Title of {name}", { name: pending.file.name })}</VisuallyHidden>} value={pending.title} maxLength={240} onChange={(title) => setFiles((current) => current.map((item) => item.key === pending.key ? { ...item, title } : item))} />
        <Button size="compact" variant="quiet" aria-label={t("Remove {name}", { name: pending.title })} onPress={() => setFiles((current) => current.filter((item) => item.key !== pending.key))}>{t("Remove")}</Button>
      </li>)}</ul> : null}
    </div>
  </CaseModal>;
}

