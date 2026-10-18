"use client";

import { useRef, useState } from "react";
import { today, type CalendarDate } from "@internationalized/date";
import { Badge, Button, Checkbox, DateField, InlineNotice, SelectField, TextAreaField, TextInput, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { caseRequest, type CaseAsset, type CaseContent, type CaseDesign, type CaseRoom, type DesignOptions } from "@/lib/pre-project/content";
import { DESIGN_STATUS_LABEL, DELIVERABLE_STAGES, designStatusTone, latestOf } from "@/lib/pre-project/design-workspace";
import { RoomField } from "./room-manager";
import styles from "./design-workspace.module.css";

type Mode = null | "review" | "send_back" | "present" | "client_approved" | "client_changes" | "details";
const SOURCES = [{ id: "meeting", label: tKey("In a meeting") }, { id: "email", label: tKey("By email") }, { id: "phone", label: tKey("By phone") }, { id: "document", label: tKey("Signed document") }];
const STAGE_LABELS: Record<string, MessageKey> = { space_planning: tKey("Space planning"), concepts: tKey("Concepts"), material_selection: tKey("Material selection"), renders: tKey("3D renders") };

/**
 * The review steps for a design's latest revision, shown beside the drawing: send for review,
 * approve or send back, present to the client, record the client's decision, upload a revision.
 * Each step is offered only to people allowed to take it.
 */
export function DesignActions({ data, design, options, onUpdate, onRoomAdded }: { data: CaseContent; design: CaseDesign; options: DesignOptions; onUpdate: (design: CaseDesign) => void; onRoomAdded?: (room: CaseRoom) => void }) {
  const t = useT();
  const { timeZone } = useDesignSystem();
  const latest = latestOf(design);
  const [mode, setMode] = useState<Mode>(null);
  const [note, setNote] = useState("");
  const [reviewer, setReviewer] = useState<string | null>(options.reviewers.length === 1 ? options.reviewers[0].id : null);
  const [confirmed, setConfirmed] = useState(false);
  const [dueOn, setDueOn] = useState<CalendarDate>(() => today(timeZone).add({ days: 7 }));
  const [clientName, setClientName] = useState("");
  const [source, setSource] = useState("meeting");
  const [decidedOn, setDecidedOn] = useState<CalendarDate>(() => today(timeZone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(design.title);
  const [roomId, setRoomId] = useState<string | null>(design.roomId);
  const [stage, setStage] = useState<string | null>(design.stage ?? null);
  if (!latest) return null;
  const status = latest.status;
  const writable = data.canEdit && !design.archivedAt;
  const isReviewer = options.canReview && (!latest.reviewerId || latest.reviewerId === options.actorId);
  const used = design.clientRoundsUsed ?? 0;
  const included = latest.includedClientRounds ?? null;
  const overRounds = included !== null && used >= included;
  const reviewerName = options.reviewers.find((item) => item.id === latest.reviewerId)?.name;

  const open = (next: Mode) => { setMode(next); setNote(""); setError(""); setRequestId(crypto.randomUUID()); };
  const send = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true); setError("");
    try {
      onUpdate(await caseRequest<CaseDesign>(data.workspaceId, data.caseId, `designs/${design.id}/activity`, "POST", { id: requestId, version: design.version, versionId: latest.id, action, note: note.trim(), decisionBy: "", ...extra }));
      setMode(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(false); }
  };
  // A decision recorded for today is stamped now; an earlier day at midday (never before the upload).
  const decisionAt = () => decidedOn.compare(today(timeZone)) === 0 ? new Date().toISOString() : new Date(`${decidedOn.toString()}T12:00:00`).toISOString();
  const uploadRevision = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const body = new FormData(); body.append("file", file);
      const asset = await caseRequest<CaseAsset>(data.workspaceId, data.caseId, `assets/${crypto.randomUUID()}`, "POST", body);
      onUpdate(await caseRequest<CaseDesign>(data.workspaceId, data.caseId, `designs/${design.id}/versions`, "POST", { id: crypto.randomUUID(), version: design.version, assetId: asset.id, note: "" }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not upload.")); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  };

  // Title, room and stage; room and stage lock once the file has entered review (a new revision reopens them).
  const saveDetails = async (archived = false) => {
    if (!title.trim()) { setError(t("Give the design a title.")); return; }
    setBusy(true); setError("");
    try {
      onUpdate(await caseRequest<CaseDesign>(data.workspaceId, data.caseId, "designs", "PUT", { id: design.id, version: design.version, title: title.trim(), documentType: design.documentType, description: design.description ?? "", roomId, scopeEntryId: design.scopeEntryId ?? null, folderId: design.folderId ?? null, stage, archived }));
      setMode(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(false); }
  };
  const locked = status !== "draft";
  const steps: React.ReactNode[] = [];
  // PLM-145: an internal review only where the package has one; otherwise the designer presents the draft to the client.
  const reviewed = options.internalReview !== false;
  if (writable && status === "draft" && reviewed) steps.push(<Button key="review" size="compact" variant="primary" onPress={() => open("review")}>{t("Send for review")}</Button>);
  if (status === "internal_review" && isReviewer) steps.push(<Button key="approve" size="compact" variant="primary" isLoading={busy && mode === null} onPress={() => void send("internal_approved")}>{t("Approve")}</Button>, <Button key="back" size="compact" onPress={() => open("send_back")}>{t("Send back")}</Button>);
  if (writable && (status === "internal_approved" || (status === "draft" && !reviewed))) steps.push(<Button key="present" size="compact" variant="primary" onPress={() => open("present")}>{t("Present to client")}</Button>);
  if (status === "client_review" && options.canRecordClient) steps.push(<Button key="yes" size="compact" variant="primary" onPress={() => open("client_approved")}>{t("Client approved")}</Button>, <Button key="no" size="compact" onPress={() => open("client_changes")}>{t("Client wants changes")}</Button>);
  if (writable) steps.push(<Button key="details" size="compact" variant="quiet" onPress={() => { setTitle(design.title); setRoomId(design.roomId); setStage(design.stage ?? null); open("details"); }}>{t("Edit details")}</Button>);
  if (writable && ["approved", "changes_requested", "rejected", "expired"].includes(status)) steps.push(<Button key="revision" size="compact" variant={status === "approved" ? "secondary" : "primary"} isLoading={busy} onPress={() => fileInput.current?.click()}>{t("Upload revision")}</Button>);

  return <section className={styles.actions} aria-label={t("Review")}>
    <div className={styles.actionsHead}>
      <Badge tone={designStatusTone(status)}>{t((DESIGN_STATUS_LABEL[status] ?? status) as never)}</Badge>
      <span className={styles.muted}>R{latest.number}{status === "internal_review" && reviewerName ? ` · ${reviewerName}` : ""}{included !== null ? ` · ${t("Client rounds {used} of {included}", { used, included })}` : ""}</span>
    </div>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {mode === null ? steps.length ? <div className={styles.actionRow}>{steps}</div> : null : null}
    <input ref={fileInput} type="file" accept="image/*,application/pdf" hidden onChange={(event) => void uploadRevision(event.target.files?.[0])} />

    {mode === "details" ? <div className={styles.actionForm}>
      <TextInput isRequired label={t("Title")} maxLength={240} value={title} onChange={setTitle} />
      <RoomField data={data} value={roomId} isDisabled={locked} onChange={(room) => setRoomId(room.id)} onRoomAdded={(room) => onRoomAdded?.(room)} />
      <SelectField label={t("Stage")} isDisabled={locked} items={DELIVERABLE_STAGES.map((id) => ({ id, label: t(STAGE_LABELS[id]) }))} selectedKey={stage} onSelectionChange={(key) => setStage(key ? String(key) : null)} />
      <div className={styles.actionRow}>
        <Button size="compact" variant="quiet" isDisabled={busy} onPress={() => void saveDetails(true)}>{t("Archive")}</Button>
        <span className={styles.spacer} />
        <Button size="compact" onPress={() => setMode(null)} isDisabled={busy}>{t("Cancel")}</Button>
        <Button size="compact" variant="primary" isLoading={busy} onPress={() => void saveDetails()}>{t("Save")}</Button>
      </div>
    </div> : null}

    {mode === "review" ? <div className={styles.actionForm}>
      <SelectField label={t("Reviewer")} items={options.reviewers.map((item) => ({ id: item.id, label: item.name }))} selectedKey={reviewer} onSelectionChange={(key) => setReviewer(key ? String(key) : null)} />
      <Checkbox isSelected={confirmed} onChange={setConfirmed}>{t("The file shows the right room and stage")}</Checkbox>
      <div className={styles.actionRow}><Button size="compact" onPress={() => setMode(null)} isDisabled={busy}>{t("Cancel")}</Button><Button size="compact" variant="primary" isLoading={busy} isDisabled={!reviewer || !confirmed} onPress={() => void send("internal_review", { reviewerId: reviewer, contextConfirmed: true })}>{t("Send for review")}</Button></div>
    </div> : null}

    {mode === "send_back" ? <div className={styles.actionForm}>
      <TextAreaField autoFocus label={t("What needs to change")} value={note} onChange={setNote} />
      <div className={styles.actionRow}><Button size="compact" onPress={() => setMode(null)} isDisabled={busy}>{t("Cancel")}</Button><Button size="compact" variant="primary" isLoading={busy} isDisabled={!note.trim()} onPress={() => void send("changes_requested")}>{t("Send back")}</Button></div>
    </div> : null}

    {mode === "present" ? <div className={styles.actionForm}>
      {overRounds ? <InlineNotice tone="info" message={t("The {included} included client rounds are used. An extra round is chargeable; note the client's agreement.", { included: included ?? 0 })} /> : null}
      <DateField label={t("Client decides by")} value={dueOn} minValue={today(timeZone).add({ days: 1 })} maxValue={today(timeZone).add({ days: 90 })} onChange={(value) => value && setDueOn(value as CalendarDate)} />
      <TextAreaField label={overRounds ? t("Extra round agreed by the client") : t("Note · optional")} value={note} onChange={setNote} />
      <div className={styles.actionRow}><Button size="compact" onPress={() => setMode(null)} isDisabled={busy}>{t("Cancel")}</Button><Button size="compact" variant="primary" isLoading={busy} isDisabled={overRounds && !note.trim()} onPress={() => void send("client_review", { reviewExpiresAt: new Date(`${dueOn.toString()}T23:59:00`).toISOString() })}>{t("Present to client")}</Button></div>
    </div> : null}

    {mode === "client_approved" || mode === "client_changes" ? <div className={styles.actionForm}>
      <TextInput autoFocus isRequired label={t("Client")} maxLength={240} value={clientName} onChange={setClientName} />
      <SelectField label={t("How")} items={SOURCES.map((item) => ({ ...item, label: t(item.label) }))} selectedKey={source} onSelectionChange={(key) => key && setSource(String(key))} />
      <DateField label={t("When")} value={decidedOn} maxValue={today(timeZone)} onChange={(value) => value && setDecidedOn(value as CalendarDate)} />
      <TextAreaField isRequired label={mode === "client_approved" ? t("What the client approved") : t("What the client wants changed")} value={note} onChange={setNote} />
      <div className={styles.actionRow}><Button size="compact" onPress={() => setMode(null)} isDisabled={busy}>{t("Cancel")}</Button><Button size="compact" variant="primary" isLoading={busy} isDisabled={!clientName.trim() || !note.trim()}
        onPress={() => void send(mode === "client_approved" ? "approved" : "changes_requested", { decisionBy: clientName.trim(), decisionSource: source, decisionAt: decisionAt() })}>{t("Record decision")}</Button></div>
    </div> : null}
  </section>;
}
