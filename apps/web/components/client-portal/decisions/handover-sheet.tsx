"use client";

import { FileText } from "lucide-react";
import { useState } from "react";
import { Button, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalHandover } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import { StateLabel } from "../portal-labels";
import styles from "../portal.module.css";
import { ConfirmCode } from "./confirm-code";

/**
 * The handover pack as issued: what the client receives. They accept it (listing anything still to finish,
 * one per line) or say why not yet; accepting starts their warranty.
 */
export function HandoverSheet({ pack, caseId, api, format, channels, onDecided }: {
  pack: PortalHandover; caseId: string; api: PortalApi; format: PortalFormat; channels: Array<"whatsapp" | "email">; onDecided: () => void;
}) {
  const t = useT();
  const [decision, setDecision] = useState<"accept" | "refuse" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState("");
  const [id] = useState(commandId);
  if (decision && confirming) return <ConfirmCode api={api} channels={channels} purpose={`handover:${caseId}:${pack.id}:${decision}`}
    confirmLabel={decision === "accept" ? t("Accept handover") : t("Send")} onBack={() => setConfirming(false)}
    onConfirm={async (proof) => {
      await api.command(id, { action: "handover_decision", caseId, packId: pack.id, decision, ...proof,
        ...(decision === "accept" ? { outstanding: text.split("\n").map((line) => line.trim()).filter(Boolean) } : { reason: text.trim() }) });
      onDecided();
    }} />;
  return <div className={styles.sheet}>
    <div className={styles.rowHead}><StateLabel state={pack.status} /><span className={styles.muted}>{format.date(pack.issuedAt)}</span></div>
    {pack.areas.length ? <p className={styles.muted}>{pack.areas.join(" · ")}</p> : null}
    <ul className={styles.list}>
      {pack.documents.map((document) => <li className={styles.item} key={document.id}>
        <a className={styles.itemText} href={api.file("handover", document.id)} rel="noreferrer" target="_blank">
          <span className={styles.fileName}><FileText aria-hidden="true" size={16} /> {document.title}</span>
        </a>
      </li>)}
    </ul>
    {pack.status !== "issued" && pack.decidedOn ? <p className={styles.muted}>{t("{name} decided on {date}.", { name: pack.decidedBy ?? "", date: format.date(pack.decidedOn) })}</p> : null}
    {pack.note && pack.status !== "issued" ? <p className={styles.body}>{pack.note}</p> : null}
    {pack.canDecide ? <>
      {decision ? <TextAreaField label={decision === "accept" ? t("Anything still to finish? One per line (optional)") : t("What needs fixing first?")} value={text}
        onChange={setText} maxLength={decision === "accept" ? 9000 : 1000} isRequired={decision === "refuse"} autoFocus /> : null}
      <div className={styles.choices}>
        {decision ? <>
          <Button onPress={() => { setDecision(null); setText(""); }}>{t("Back")}</Button>
          <Button variant="primary" isDisabled={decision === "refuse" && !text.trim()} onPress={() => setConfirming(true)}>{t("Continue")}</Button>
        </> : <>
          <Button onPress={() => setDecision("refuse")}>{t("Not yet")}</Button>
          <Button variant="primary" onPress={() => setDecision("accept")}>{t("Accept handover")}</Button>
        </>}
      </div>
    </> : null}
  </div>;
}
