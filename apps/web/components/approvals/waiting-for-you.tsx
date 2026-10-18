"use client";

import { useId, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, DataGrid, EmptyState, ErrorState, InlineNotice, SegmentedControl, TextAreaField, useDesignSystem, usePageToolbarSlot, type DataGridColumn, FormDialog } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { APPROVAL_FILTERS, OTHER_LABEL, approvalsApi, approveLabel, approvalHeading, approvalTitle, filterRows, waitingSince, type ApprovalGroup, type ApprovalRow, type WaitingForYou } from "@/lib/approvals/approvals";
import { playFeedback } from "@/lib/feedback/sounds";
import styles from "./waiting-for-you.module.css";
import { APPROVALS_CHANGED, WAITING_SCOPES } from "./use-waiting-count";
import { useLiveInvalidate } from "@/lib/workspace/live-events";
import { cardTitle } from "@/components/woddy/woddy-action-card";
import { siteApi } from "@/lib/site/client";

type Pending = { row: ApprovalRow; decision: "approve" | "return" | "reject" };

/**
 * Everything waiting for this person across the modules: design reviews, quotes, payments, deals, orders,
 * factory output, site reports, stock and finance. Decided in the row (with a note where the module asks for one) or
 * opened for the evidence. Only what they may decide counts; their own work shows who else decides.
 */
const subscribeMinute = (notify: () => void) => { const timer = window.setInterval(notify, 60_000); return () => window.clearInterval(timer); };
const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;
// The server's clock is not the browser's: "Waiting for" is filled in once the page runs, so the two always match.
const noClockOnServer = () => null;

