"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { parseDate } from "@internationalized/date";
import { Plus } from "lucide-react";
import {
  Button, DataGrid, DateField, EmptyState, ErrorState, FileUploader, FormDialog, FormNotSaved, FormSection, InlineNotice, InspectorSheet, MoneyField, NoResultsState, SelectField, TextAreaField, TextInput,
  type DataGridColumn,
  TypeChip,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { pettyCashApi, type PettyCashApi } from "@/lib/petty-cash/client";
import type { PettyCashCategory, PettyCashClaim, ProjectPettyCash as State } from "@/lib/petty-cash/types";
import { currencyDecimals } from "@/lib/purchasing/amounts";
import { useProjectFormat } from "../project-core/format";
import { CATEGORIES, ClaimStatusLabel, useCategoryLabels } from "./petty-cash-labels";
import styles from "./petty-cash.module.css";

const plain = (value: string) => (value.includes(".") ? value.replace(/\.?0+$/, "") : value) || "0";

/**
 * A project's petty cash: what the team spent for it, each claim with its receipt. Everyone sees their own
 * claims; whoever decides sees them all, the ones waiting first. Approved, a claim is a cost of the project.
 */
export function ProjectPettyCash({ workspaceId, projectId, switcher }: { workspaceId: string; projectId: string; /** The Money tab's views, first in the toolbar. */ switcher?: ReactNode }) {
  const t = useT();
  const format = useProjectFormat();
  const api = useMemo(() => pettyCashApi(workspaceId), [workspaceId]);
  const params = useSearchParams();
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(() => params.get("claim"));
  const [editing, setEditing] = useState<PettyCashClaim | "new" | null>(null);
  const load = useCallback(async () => {
    try { setState(await api.project(projectId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Petty cash didn't load.")); }
  }, [api, projectId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const categories = useCategoryLabels();
  const needle = search.trim().toLocaleLowerCase();
  const waiting = useCallback((claim: PettyCashClaim) => Boolean(state?.canApprove) && claim.status === "submitted" && claim.claimedBy !== state?.me, [state]);
  const columns = useMemo<DataGridColumn<PettyCashClaim>[]>(() => [
    { id: "claim", header: t("Claim"), accessorFn: (row) => row.description, size: 320, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.description}</span><small>{[row.reference, format.day(row.spentOn), row.claimedByName].join(" · ")}</small></span> } },
    { id: "package", header: t("Package"), accessorFn: (row) => row.packageName ?? "", size: 180, meta: { mobileHidden: true,
      renderCell: (row) => <span className={styles.nameCell}><span>{row.packageName ?? t("Not in a package")}</span><span><TypeChip typeKey={row.category}>{categories[row.category]}</TypeChip></span></span> } },
    { id: "amount", header: t("Amount"), accessorFn: (row) => Number(row.amount), size: 140, meta: { renderCell: (row) => <span className={styles.money}>{format.money(row.amount, row.currency)}</span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, size: 140, meta: { renderCell: (row) => <ClaimStatusLabel status={row.status} /> } },
  ], [t, format, categories]);
  if (error && !state) return <ErrorState description={error} onRetry={() => void load()} />;
  // The ones waiting for my decision first, then newest first.
  const rows = (state?.claims ?? []).filter((claim) => !needle || `${claim.reference} ${claim.description} ${claim.claimedByName}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) => Number(waiting(b)) - Number(waiting(a)));
  const open = state?.claims.find((claim) => claim.id === openId) ?? null;
  return <div className={styles.list}>
    <DataGrid<PettyCashClaim> ariaLabel={t("Petty cash")} columns={columns} data={rows} getRowId={(row) => row.id} isLoading={!state} onRowAction={(row) => setOpenId(row.id)}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search claims")} rowNumbers={false} wrapText toolbarLeading={switcher}
      toolbarActions={state?.canClaim ? <Button variant="primary" onPress={() => setEditing("new")}><Plus aria-hidden="true" size={14} />{t("New claim")}</Button> : undefined}
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("No petty cash yet")} />} />
    {state && open ? <ClaimSheet api={api} projectId={projectId} state={state} claim={open} onChanged={setState} onEdit={() => setEditing(open)} onClose={() => setOpenId(null)} /> : null}
    {state && editing ? <ClaimDialog api={api} projectId={projectId} state={state} claim={editing === "new" ? null : editing} onClose={() => setEditing(null)}
      onSaved={(next, id) => { setState(next); setEditing(null); setOpenId(id); }} /> : null}
  </div>;
}

/** One claim: what, when, how much, its receipt and where it stands; its claimant submits it, whoever decides approves or rejects it. */
function ClaimSheet({ api, projectId, state, claim, onChanged, onEdit, onClose }: {
  api: PettyCashApi; projectId: string; state: State; claim: PettyCashClaim; onChanged: (state: State) => void; onEdit: () => void; onClose: () => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const categories = useCategoryLabels();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const run = async (action: "submit" | "approve" | "reject", input: Record<string, unknown> = {}) => {
    setBusy(true); setNotice("");
    try { onChanged(await api.command(projectId, action, { claimId: claim.id, version: claim.version, ...input })); setBusy(false); return true; }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); return false; }
  };
  const mine = claim.claimedBy === state.me;
  const deciding = state.canApprove && !mine && claim.status === "submitted";
  const drafting = mine && claim.status === "draft" && state.canClaim;
  return <InspectorSheet isOpen size="md" title={`${claim.reference} · ${claim.claimedByName}`} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={deciding || drafting ? <div className="wd-dialog-actions"><span className={styles.spacer} />
      {drafting ? <><Button onPress={onEdit}>{t("Edit")}</Button>
        <Button variant="primary" isLoading={busy} onPress={() => void run("submit")}>{t("Submit")}</Button></> : null}
      {deciding ? <><Button onPress={() => setRejecting(true)}>{t("Reject")}</Button>
        <Button variant="primary" isLoading={busy} onPress={() => void run("approve")}>{t("Approve")}</Button></> : null}
    </div> : null}>
    <div className={styles.sheet}>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      <dl className={styles.facts}>
        <div><dt>{t("Status")}</dt><dd><ClaimStatusLabel status={claim.status} />
          {claim.decidedByName ? <span className={styles.muted}>{claim.status === "rejected" ? t("Rejected by {name}: {note}", { name: claim.decidedByName, note: claim.decisionNote })
            : t("Approved by {name}", { name: claim.decidedByName })}</span> : null}</dd></div>
        <div><dt>{t("What for")}</dt><dd>{claim.description}</dd></div>
        <div><dt>{t("Amount")}</dt><dd className={styles.money}>{format.money(claim.amount, claim.currency)}</dd></div>
        <div><dt>{t("Spent on")}</dt><dd>{format.day(claim.spentOn)}</dd></div>
        <div><dt>{t("Kind")}</dt><dd>{categories[claim.category]}</dd></div>
        <div><dt>{t("Package")}</dt><dd>{claim.packageName ?? t("Not in a package")}</dd></div>
        <div><dt>{t("Receipt")}</dt><dd>{claim.receiptName ? <a href={api.receiptUrl(claim.id)} target="_blank" rel="noreferrer">{claim.receiptName}</a>
          : <span className={styles.muted}>{claim.noReceiptReason ? t("None: {reason}", { reason: claim.noReceiptReason }) : t("None yet")}</span>}</dd></div>
        {claim.reimbursedAt ? <div><dt>{t("Reimbursed")}</dt><dd>{[format.when(claim.reimbursedAt), claim.reimbursedByName, claim.reimbursementReference].filter(Boolean).join(" · ")}</dd></div> : null}
      </dl>
    </div>
    {rejecting ? <RejectDialog reference={claim.reference} error={notice} onClose={() => { setRejecting(false); setNotice(""); }}
      onSave={async (note) => { if (!(await run("reject", { note }))) throw new FormNotSaved(); setRejecting(false); }} /> : null}
  </InspectorSheet>;
}

function RejectDialog({ reference, error, onClose, onSave }: { reference: string; error: string; onClose: () => void; onSave: (note: string) => Promise<void> }) {
  const t = useT();
  const [note, setNote] = useState("");
  return <FormDialog size="md" title={t("Reject {claim}", { claim: reference })} onClose={onClose} cancelLabel={t("Back")} error={error || undefined}
    isDirty={Boolean(note.trim())} isSubmitDisabled={!note.trim()} submitLabel={t("Reject")} submitVariant="danger" onSubmit={() => onSave(note.trim())}>
    <TextAreaField label={t("Why it's rejected")} isRequired value={note} onChange={setNote} />
  </FormDialog>;
}

/** A claim as its claimant writes it: saved as a draft, or submitted with its receipt (or why there's none). */
function ClaimDialog({ api, projectId, state, claim, onClose, onSaved }: {
  api: PettyCashApi; projectId: string; state: State; claim: PettyCashClaim | null; onClose: () => void; onSaved: (state: State, claimId: string) => void;
}) {
  const t = useT();
  const categories = useCategoryLabels();
  const [id] = useState(() => claim?.id ?? crypto.randomUUID());
  // Once saved here, a retry (say, after the receipt failed to upload) changes that saved draft.
  const [version, setVersion] = useState<number | null>(claim?.version ?? null);
  const [spentOn, setSpentOn] = useState<string | null>(claim?.spentOn ?? state.today);
  const [amount, setAmount] = useState(claim ? plain(claim.amount) : "");
  const [description, setDescription] = useState(claim?.description ?? "");
  // A new claim starts on the kind this person used last.
  const [category, setCategory] = useState<PettyCashCategory | null>(() => claim?.category
    ?? state.claims.filter((row) => row.claimedBy === state.me).reduce<PettyCashClaim | null>((last, row) => (!last || row.number > last.number ? row : last), null)?.category ?? null);
  const [packageId, setPackageId] = useState(claim?.packageId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [noReceiptReason, setNoReceiptReason] = useState(claim?.noReceiptReason ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const places = currencyDecimals(state.currency);
  const tooPrecise = (amount.split(".")[1]?.length ?? 0) > places;
  const ready = Boolean(spentOn && amount && Number(amount) > 0 && !tooPrecise && description.trim() && category);
  const evidence = Boolean(file || claim?.receiptName || noReceiptReason.trim());
  const persist = async (submit: boolean) => {
    let next = await api.command(projectId, "save", { id, ...(version === null ? {} : { version }), spentOn, amount, description: description.trim(), category,
      packageId: packageId || null, noReceiptReason: file ? "" : noReceiptReason.trim() });
    const saved = () => next.claims.find((row) => row.id === id)!.version;
    setVersion(saved());
    if (file) { next = await api.uploadReceipt(projectId, id, file); setVersion(saved()); }
    if (submit) next = await api.command(projectId, "submit", { claimId: id, version: saved() });
    onSaved(next, id);
  };
  const saveDraft = async () => {
    setBusy("save"); setError("");
    try { await persist(false); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(null); }
  };
  return <FormDialog size="lg" title={claim ? claim.reference : t("New claim")} onClose={onClose} error={error || undefined} isDirty={Boolean(amount || description.trim() || file)}
    isSubmitting={busy === "save"} isSubmitDisabled={!ready || !evidence} submitLabel={t("Submit")} onSubmit={() => { setError(""); return persist(true); }}
    secondaryAction={<Button isLoading={busy === "save"} isDisabled={Boolean(busy) || !ready} onPress={() => void saveDraft()}>{t("Save draft")}</Button>}>
      <FormSection title={t("Expense")}>
        <DateField label={t("Spent on")} isRequired value={spentOn ? parseDate(spentOn) : null} onChange={(value) => setSpentOn(value ? value.toString() : null)} />
        <MoneyField label={t("Amount")} isRequired currency={state.currency} value={amount} onChange={setAmount} />
        <TextInput label={t("What for")} isRequired maxLength={500} value={description} onChange={setDescription} />
        <SelectField label={t("Kind")} isRequired placeholder={t("Choose")} selectedKey={category} onSelectionChange={(key) => setCategory(key ? (key as PettyCashCategory) : null)}
          items={CATEGORIES.map((item) => ({ id: item, label: categories[item] }))} />
        <SelectField label={t("Package")} selectedKey={packageId || "none"} onSelectionChange={(key) => setPackageId(key && key !== "none" ? String(key) : "")}
          items={[{ id: "none", label: t("Not in a package") }, ...state.packages.map((item) => ({ id: item.id, label: item.name }))]} />
      </FormSection>
      <FormSection title={t("Receipt")}>
        <div className={styles.receipt}>
          <FileUploader appearance="button" accept="application/pdf,image/*" multiple={false} label={file || claim?.receiptName ? t("Replace receipt") : t("Attach receipt")}
            onFiles={(files) => setFile(files[0] ?? null)} />
          {file ? <span>{file.name}</span> : claim?.receiptName ? <span className={styles.muted}>{claim.receiptName}</span> : null}
        </div>
        {!file && !claim?.receiptName ? <TextInput label={t("If there's no receipt, why")} maxLength={500} value={noReceiptReason} onChange={setNoReceiptReason} /> : null}
      </FormSection>
  </FormDialog>;
}
