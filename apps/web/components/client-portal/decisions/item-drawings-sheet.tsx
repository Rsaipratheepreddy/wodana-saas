"use client";

import { FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, RecordTable, StateChip, TextAreaField, type DataGridColumn, type ItemState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import { signingPurpose } from "@/lib/client-portal/item-drawings";
import type { PortalItemDrawing, PortalItemDrawings } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import styles from "../portal.module.css";
import { ConfirmCode } from "./confirm-code";

const CHIP: Record<PortalItemDrawing["status"], ItemState> = { with_client: "waiting", changes_asked: "returned", signed: "done" };

type Step = { kind: "list" } | { kind: "item"; versionId: string } | { kind: "changes"; versionId: string } | { kind: "sign"; versionIds: string[]; purpose: string }
  | { kind: "confirm-changes"; versionId: string };

/**
 * The shop drawings of each item the team sent (one row per item, its state as one chip): the client opens each
 * drawing, signs one or several at once with a code bound to exactly those, or asks for changes to one. Signing locks
 * the item's sizes and quantity.
 */
export function ItemDrawingsSheet({ drawings, caseId, api, format, channels, onDecided }: {
  drawings: PortalItemDrawings; caseId: string; api: PortalApi; format: PortalFormat; channels: Array<"whatsapp" | "email">; onDecided: () => void;
}) {
  const t = useT();
  const [step, setStep] = useState<Step>({ kind: "list" });
  const [note, setNote] = useState("");
  const [id] = useState(commandId);
  const labels = useMemo(() => ({ with_client: t("Waiting for your signature"), changes_asked: t("Changes asked"), signed: t("Signed") }), [t]);
  const size = (item: PortalItemDrawing) => {
    const parts = [item.width, item.height, item.depth].filter((value): value is string => Boolean(value)).map((value) => format.number(value));
    return parts.length ? `${parts.join(" × ")} ${item.dimensionUnit}` : "";
  };
  const sign = async (versionIds: string[]) => setStep({ kind: "sign", versionIds, purpose: await signingPurpose(caseId, versionIds) });
  const waiting = drawings.items.filter((item) => item.canSign);

  const columns = useMemo<DataGridColumn<PortalItemDrawing>[]>(() => [
    { id: "item", header: t("Item"), accessorFn: (item) => item.title, size: 220, meta: { primary: true, renderCell: (item) => <span className={styles.itemText}>
      <span className={styles.itemTitle}>{item.title}</span>
      <span className={styles.itemMeta}>{[item.area, t("V{number}", { number: item.number }), `${format.number(item.quantity)} ${item.unit}`.trim(), size(item)].filter(Boolean).join(" · ")}</span>
    </span> } },
    { id: "state", header: t("State"), accessorFn: (item) => labels[item.status], size: 200, meta: { renderCell: (item) => <span className={styles.itemText}>
      <span><StateChip state={CHIP[item.status]} label={labels[item.status]} /></span>
      {item.signedAt ? <span className={styles.itemMeta}>{t("{name} signed on {date}", { name: item.signedBy ?? "", date: format.date(item.signedAt) })}</span> : null}
    </span> } },
  ], [format, labels, t]); // eslint-disable-line react-hooks/exhaustive-deps

  if (step.kind === "sign") return <ConfirmCode api={api} channels={channels} purpose={step.purpose}
    confirmLabel={step.versionIds.length === 1 ? t("Sign the drawing") : t("Sign {count} drawings", { count: step.versionIds.length })} onBack={() => setStep({ kind: "list" })}
    onConfirm={async (proof) => {
      await api.command(id, { action: "item_drawings_sign", caseId, versionIds: step.versionIds, device: typeof navigator === "undefined" ? "" : navigator.userAgent, ...proof });
      onDecided();
    }} />;
  if (step.kind === "confirm-changes") return <ConfirmCode api={api} channels={channels} purpose={`item_drawing:${caseId}:${step.versionId}:changes`}
    confirmLabel={t("Send")} onBack={() => setStep({ kind: "changes", versionId: step.versionId })}
    onConfirm={async (proof) => {
      await api.command(id, { action: "item_drawing_changes", caseId, versionId: step.versionId, note: note.trim(), ...proof });
      onDecided();
    }} />;
  const open = step.kind === "item" || step.kind === "changes" ? drawings.items.find((item) => item.versionId === step.versionId) ?? null : null;
  if (open) return <div className={styles.sheet}>
    <div className={styles.rowHead}><StateChip state={CHIP[open.status]} label={labels[open.status]} /><span className={styles.muted}>{t("V{number}", { number: open.number })}</span></div>
    {/* eslint-disable-next-line @next/next/no-img-element -- private files stay on the portal's own file endpoint. */}
    {open.hasPreview ? <img className={styles.preview} alt={open.title} src={api.file("item_drawing", open.versionId, true)} /> : null}
    <a className="wd-button" data-variant="secondary" data-size="compact" href={api.file("item_drawing", open.versionId)} rel="noreferrer" target="_blank"><FileText aria-hidden="true" size={14} />{open.name}</a>
    <p className={styles.body}>{[`${format.number(open.quantity)} ${open.unit}`.trim(), size(open)].filter(Boolean).join(" · ")}</p>
    {open.note ? <p className={styles.body}>{open.note}</p> : null}
    {step.kind === "changes" ? <TextAreaField label={t("What would you like changed?")} value={note} onChange={setNote} maxLength={1000} isRequired autoFocus /> : null}
    <div className={styles.choices}>
      <Button onPress={() => { setStep({ kind: "list" }); setNote(""); }}>{t("Back")}</Button>
      {open.canSign && step.kind === "item" ? <>
        <Button onPress={() => setStep({ kind: "changes", versionId: open.versionId })}>{t("Ask for changes")}</Button>
        <Button variant="primary" onPress={() => void sign([open.versionId])}>{t("Sign the drawing")}</Button>
      </> : null}
      {step.kind === "changes" ? <Button variant="primary" isDisabled={!note.trim()} onPress={() => setStep({ kind: "confirm-changes", versionId: open.versionId })}>{t("Continue")}</Button> : null}
    </div>
  </div>;
  return <div className={styles.sheet}>
    <RecordTable<PortalItemDrawing> ariaLabel={t("Shop drawings")} wrapText columns={columns} data={drawings.items} getRowId={(item) => item.versionId}
      selectable={waiting.length > 1} rowNumbers={false} showToolbar={false} showFooter={false} pageSize={200}
      onRowAction={(item) => setStep({ kind: "item", versionId: item.versionId })}
      bulkActions={(rows) => {
        const chosen = rows.filter((row) => row.canSign).map((row) => row.versionId);
        return chosen.length ? <Button size="compact" variant="primary" onPress={() => void sign(chosen)}>{t("Sign {count} drawings", { count: chosen.length })}</Button> : null;
      }} />
    {waiting.length ? <div className={styles.choices}>
      <Button variant="primary" onPress={() => void sign(waiting.map((item) => item.versionId))}>
        {waiting.length === 1 ? t("Sign the drawing") : t("Sign all {count}", { count: waiting.length })}</Button>
    </div> : null}
  </div>;
}
