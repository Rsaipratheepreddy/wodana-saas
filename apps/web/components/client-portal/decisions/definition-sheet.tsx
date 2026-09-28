"use client";

import { Fragment, useState } from "react";
import { Button, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalDefinition } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import { StateLabel } from "../portal-labels";
import styles from "../portal.module.css";
import { AttachFiles } from "../forms/attach-files";
import { ConfirmCode } from "./confirm-code";

/** What the client asked for, written down before the quotation: they confirm it, or say what's missing. */
export function DefinitionSheet({ definition, caseId, api, format, channels, onDecided }: {
  definition: PortalDefinition; caseId: string; api: PortalApi; format: PortalFormat; channels: Array<"whatsapp" | "email">; onDecided: () => void;
}) {
  const t = useT();
  const [decision, setDecision] = useState<"accept" | "changes" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [uploads, setUploads] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [id] = useState(commandId);
  const brief: Array<[string, string]> = [
    [t("Goals"), definition.brief.goals], [t("Property"), definition.brief.propertyType], [t("Location"), definition.brief.location], [t("Area"), definition.brief.area],
    [t("Timeline"), definition.brief.timeline], [t("Preferences"), definition.brief.preferences], [t("Keeping"), definition.brief.retainedItems],
    [t("Not included"), definition.brief.exclusions], [t("Constraints"), definition.brief.constraints],
  ];
  if (decision && confirming) return <ConfirmCode api={api} channels={channels} purpose={`definition:${caseId}:${definition.id}:${decision}`}
    confirmLabel={decision === "accept" ? t("Confirm") : t("Send")} onBack={() => setConfirming(false)}
    onConfirm={async (proof) => { await api.command(id, { action: "definition_decision", caseId, baselineId: definition.id, decision, note: note.trim(), uploadIds: decision === "changes" ? uploads : [], ...proof }); onDecided(); }} />;
  return <div className={styles.sheet}>
    <div className={styles.rowHead}><StateLabel state={definition.status} />{definition.publishedAt ? <span className={styles.muted}>{format.date(definition.publishedAt)}</span> : null}</div>
    {definition.message ? <p className={styles.body}>{definition.message}</p> : null}
    <dl className={styles.facts}>{brief.filter(([, value]) => value).map(([label, value]) => <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>)}</dl>
    {definition.items.length ? <ul className={styles.list}>{definition.items.map((item, index) => <li className={styles.item} key={`${item.title}-${index}`}>
      <span className={styles.itemText}><span className={styles.itemTitle}>{item.title}</span>
        <span className={styles.itemMeta}>{[item.room, item.quantity !== null ? `${format.number(item.quantity)} ${item.unit}` : "", item.requirement].filter(Boolean).join(" · ")}</span></span>
    </li>)}</ul> : null}
    {definition.canDecide ? <>
      {decision === "changes" ? <><TextAreaField label={t("What's missing or wrong?")} value={note} onChange={setNote} maxLength={5000} isRequired autoFocus />
        <AttachFiles caseId={caseId} api={api} onChange={setUploads} onBusy={setUploading} /></> : null}
      <div className={styles.choices}>
        {decision ? <>
          <Button onPress={() => { setDecision(null); setNote(""); }}>{t("Back")}</Button>
          <Button variant="primary" isDisabled={(decision === "changes" && !note.trim()) || uploading} onPress={() => setConfirming(true)}>{t("Continue")}</Button>
        </> : <>
          <Button onPress={() => setDecision("changes")}>{t("Ask for changes")}</Button>
          <Button variant="primary" onPress={() => { setDecision("accept"); setConfirming(true); }}>{t("Confirm")}</Button>
        </>}
      </div>
    </> : null}
  </div>;
}