export function WaitingForYouList({ workspaceId, initial, initialError }: { workspaceId: string; initial: WaitingForYou | null; initialError?: string }) {
  const t = useT();
  const pageSlot = usePageToolbarSlot();
  const slotId = useId();
  if (pageSlot && (pageSlot.owner.current === null || pageSlot.owner.current === slotId)) pageSlot.owner.current = slotId;
  const slotElement = pageSlot && pageSlot.owner.current === slotId ? pageSlot.element : null;
  const router = useRouter();
  const { locale } = useDesignSystem();
  const api = useMemo(() => approvalsApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<WaitingForYou | null>(initial);
  const [loadError, setLoadError] = useState(initialError ?? "");
  const [filter, setFilter] = useState<"all" | ApprovalGroup>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const now = useSyncExternalStore(subscribeMinute, currentMinute, noClockOnServer);

  const reload = async () => {
    setLoadError("");
    try { setState(await api.mine()); } catch (cause) { setLoadError(cause instanceof Error ? cause.message : t("What's waiting for you could not be loaded.")); }
  };
  // Something submitted or decided elsewhere shows up without a refresh.
  useLiveInvalidate(workspaceId, WAITING_SCOPES, () => { if (!busy && !pending) void reload(); }, 1_500);
  const decide = async (row: ApprovalRow, decision: Pending["decision"], note = "") => {
    setBusy(`${row.kind}:${row.id}`); setError(""); setDone("");
    try {
      setState(await api.decide(row, decision, note));
      window.dispatchEvent(new Event(APPROVALS_CHANGED));
      // The same word as the button that was pressed: verified, approved (and sent), refused or sent back.
      const name = approvalTitle(row, locale);
      setDone(decision === "reject" ? t("{name} refused.", { name }) : decision !== "approve" ? t("{name} sent back.", { name })
        : row.kind === "receipt" ? t("{name} verified.", { name })
          : row.kind === "site_report" ? t("{name} approved and sent to the client.", { name }) : t("{name} approved.", { name }));
      if (decision === "approve") playFeedback("approve");
      setPending(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("The decision could not be saved.")); }
    finally { setBusy(null); }
  };

  if (loadError && !state) return <ErrorState title={t("What's waiting for you didn't load")} description={loadError} onRetry={() => void reload()} />;
  const rows = filterRows(state?.rows ?? [], filter);
  const money = (row: ApprovalRow) => {
    if (row.amount === null) return "";
    if (!row.currency) return row.amount;
    try { return new Intl.NumberFormat(locale, { style: "currency", currency: row.currency }).format(Number(row.amount)); } catch { return `${row.currency} ${row.amount}`; }
  };
  // A row says what deciding it does, then the record ("Verify payment · On handover"); a server phrase (an AI app's
  // change, a milestone to invoice) reads in the person's language.
  const title = (row: ApprovalRow) => row.phrase?.key ? cardTitle(t, { title: row.phrase, summary: row.title }) : approvalHeading(t, row, locale);
  const columns: DataGridColumn<ApprovalRow>[] = [
    { id: "what", header: t("Waiting"), size: 280, accessorFn: (row) => title(row), meta: { primary: true, renderCell: (row) => <span className={styles.what} data-preview={row.preview ? "" : undefined}>
      {/* A daily report shows its lead photo and the client's words, so it can be approved and sent from here. */}
      {row.preview?.photoId && row.parentId ? <img className={styles.thumb} src={siteApi(workspaceId, row.parentId).photoUrl(row.preview.photoId)} alt="" loading="lazy"
        onError={(event) => { event.currentTarget.hidden = true; }} /> : null}
      <span className={styles.whatText}>
        <span>{title(row)}</span>
        {/* E3: decided as cover for someone away, or after it waited past the escalation time; a changed amount shows old → new. */}
        {row.cover ? <span className={styles.muted}>{row.cover.via === "delegate" ? t("Covering for someone away") : t("Escalated to you")}</span> : null}
        {row.change ? <span className={styles.muted}>{t("Changed from {from} to {to}", { from: money({ ...row, amount: row.change.from }), to: money({ ...row, amount: row.change.to }) })}</span> : null}
        {row.preview?.text ? <span className={styles.preview} dir="auto">{row.preview.text}</span> : null}
        {row.preview?.photos ? <span className={styles.muted}>{row.preview.photos === 1 ? t("1 photo") : t("{count} photos", { count: row.preview.photos })}</span> : null}
      </span>
    </span> } },
    { id: "about", header: t("About"), size: 160, accessorFn: (row) => row.subject ?? "", meta: { mobileHidden: true } },
    { id: "project", header: t("Project"), size: 170, accessorFn: (row) => row.project ? [row.project.reference, row.project.name].filter(Boolean).join(" · ") : "", meta: { mobileHidden: true } },
    { id: "amount", header: t("Amount"), size: 110, accessorFn: (row) => money(row), meta: { align: "end" } },
    { id: "since", header: t("Waiting for"), size: 100, accessorFn: (row) => row.since,
      meta: { renderCell: (row) => (now === null ? "" : waitingSince(row.since, new Date(now), locale)) } },
    { id: "decide", header: t("Decide"), size: 220, accessorFn: () => "", enableSorting: false, meta: { align: "end", renderCell: (row) => <span className={styles.actions} onClick={(event) => event.stopPropagation()}>
      {!row.canDecide ? <span className={styles.muted}>{t("Someone else decides")}</span>
        : row.decide ? <>
          {row.decide.other ? <Button size="compact" isDisabled={Boolean(busy)} onPress={() => setPending({ row, decision: row.decide!.other! })}>{t(OTHER_LABEL[row.decide.other])}</Button> : null}
          <Button size="compact" variant="primary" isLoading={busy === `${row.kind}:${row.id}`} isDisabled={Boolean(busy) && busy !== `${row.kind}:${row.id}`}
            onPress={() => (row.decide!.approveNeedsNote ? setPending({ row, decision: "approve" }) : void decide(row, "approve"))}>{t(approveLabel(row.kind))}</Button>
        </> : <Button size="compact" onPress={() => router.push(row.href)}>{t("Open")}</Button>}
    </span> } },
  ];
  const counts = state?.counts;
  // The filter sits at the end of the page's tabs row when there is one, so the page has a single navigation row.
  const filterControl = <SegmentedControl label={t("Show")} value={filter} onChange={(value) => setFilter(value as "all" | ApprovalGroup)}
      options={APPROVAL_FILTERS.filter((item) => item.id === "all" || (state?.rows ?? []).some((row) => row.group === item.id))
        .map((item) => ({ id: item.id, label: t(item.label), count: item.id === "all" ? state?.count ?? 0 : counts?.[item.id] ?? 0 }))} />;
  return <div className={styles.list}>
    {slotElement ? createPortal(filterControl, slotElement) : filterControl}
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {done ? <InlineNotice tone="success" message={done} /> : null}
    {rows.length ? <DataGrid ariaLabel={t("Waiting for you")} wrapText columns={columns} data={rows} getRowId={(row) => `${row.kind}:${row.id}`}
      onRowAction={(row) => router.push(row.href)} selectable={false} rowNumbers={false} showToolbar={false} pageSize={50} />
      : <EmptyState illustration="done" title={t("Nothing waiting for you")} description={t("Quotes, payments, deals, orders and reports that need you appear here.")} />}
    {pending ? <DecisionNote pending={pending} busy={Boolean(busy)} onClose={() => setPending(null)} onSave={(note) => void decide(pending.row, pending.decision, note)} /> : null}
  </div>;
}

/** A return, a refusal or an approval that needs its reason: one note, then the decision. */
function DecisionNote({ pending, busy, onClose, onSave }: { pending: Pending; busy: boolean; onClose: () => void; onSave: (note: string) => void }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [note, setNote] = useState("");
  const approve = pending.decision === "approve";
  const label = approve ? t("Approve") : t(OTHER_LABEL[pending.decision as "return" | "reject"]);
  return <FormDialog size="md" title={`${label} · ${approvalTitle(pending.row, locale)}`} onClose={onClose} isSubmitting={busy} isSubmitDisabled={!note.trim()} submitLabel={label} onSubmit={() => onSave(note.trim())}>
    <TextAreaField label={approve ? t("Why it's approved") : t("What needs to change")} isRequired value={note} onChange={setNote} maxLength={1000} />
  </FormDialog>;
}
