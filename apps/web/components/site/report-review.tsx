"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Sparkles, Star } from "lucide-react";
import { Badge, Button, Checkbox, ControlledModalDialog, EditableField, EditableFieldList, ErrorState, FactRow, IconButton, InlineNotice, MoreDetails, Skeleton, Switch, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { SiteApi } from "@/lib/site/client";
import type { ClientView, SiteReport, SiteState } from "@/lib/site/types";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "../purchasing/order-labels";
import { ProgressCard } from "./progress-card";
import styles from "./report-review.module.css";

const PICK_LIMIT = 6;

/** The client's reactions to a sent day, naming the contacts who gave each (a count when the names aren't there). */
function reactionLine(report: SiteReport, t: ReturnType<typeof useT>) {
  const who = (kind: "like" | "love") => report.reactedBy?.[kind]?.length ? report.reactedBy[kind].join(", ") : String(report.reactions?.[kind] ?? 0);
  return t("Client: 👍 {like} · ❤️ {love}", { like: who("like"), love: who("love") });
}

/**
 * The manager's review of a day before anything leaves, on one page: the client's words (edited in place, or
 * rewritten by Woddy), which photos go and which leads, which items the client doesn't see — beside exactly what
 * the client will get. Approve & send, approve and keep it internal, or send it back with what to change.
 * A day already sent reads as it went.
 */
export function ReportReview({ api, state, reportId, onState, onClose, onReject }: {
  api: SiteApi; state: SiteState; reportId: string; onState: (state: SiteState) => void; onClose: () => void;
  onReject: (report: SiteReport, lineId: string, title: string) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const report = state.reports.find((row) => row.id === reportId) ?? null;
  const [preview, setPreview] = useState<{ view: ClientView; sent: boolean } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [returning, setReturning] = useState(false);
  const version = report?.version;
  const loadPreview = useCallback(async () => {
    try {
      const loaded = await api.clientView(reportId);
      if (!loaded?.view?.project) throw new Error(t("The client's view didn't load."));
      setPreview(loaded); setPreviewError("");
    } catch (cause) { setPreviewError(cause instanceof Error ? cause.message : t("The client's view didn't load.")); }
  }, [api, reportId, t]);
  // The preview follows every change to the report (its version).
  useEffect(() => { queueMicrotask(() => void loadPreview()); }, [loadPreview, version]);
  if (!report) return null;

  const sent = report.delivery === "sent";
  const own = report.authorId === state.me;
  const canReview = state.canApprove && !own && !sent && (report.status === "submitted" || report.status === "approved");
  /** One review step through the site's command; true, or why it didn't save. */
  const run = async (action: string, input: Record<string, unknown> = {}, done?: string): Promise<true | string> => {
    setBusy(action); setNotice("");
    try {
      onState(await api.command(action, { reportId: report.id, version: report.version, ...input }));
      if (done) onClose();
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("Could not save.");
      setNotice(message);
      if (cause instanceof Error && "status" in cause && cause.status === 409) onState(await api.state());
      return message;
    } finally { setBusy(null); }
  };
  const picked = report.photos.filter((photo) => photo.forClient);
  const hero = report.heroPhotoId;
  const statusLine = sent
    ? report.sentAutomatically ? t("Went to the client by itself on {date}", { date: format.when(report.sentAt ?? null) })
      : t("Sent to the client on {date} by {name}", { date: format.when(report.sentAt ?? null), name: report.sentByName ?? "" })
    : report.status === "approved" ? report.delivery === "internal" ? t("Approved · kept internal") : t("Approved · not sent yet")
      : report.status === "submitted" ? t("Waiting for your review") : null;

  const footer = <div className={styles.footer}>
    {canReview && report.status === "submitted" ? <Button variant="quiet" isDisabled={Boolean(busy)} onPress={() => setReturning(true)}>{t("Return to supervisor")}</Button> : null}
    <span className={styles.spacer} />
    {report.status === "approved" ? <a className="wd-button" data-size="standard" data-variant="secondary" href={api.printUrl(report.id)} target="_blank" rel="noopener">
      <Download aria-hidden="true" size={15} />{t("Download PDF")}</a> : null}
    <Button onPress={onClose}>{t("Close")}</Button>
    {canReview && report.status === "submitted" ? <>
      <Button isLoading={busy === "approve_hold"} isDisabled={Boolean(busy)} onPress={() => void run("approve_hold", {}, "done")}>{t("Approve without sending")}</Button>
      <Button variant="primary" isLoading={busy === "approve_send"} isDisabled={Boolean(busy)} onPress={() => void run("approve_send", {}, "done")}>{t("Approve & send")}</Button>
    </> : null}
    {canReview && report.status === "approved" ? <Button variant="primary" isLoading={busy === "send"} isDisabled={Boolean(busy)} onPress={() => void run("send", {}, "done")}>{t("Send to the client")}</Button> : null}
  </div>;

  return <ControlledModalDialog isOpen size="xl" title={t("{date} · {name}", { date: format.day(report.reportDate), name: report.authorName })} onOpenChange={(open) => { if (!open) onClose(); }} footer={footer}>
    <div className={styles.review}>
      <section className={styles.controls} aria-label={t("Review")}>
        {statusLine ? <p className={styles.status}>{statusLine}{report.late ? <Badge tone="warning">{t("Late")}</Badge> : null}</p> : null}
        {notice ? <InlineNotice tone="error" message={notice} /> : null}
        <div className={styles.summary}>
          <EditableFieldList layout="stacked">
            <EditableField label={t("What the client reads")} kind="multiline" maxLength={1200} canEdit={canReview} value={report.clientSummary ?? ""}
              placeholder={t("A few words for the client")} onSave={async (summary) => { const result = await run("review", { summary }); if (result !== true) throw new Error(result); }} />
          </EditableFieldList>
          {canReview ? <Button size="compact" variant="quiet" isLoading={busy === "rewrite_summary"} isDisabled={Boolean(busy)} onPress={() => void run("rewrite_summary")}>
            <Sparkles aria-hidden="true" size={14} />{t("Rewrite with Woddy")}</Button> : null}
        </div>

        {report.photos.length ? <fieldset className={styles.group}>
          <legend>{t("Photos for the client")} <span className={styles.muted}>{t("{count} chosen · up to {limit}", { count: picked.length, limit: PICK_LIMIT })}</span></legend>
          <ul className={styles.photos}>{report.photos.map((photo) => <li key={photo.id} data-picked={photo.forClient || undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a private report photo */}
            <img src={api.photoUrl(photo.id)} alt={photo.name} loading="lazy" />
            <div className={styles.photoBar}>
              <Checkbox isDisabled={!canReview || Boolean(busy) || (!photo.forClient && picked.length >= PICK_LIMIT)} isSelected={Boolean(photo.forClient)}
                onChange={(forClient) => void run("review", { photos: [{ id: photo.id, forClient }] })}>{t("Share")}</Checkbox>
              <IconButton aria-label={hero === photo.id ? t("Lead photo") : t("Make it the lead photo")} aria-pressed={hero === photo.id} size="compact" variant="quiet"
                isDisabled={!canReview || Boolean(busy)} onPress={() => void run("review", { heroPhotoId: photo.id })}>
                <Star aria-hidden="true" size={15} className={hero === photo.id ? styles.lead : undefined} fill={hero === photo.id ? "currentColor" : "none"} /></IconButton>
            </div>
          </li>)}</ul>
        </fieldset> : null}

        {(report.tasks?.length || report.next?.length) ? <fieldset className={styles.group}>
          <legend>{t("What the client sees")}</legend>
          <ul className={styles.items}>
            {(report.tasks ?? []).map((task) => <li key={task.id}>
              <Switch isDisabled={!canReview || Boolean(busy)} isSelected={!task.hidden} onChange={(shown) => void run("review", { tasks: [{ id: task.id, hidden: !shown }] })}>
                {task.progress === 100 ? t("{title} · done", { title: task.title }) : t("{title} · {percent}%", { title: task.title, percent: task.progress })}</Switch>
            </li>)}
            {(report.next ?? []).map((item) => <li key={item.id}>
              <Switch isDisabled={!canReview || Boolean(busy)} isSelected={!item.hidden} onChange={(shown) => void run("review", { next: [{ id: item.id, hidden: !shown }] })}>
                {t("Next: {title}", { title: item.title })}</Switch>
            </li>)}
          </ul>
        </fieldset> : null}

        <MoreDetails label={t("From the site")} defaultOpen={!report.photos.length}>
          <EditableFieldList layout="stacked">
            {report.noWorkReason ? <FactRow label={t("No work")}>{report.noWorkReason}</FactRow> : null}
            {report.workforce.length ? <FactRow label={t("Crew")}>{report.workforce.map((row) => row.hours
              ? t("{trade} {people} · {hours} h", { trade: row.trade, people: row.people, hours: Number(row.hours) }) : t("{trade} {people}", { trade: row.trade, people: row.people })).join(" · ")}</FactRow> : null}
            {(report.issues ?? []).length ? <FactRow label={t("Issues")}>{(report.issues ?? []).map((issue) => <span key={issue.id} className={styles.fact}>
              <Badge tone={issue.severity === "critical" ? "danger" : issue.severity === "major" ? "warning" : "neutral"}>{issue.severity === "critical" ? t("Critical") : issue.severity === "major" ? t("Major") : t("Minor")}</Badge>
              {issue.description}{issue.internal ? "" : ` · ${t("the client can read this")}`}{issue.workItemNumber ? ` · #${issue.workItemNumber}` : ""}</span>)}</FactRow> : null}
            {(report.materials ?? []).length ? <FactRow label={t("Materials")}>{(report.materials ?? []).map((item) =>
              `${item.direction === "received" ? t("Received") : t("Used")}: ${item.description}${item.quantity ? ` ${quantityText(item.quantity)} ${item.unit}` : ""}`.trim()).join(" · ")}</FactRow> : null}
            {report.lines.length ? <FactRow label={t("Installed")}>{report.lines.map((line) => <span key={line.id} className={styles.fact}>
              {t("{item}: {quantity} installed", { item: line.title, quantity: `${quantityText(line.installed)} ${line.unit}`.trim() })}
              {report.status === "approved" && state.canApprove && Number(line.installed) > 0
                ? <Button size="compact" variant="quiet" onPress={() => onReject(report, line.id, line.title)}>{t("Not accepted")}</Button> : null}</span>)}</FactRow> : null}
            {report.safety !== "none" ? <FactRow label={t("Safety")}>{`${report.safety === "incident" ? t("Incident") : t("Safety observation")}: ${report.safetyNote}`}</FactRow> : null}
            {report.forecast !== "none" ? <FactRow label={t("Outlook")}>{t("{state}: {impact} ({owner} by {date})", { state: report.forecast === "blocked" ? t("Blocked") : t("At risk"),
              impact: report.impact, owner: report.recoveryOwnerName ?? "", date: format.day(report.recoveryOn) })}</FactRow> : null}
            {report.weather ? <FactRow label={t("Weather")}>{report.weather}</FactRow> : null}
            {report.notes ? <FactRow label={t("Notes for the team")}>{report.notes}</FactRow> : null}
          </EditableFieldList>
        </MoreDetails>
      </section>

      <section className={styles.preview} aria-label={t("What the client gets")}>
        <h3 className={styles.previewTitle}>{sent ? t("What the client got") : t("What the client gets")}</h3>
        {preview ? <ProgressCard card={preview.view} photoUrl={api.photoUrl} formatDay={(day) => format.day(day)} brand={preview.view.brand}
          heading={preview.view.project.progress !== null ? <span className={styles.muted}>{t("{percent}% complete", { percent: preview.view.project.progress })}</span> : null} />
          : previewError ? <ErrorState description={previewError} onRetry={() => void loadPreview()} /> : <Skeleton lines={5} />}
        {sent && report.reactions && (report.reactions.like || report.reactions.love) ? <p className={styles.muted}>{reactionLine(report, t)}</p> : null}
      </section>
    </div>
    {returning ? <ReturnDialog onClose={() => setReturning(false)} onSave={async (note) => { if ((await run("return", { note }, "done")) === true) setReturning(false); }} /> : null}
  </ControlledModalDialog>;
}

function ReturnDialog({ onClose, onSave }: { onClose: () => void; onSave: (note: string) => Promise<void> }) {
  const t = useT();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Return to supervisor")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!note.trim()} onPress={async () => { setBusy(true); await onSave(note.trim()); setBusy(false); }}>{t("Return")}</Button></div>}>
    <TextAreaField label={t("What to change")} isRequired value={note} onChange={setNote} autoFocus />
  </ControlledModalDialog>;
}
