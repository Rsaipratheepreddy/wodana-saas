"use client";

import { useState } from "react";
import { Button, EmptyState, SegmentedControl, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Health, ProjectDetail } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import styles from "./project-core.module.css";

type Run = (action: string, input?: Record<string, unknown>) => Promise<boolean>;

/** The project manager's status updates: on track, at risk or off track, with one line on why. The latest is the project's status. */
export function ProjectUpdates({ detail, run }: { detail: ProjectDetail; run: Run }) {
  const t = useT();
  const format = useProjectFormat();
  const [health, setHealth] = useState<Health>(detail.project.health);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const labels: Record<Health, string> = { on_track: t("On track"), at_risk: t("At risk"), off_track: t("Off track") };
  const post = async () => {
    setBusy(true);
    if (await run("post_update", { health, note: note.trim() })) setNote("");
    setBusy(false);
  };
  return <div className={styles.updates}>
    {detail.canManage ? <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void post(); }}>
      <SegmentedControl label={t("Status")} value={health} onChange={(value) => setHealth(value as Health)}
        options={(["on_track", "at_risk", "off_track"] as const).map((id) => ({ id, label: labels[id] }))} />
      <TextInput aria-label={t("Update")} label={null} placeholder={health === "on_track" ? t("What moved this week (optional)") : t("What's wrong, in one line")} value={note} onChange={setNote} />
      <Button type="submit" variant="primary" size="compact" isLoading={busy} isDisabled={health !== "on_track" && !note.trim()}>{t("Post")}</Button>
    </form> : null}
    {detail.updates.length ? <ol className={styles.feed} aria-label={t("Updates")}>
      {detail.updates.map((update) => <li key={update.id}>
        <span className={styles.status} data-tone={update.health === "on_track" ? "ok" : update.health === "at_risk" ? "risk" : "off"}>{labels[update.health]}</span>
        <span className={styles.feedText}>{update.note || <span className={styles.muted}>{t("No note")}</span>}</span>
        <small>{update.byName} · {format.when(update.at)}</small>
      </li>)}
    </ol> : <EmptyState illustration={null} title={t("No updates yet")} description={detail.canManage ? t("Post one a week so everyone knows where the project stands.") : undefined} />}
  </div>;
}
