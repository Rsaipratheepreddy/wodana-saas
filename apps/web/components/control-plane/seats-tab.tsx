"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Callout, ErrorState, NumericInput, RecordTable, Skeleton, TextAreaField, EmptyState, type DataGridColumn, FormDialog } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { consoleApi, type SeatsView } from "@/lib/internal/console";
import { useConsoleFormat } from "./labels";
import styles from "./control-plane.module.css";

type Change = SeatsView["history"][number];

/** Seat limit and use. A limit below the seats in use keeps every member and blocks new invites. */
export function SeatsTab({ orgKey, canManage, onChanged }: { orgKey: string; canManage: boolean; onChanged: () => void }) {
  const t = useT();
  const format = useConsoleFormat();
  const [seats, setSeats] = useState<SeatsView | null>(null);
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);
  const load = useCallback(async () => {
    try { setSeats(await consoleApi.seats(orgKey)); setError(""); }
    catch (cause) { setError((cause as Error).message || t("Seats didn't load.")); }
  }, [orgKey, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const columns = useMemo<DataGridColumn<Change>[]>(() => [
    { id: "change", header: t("Limit"), size: 130, accessorFn: (row) => row.to ?? 0, meta: { primary: true, renderCell: (row) =>
      <span className={styles.number}>{row.from !== null && row.to !== null ? t("{from} to {to}", { from: format.number(row.from), to: format.number(row.to) }) : ""}</span> } },
    { id: "reason", header: t("Reason"), size: 300, accessorFn: (row) => row.reason ?? "" },
    { id: "by", header: t("By"), size: 160, accessorFn: (row) => row.createdByName ?? "" },
    { id: "when", header: t("When"), size: 150, accessorFn: (row) => row.createdAt, meta: { renderCell: (row) => format.dateTime(row.createdAt) } },
  ], [format, t]);

  if (error && !seats) return <div className={styles.panel}><ErrorState description={error} onRetry={() => void load()} /></div>;
  if (!seats) return <div className={styles.panel}><Skeleton shape="facts" lines={3} /></div>;
  const { position } = seats;
  return <div className={styles.panel}>
    <div className={styles.toolbar}>
      <dl className={styles.seatFacts}>
        <div><dt>{t("Limit")}</dt><dd>{position.limit === null ? "—" : format.number(position.limit)}</dd></div>
        <div><dt>{t("Members")}</dt><dd>{format.number(position.members)}</dd></div>
        <div><dt>{t("Pending invites")}</dt><dd>{format.number(seats.pendingInvitations)}</dd></div>
        <div><dt>{t("Free")}</dt><dd>{position.available === null ? "—" : format.number(position.available)}</dd></div>
      </dl>
      {canManage ? <div className={styles.toolbarActions}><Button onPress={() => setChanging(true)}>{t("Change limit")}</Button></div> : null}
    </div>
    {position.overLimit ? <Callout tone="warning" title={t("Over the limit")}>{t("Members keep access. New invites are blocked.")}</Callout>
      : position.invitesBlocked ? <Callout tone="info" title={t("Every seat is taken")}>{t("New invites are blocked until a seat frees up.")}</Callout> : null}
    <section className={styles.section} aria-label={t("Changes")}>
      <h2 className={styles.subhead}>{t("Changes")}</h2>
      <RecordTable<Change> ariaLabel={t("Changes")} columns={columns} data={seats.history} getRowId={(row) => row.id}
        emptyContent={<EmptyState illustration={null} title={t("No changes yet")} />} rowNumbers={false} selectable={false} showToolbar={false} showFooter={false} wrapText />
    </section>
    {changing ? <SeatLimitDialog seats={seats} onClose={() => setChanging(false)} onSave={async (seatLimit, reason) => {
      setSeats(await consoleApi.changeSeats(orgKey, { expectedVersion: seats.version, seatLimit, reason }));
      setChanging(false); onChanged();
    }} /> : null}
  </div>;
}

function SeatLimitDialog({ seats, onClose, onSave }: { seats: SeatsView; onClose: () => void; onSave: (limit: number, reason: string) => Promise<void> }) {
  const t = useT();
  const [limit, setLimit] = useState<number>(seats.position.limit ?? seats.position.members);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const valid = Number.isInteger(limit) && limit >= 1 && reason.trim().length >= 10;
  return <FormDialog size="md" title={t("Change limit")} onClose={onClose} error={error || undefined} isSubmitDisabled={!valid} submitLabel={t("Save")} onSubmit={async () => { setError("");
        try { await onSave(limit, reason.trim()); } catch (cause) { setError((cause as Error).message || t("The limit could not be saved.")); }
        finally { }
      }}>
      <NumericInput label={t("Seats")} isRequired minValue={1} value={limit} onChange={(value) => setLimit(value)}
        description={seats.contractSeatLimit ? t("Contract allows {count}", { count: seats.contractSeatLimit }) : undefined} />
      {limit < seats.position.members ? <Badge tone="warning">{t("Below the {count} members: invites stay blocked", { count: seats.position.members })}</Badge> : null}
      <TextAreaField label={t("Reason")} isRequired value={reason} onChange={setReason} description={t("At least 10 characters.")} />
  </FormDialog>;
}
