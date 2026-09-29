"use client";

import { FileText } from "lucide-react";
import { useState } from "react";
import { Button, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalDesign } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import { StateLabel } from "../portal-labels";
import styles from "../portal.module.css";
import { AttachFiles } from "../forms/attach-files";
import { ConfirmCode } from "./confirm-code";

type Decision = "accept" | "changes" | "decline";

/** A design shared for the client's decision, at its exact version: approve, ask for changes, or decline. */
export function DesignSheet({ design, caseId, api, format, channels, onDecided }: {
  design: PortalDesign; caseId: string; api: PortalApi; format: PortalFormat; channels: Array<"whatsapp" | "email">; onDecided: () => void;
}) {
  const t = useT();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [uploads, setUploads] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [id] = useState(commandId);
  const labels: Record<Decision, string> = { accept: t("Approve"), changes: t("Ask for changes"), decline: t("Decline") };
  const image = /^image\//.test(design.mimeType) && design.hasPreview !== false;
  if (decision && confirming) return <ConfirmCode api={api} channels={channels} purpose={`design:${caseId}:${design.id}:${decision}`} confirmLabel={labels[decision]}
    onBack={() => setConfirming(false)}
    onConfirm={async (proof) => { await api.command(id, { action: "design_decision", caseId, versionId: design.id, decision, note: note.trim(), uploadIds: decision === "accept" ? [] : uploads, ...proof }); onDecided(); }} />;
  return <div className={styles.sheet}>
    <div className={styles.rowHead}>
      <StateLabel state={design.status} />
      <span className={styles.muted}>{[design.room, design.item, design.type].filter(Boolean).join(" · ")}</span>
    </div>
    {image
      // eslint-disable-next-line @next/next/no-img-element -- a private file streamed through the portal's signed-in route
      ? <img alt={`${design.title} · V${design.number}`} className={styles.preview} src={api.file("design", design.id)} />
      : <a className={styles.fileName} href={api.file("design", design.id)} rel="noreferrer" target="_blank"><FileText aria-hidden="true" size={16} /> {t("Open the file")}</a>}
    {design.canDecide ? <>
      {design.dueAt ? <p className={styles.muted}>{t("Please decide by {date}", { date: format.date(design.dueAt) })}</p> : null}
      {decision && decision !== "accept" ? <><TextAreaField label={decision === "changes" ? t("What would you like changed?") : t("Why are you declining?")} value={note}
        onChange={setNote} maxLength={5000} isRequired autoFocus /><AttachFiles caseId={caseId} api={api} onChange={setUploads} onBusy={setUploading} /></> : null}
      <div className={styles.choices}>
        {decision ? <>
          <Button onPress={() => { setDecision(null); setNote(""); }}>{t("Back")}</Button>
          <Button variant="primary" isDisabled={(decision !== "accept" && !note.trim()) || uploading} onPress={() => setConfirming(true)}>{t("Continue")}</Button>
        </> : <>
          <Button variant="quiet" onPress={() => setDecision("decline")}>{labels.decline}</Button>
          <Button onPress={() => setDecision("changes")}>{labels.changes}</Button>
          <Button variant="primary" onPress={() => { setDecision("accept"); setConfirming(true); }}>{labels.accept}</Button>
        </>}
      </div>
    </> : null}
  </div>;
}
