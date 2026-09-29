"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Checkbox, EmptyState, SegmentedControl, TextAreaField, TextInput, useDesignSystem } from "@/design-system";
import { ProjectPortalControl } from "@/components/client-portal/project-portal-control";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Health, ProjectDetail, StatusUpdate } from "@/lib/project-core/types";
import { siteApi } from "@/lib/site/client";
import { SavedPhotos } from "../purchasing/delivery-photos";
import { useProjectFormat } from "./format";
import { playFeedback } from "@/lib/feedback/sounds";
import styles from "./project-core.module.css";

type Run = (action: string, input?: Record<string, unknown>) => Promise<boolean>;

/**
 * The project manager's status updates: on track, at risk or off track, with one line on why. The latest is
 * the project's status. An update's words (never its status) can be shared with the client in the portal.
 * Each week a client update is drafted from the approved site reports (what was installed, the stage, what's
 * next, photos): the project manager reads it, edits the words if needed, and sends it in one tap.
 */
export function ProjectUpdates({ detail, run, workspaceId, projectId }: { detail: ProjectDetail; run: Run; workspaceId?: string; projectId?: string }) {
  const t = useT();
  const format = useProjectFormat();
  const { locale } = useDesignSystem();
  const [health, setHealth] = useState<Health>(detail.project.health);
  const [note, setNote] = useState("");
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const labels: Record<Health, string> = { on_track: t("On track"), at_risk: t("At risk"), off_track: t("Off track") };
  const open = detail.project.status === "active" || detail.project.status === "on_hold";
  const drafts = detail.updates.filter((update) => update.draft);
  const feed = detail.updates.filter((update) => !update.draft);
  const photos = useMemo(() => (workspaceId && projectId ? siteApi(workspaceId, projectId) : null), [workspaceId, projectId]);
  const post = async () => {
    setBusy(true);
    if (await run("post_update", { health, note: note.trim(), shareWithClient: share && Boolean(note.trim()) })) { setNote(""); setShare(false); }
    setBusy(false);
  };
  return <div className={styles.updates}>
    {workspaceId && projectId ? <ProjectPortalControl workspaceId={workspaceId} projectId={projectId} locale={locale} /> : null}
    {detail.canManage && open ? drafts.map((draft) => <ClientUpdateDraft key={draft.id} update={draft} run={run} photoUrl={photos?.photoUrl} />) : null}
    {detail.canManage && open ? <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void post(); }}>
      <SegmentedControl label={t("Status")} value={health} onChange={(value) => setHealth(value as Health)}
        options={(["on_track", "at_risk", "off_track"] as const).map((id) => ({ id, label: labels[id] }))} />
      <TextInput aria-label={t("Update")} label={null} placeholder={health === "on_track" ? t("What moved this week (optional)") : t("What's wrong, in one line")} value={note} onChange={setNote} />
      <Button type="submit" variant="primary" size="compact" isLoading={busy} isDisabled={health !== "on_track" && !note.trim()}>{t("Post")}</Button>
      <span className={styles.composerShare}><Checkbox isSelected={share} isDisabled={!note.trim()} onChange={setShare}>{t("Share with the client")}</Checkbox></span>
    </form> : null}
    {feed.length ? <ol className={styles.feed} aria-label={t("Updates")}>
      {feed.map((update) => <li key={update.id}>
        {update.kind === "client_update" ? <span><Badge tone="info">{t("Client update")}</Badge></span>
          : <span className={styles.status} data-tone={update.health === "on_track" ? "ok" : update.health === "at_risk" ? "risk" : "off"}>{labels[update.health]}</span>}
        <span className={styles.feedText}>{update.note || <span className={styles.muted}>{t("No note")}</span>}</span>
        {update.photoIds?.length && photos ? <span className={styles.feedShare}><SavedPhotos photos={update.photoIds.map((id, index) => ({ id, name: t("Photo {number}", { number: index + 1 }), byName: update.byName, at: update.at }))}
          url={photos.photoUrl} /></span> : null}
        <small>{update.byName} · {format.when(update.at)}</small>
        {update.kind !== "client_update" && detail.canManage && update.note ? <span className={styles.feedShare}><Checkbox isSelected={Boolean(update.sharedAt)} onChange={(shared) => void run("share_update", { updateId: update.id, shared })}>
          {t("Shared with the client")}</Checkbox></span> : update.sharedAt ? <small>{t("Shared with the client")}</small> : null}
      </li>)}
    </ol> : !drafts.length || !detail.canManage ? <EmptyState illustration={null} title={t("No updates yet")} description={detail.canManage ? t("Post one a week so everyone knows where the project stands.") : undefined} /> : null}
  </div>;
}

/** The week's drafted client update: read it, change the words if needed, then send it (or discard it). */
function ClientUpdateDraft({ update, run, photoUrl }: { update: StatusUpdate; run: Run; photoUrl?: (photoId: string, preview?: boolean) => string }) {
  const t = useT();
  const format = useProjectFormat();
  const [note, setNote] = useState(update.note);
  const [busy, setBusy] = useState<"send" | "discard" | null>(null);
  return <section className={styles.draft} aria-label={t("Client update to approve")}>
    <div className={styles.draftHead}><Badge tone="warning">{t("Draft")}</Badge><strong>{t("Client update")}</strong><span className={styles.muted}>{update.sendsAt
      ? t("Goes to the client by itself {when}", { when: format.when(update.sendsAt) }) : format.when(update.at)}</span></div>
    <TextAreaField label={t("What the client reads")} value={note} onChange={setNote} />
    {update.photoIds?.length && photoUrl ? <SavedPhotos photos={update.photoIds.map((id, index) => ({ id, name: t("Photo {number}", { number: index + 1 }), byName: update.byName, at: update.at }))} url={photoUrl} /> : null}
    <div className={styles.draftActions}>
      <Button size="compact" variant="quiet" isLoading={busy === "discard"} onPress={async () => { setBusy("discard"); await run("discard_client_update", { updateId: update.id }); setBusy(null); }}>{t("Discard")}</Button>
      <Button size="compact" variant="primary" isLoading={busy === "send"} isDisabled={!note.trim()}
        onPress={async () => { setBusy("send"); if (await run("approve_client_update", { updateId: update.id, note: note.trim() })) playFeedback("send"); setBusy(null); }}>{t("Send to client")}</Button>
    </div>
  </section>;
}
