"use client";

import { useState } from "react";
import { Button, SegmentedControl, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalMaterials } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import { StateLabel } from "../portal-labels";
import styles from "../portal.module.css";
import { AttachFiles } from "../forms/attach-files";
import { ConfirmCode } from "./confirm-code";

type Choice = "approved" | "rejected";

/** The material list revision the team sent: the client approves each material, or says what they'd like instead. */
export function MaterialsSheet({ list, caseId, api, format, channels, onDecided }: {
  list: PortalMaterials; caseId: string; api: PortalApi; format: PortalFormat; channels: Array<"whatsapp" | "email">; onDecided: () => void;
}) {
  const t = useT();
  const [choices, setChoices] = useState<Record<string, { decision: Choice | null; note: string }>>(
    () => Object.fromEntries(list.items.map((item) => [item.id, { decision: null, note: "" }])));
  const [confirming, setConfirming] = useState(false);
  const [uploads, setUploads] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [id] = useState(commandId);
  const ready = list.items.every((item) => choices[item.id]?.decision && (choices[item.id].decision === "approved" || choices[item.id].note.trim()));
  const set = (itemId: string, change: Partial<{ decision: Choice; note: string }>) => setChoices((current) => ({ ...current, [itemId]: { ...current[itemId], ...change } }));

  if (confirming) return <ConfirmCode api={api} channels={channels} purpose={`materials:${caseId}:${list.id}:submit`} confirmLabel={t("Send my decision")}
    onBack={() => setConfirming(false)}
    onConfirm={async (proof) => {
      await api.command(id, { action: "materials_decision", caseId, revisionId: list.id, uploadIds: uploads, ...proof,
        decisions: list.items.map((item) => ({ itemId: item.id, decision: choices[item.id].decision, note: choices[item.id].note.trim() })) });
      onDecided();
    }} />;

  return <div className={styles.sheet} data-tour="portal-materials-sheet">
    <div className={styles.rowHead}><StateLabel state={list.status} /><span className={styles.muted}>{t("Sent {date}", { date: format.date(list.sentAt) })}</span></div>
    <div>
      {list.items.map((item) => <div className={styles.materialRow} key={item.id}>
        <div className={styles.rowHead}>
          <strong>{item.name}</strong>
          {item.quantity ? <span className={styles.muted}>{format.number(item.quantity)} {item.unit}</span> : null}
        </div>
        {item.specification ? <p className={styles.body}>{item.specification}</p> : null}
        {item.areas.length ? <p className={styles.muted}>{item.areas.join(" · ")}</p> : null}
        {list.canDecide ? <>
          <SegmentedControl label={t("Decision for {name}", { name: item.name })} value={choices[item.id].decision ?? ""}
            onChange={(value) => set(item.id, { decision: value as Choice })}
            options={[{ id: "approved", label: t("Approve") }, { id: "rejected", label: t("Change it") }]} />
          {choices[item.id].decision === "rejected"
            ? <TextInput label={t("What would you like instead?")} value={choices[item.id].note} onChange={(note) => set(item.id, { note })} maxLength={1000} isRequired /> : null}
        </> : item.decision ? <p className={styles.body}><StateLabel state={item.decision} />{item.note ? ` · ${item.note}` : ""}</p> : null}
      </div>)}
    </div>
    {list.canDecide ? <><AttachFiles caseId={caseId} api={api} onChange={setUploads} onBusy={setUploading} photosOnly /><div className={styles.choices}>
      <Button variant="primary" isDisabled={!ready || uploading} onPress={() => setConfirming(true)}>{t("Continue")}</Button>
    </div></> : list.decidedBy ? <p className={styles.muted}>{t("{name} decided on {date}.", { name: list.decidedBy, date: format.date(list.decidedAt) })}</p> : null}
  </div>;
}
