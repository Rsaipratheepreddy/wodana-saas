"use client";

import { FileText } from "lucide-react";
import { useState } from "react";
import { Button, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalDrawings } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import { StateLabel } from "../portal-labels";
import styles from "../portal.module.css";
import { AttachFiles } from "../forms/attach-files";
import { ConfirmCode } from "./confirm-code";

/**
 * The technical drawings the team sent (PLM-059): the client opens each drawing, then approves them (production can
 * start) or says what to change, confirmed with a code.
 */
export function DrawingsSheet({ drawings, caseId, api, format, channels, onDecided }: {
  drawings: PortalDrawings; caseId: string; api: PortalApi; format: PortalFormat; channels: Array<"whatsapp" | "email">; onDecided: () => void;
}) {
  const t = useT();
  const [decision, setDecision] = useState<"accept" | "changes" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [uploads, setUploads] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [id] = useState(commandId);
  if (decision && confirming) return <ConfirmCode api={api} channels={channels} purpose={`drawings:${caseId}:${drawings.id}:${decision}`}
    confirmLabel={decision === "accept" ? t("Approve the drawings") : t("Send")} onBack={() => setConfirming(false)}
    onConfirm={async (proof) => {
      await api.command(id, { action: "drawings_decision", caseId, revisionId: drawings.id, decision, note: note.trim(), uploadIds: uploads, ...proof });
      onDecided();
    }} />;
  return <div className={styles.sheet}>
    <div className={styles.rowHead}><StateLabel state={drawings.status} canDecide={drawings.canDecide} /><span className={styles.muted}>{format.date(drawings.sentAt)}</span></div>
    <ul className={styles.list}>
      {drawings.files.map((file) => <li className={styles.item} key={file.id}>
        <a className={styles.itemText} href={api.file("drawing", file.id)} rel="noreferrer" target="_blank">
          <span className={styles.fileName}><FileText aria-hidden="true" size={16} /> {file.name}</span>
        </a>
      </li>)}
    </ul>
    {drawings.status !== "sent" && drawings.decidedOn ? <p className={styles.muted}>{t("{name} decided on {date}.", { name: drawings.decidedBy ?? "", date: format.date(drawings.decidedOn) })}</p> : null}
    {drawings.note && drawings.status !== "sent" ? <p className={styles.body}>{drawings.note}</p> : null}
    {drawings.canDecide ? <>
      {decision === "changes" ? <TextAreaField label={t("What would you like changed?")} value={note} onChange={setNote} maxLength={1000} isRequired autoFocus /> : null}
      {decision === "changes" ? <AttachFiles caseId={caseId} api={api} onChange={setUploads} onBusy={setUploading} /> : null}
      <div className={styles.choices}>
        {decision ? <>
          <Button onPress={() => { setDecision(null); setNote(""); }}>{t("Back")}</Button>
          <Button variant="primary" isDisabled={(decision === "changes" && !note.trim()) || uploading} onPress={() => setConfirming(true)}>{t("Continue")}</Button>
        </> : <>
          <Button onPress={() => setDecision("changes")}>{t("Ask for changes")}</Button>
          <Button variant="primary" onPress={() => { setDecision("accept"); setConfirming(true); }}>{t("Approve the drawings")}</Button>
        </>}
      </div>
    </> : null}
  </div>;
}
