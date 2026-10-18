"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { PackageCheck, Plus, X } from "lucide-react";
import { Badge, Button, Checkbox, DateField, EmptyState, ErrorState, FileUploader, FormDialog, FormSection, IconButton, InlineNotice, ReviewFiles, SelectField, Skeleton, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { siteApi } from "@/lib/site/client";
import type { HandoverKind, HandoverMethod, HandoverPack, HandoverState } from "@/lib/site/types";
import { useProjectFormat } from "../project-core/format";
import { initialAnswers, QuestionnaireFields, unansweredRequired } from "../setup/questionnaire-fields";
import type { QuestionnaireAnswers } from "@/lib/setup/questionnaires";
import styles from "./site.module.css";
import { EvidenceField } from "@/components/evidence/evidence-field";
import { evidenceFiles, type EvidenceFile } from "@/lib/evidence/evidence";

/**
 * Handing over: packs of what the client receives, for the whole project or some areas. A draft
 * gathers documents; issuing freezes it; the client's acceptance (with anything outstanding) or refusal
 * is recorded against the issued revision.
 */
export function ProjectHandover({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const t = useT();
  const format = useProjectFormat();
  const api = useMemo(() => siteApi(workspaceId, projectId), [workspaceId, projectId]);
  const [state, setState] = useState<HandoverState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "accept" | "refuse" | "issue"; pack: HandoverPack } | null>(null);
  const load = useCallback(async () => {
    try { setState(await api.handover()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The handover didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const kinds: Record<HandoverKind, string> = useMemo(() => ({ drawing: t("Drawing"), warranty: t("Warranty"), manual: t("Manual"), care_guide: t("Care guide"), photo: t("As-built photo"), other: t("Other") }), [t]);
  const methods: Record<HandoverMethod, string> = useMemo(() => ({ signed_document: t("Signed document"), in_person: t("In person"), email: t("By email"), portal: t("In the portal") }), [t]);
  const run = async (action: string, input: Record<string, unknown> = {}) => {
    setNotice("");
    try { setState(await api.handoverCommand(action, input)); return true; }
    catch (cause) {
      setNotice(cause instanceof Error ? cause.message : t("Could not save."));
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      return false;
    }
  };
  if (error && !state) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!state) return <Skeleton lines={6} shape="rows" />;
  const statusLabel = { draft: t("Draft"), issued: t("Issued"), accepted: t("Accepted"), refused: t("Refused") };
  // Money the client still owes: shown on the pack and asked about when accepting.
  const owed = Boolean(state.balance && /[1-9]/.test(state.balance.due));
  const areaNames = (pack: HandoverPack) => (pack.areaIds.length ? state.areas.filter((area) => pack.areaIds.includes(area.id)).map((area) => area.name).join(", ") : t("Whole project"));

  return <div className={styles.site}>
    <div className={styles.toolbar}>
      <span className={styles.muted}>{state.covered ? t("Handed over") : t("Not handed over yet")}</span>
      {owed ? <span className={styles.balance}>{t("Balance due {amount}", { amount: format.money(state.balance!.due, state.balance!.currency) })}</span> : null}
      <span className={styles.spacer} />
      {state.canManage ? <Button size="compact" variant="primary" onPress={() => setDialog({ kind: "new" })}><Plus aria-hidden="true" size={14} />{t("New pack")}</Button> : null}
    </div>
    {notice ? <InlineNotice tone="error" message={notice} /> : null}
    {owed && state.balance!.toInvoice.length && state.packs.some((pack) => pack.status !== "accepted") ? <InlineNotice tone="info" message={t("Not invoiced yet: {items}",
      { items: state.balance!.toInvoice.map((row) => `${row.title} (${format.money(row.amount, state.balance!.currency)})`).join(", ") })} /> : null}
    {!state.packs.length ? <EmptyState illustration={null} title={t("No handover pack yet")} description={t("Gather the drawings, warranties, manuals and care guides the client receives.")} />
      : <ul className={styles.reports} aria-label={t("Handover packs")}>{state.packs.map((pack) => <li key={pack.id} className={styles.report}>
        <div className={styles.reportHead}>
          <strong>{`R${pack.revision} · ${pack.title}`}</strong>
          <span className={styles.muted}>{areaNames(pack)}</span>
          <Badge tone={pack.status === "accepted" ? "success" : pack.status === "refused" ? "warning" : pack.status === "issued" ? "info" : "neutral"}>{statusLabel[pack.status]}</Badge>
        </div>
        {pack.status === "accepted" || pack.status === "refused" ? <InlineNotice tone="info" message={pack.status === "accepted"
          ? pack.decisionNote ? t("Accepted by {name} on {date} ({how}), with outstanding: {items}", { name: pack.decidedByName ?? "", date: format.day(pack.decidedOn),
              how: methods[pack.decisionMethod ?? "signed_document"], items: pack.decisionNote.split("\n").join(", ") })
            : t("Accepted by {name} on {date} ({how})", { name: pack.decidedByName ?? "", date: format.day(pack.decidedOn), how: methods[pack.decisionMethod ?? "signed_document"] })
          : t("Refused by {name} on {date}: {reason}", { name: pack.decidedByName ?? "", date: format.day(pack.decidedOn), reason: pack.decisionNote })} /> : null}
        {(pack.status === "accepted" || pack.status === "refused") && pack.decisionFiles?.length ? <ReviewFiles label={t("The client's decision")} files={evidenceFiles(workspaceId, pack.decisionFiles)} /> : null}
        {pack.status === "accepted" && pack.balanceDue ? <p className={styles.muted}>{pack.balanceReason
          ? t("Accepted with {amount} due: {reason}", { amount: format.money(pack.balanceDue, pack.balanceCurrency ?? ""), reason: pack.balanceReason })
          : t("Accepted with {amount} due", { amount: format.money(pack.balanceDue, pack.balanceCurrency ?? "") })}</p> : null}
        <ul className={styles.facts}>{pack.documents.map((document) => <li key={document.id} className={styles.document}>
          <a href={api.documentUrl(document.id)} target="_blank" rel="noreferrer">{document.title}</a>
          <span className={styles.muted}>{kinds[document.kind]}</span>
          {pack.status === "draft" && state.canManage ? <IconButton aria-label={t("Remove {name}", { name: document.title })} size="compact" variant="quiet"
            onPress={() => void run("remove_document", { packId: pack.id, documentId: document.id, version: pack.version })}><X aria-hidden="true" size={13} /></IconButton> : null}
        </li>)}</ul>
        {pack.status === "draft" && state.canManage ? <AddDocument kinds={kinds} onAdd={async (kind, title, file) => {
          setNotice("");
          try { setState(await api.uploadDocument(pack.id, crypto.randomUUID(), kind, title, file)); } catch (cause) { setNotice(cause instanceof Error ? cause.message : t("The file could not be uploaded.")); }
        }} /> : null}
        {state.canManage && (pack.status === "draft" || pack.status === "issued") ? <div className={styles.actions}>
          {pack.status === "draft" ? <Button size="compact" variant="primary" isDisabled={!pack.documents.length}
            onPress={() => setDialog({ kind: "issue", pack })}>{t("Issue")}</Button> : <>
            <Button size="compact" variant="quiet" onPress={() => setDialog({ kind: "refuse", pack })}>{t("Record refusal")}</Button>
            <Button size="compact" variant="primary" onPress={() => setDialog({ kind: "accept", pack })}>{t("Record acceptance")}</Button>
          </>}
        </div> : null}
      </li>)}</ul>}
    {dialog?.kind === "new" ? <PackDialog areas={state.areas} onClose={() => setDialog(null)}
      onSave={async (title, areaIds) => { if (await run("create_pack", { id: crypto.randomUUID(), title, areaIds })) setDialog(null); }} /> : null}
    {dialog && dialog.kind !== "new" && dialog.kind !== "issue" ? <DecisionDialog workspaceId={workspaceId} mode={dialog.kind} methods={methods} today={format.today()} onClose={() => setDialog(null)}
      open={dialog.kind === "accept" ? state.open : undefined}
      balance={dialog.kind === "accept" && owed ? { text: format.money(state.balance!.due, state.balance!.currency), allowed: Boolean(state.canAcceptBalance) } : undefined}
      onSave={async (input) => { if (await run(dialog.kind, { packId: dialog.pack.id, version: dialog.pack.version, ...input })) setDialog(null); }} /> : null}
    {dialog?.kind === "issue" ? <IssueDialog pack={dialog.pack} open={state.open} checklist={state.checklists?.[dialog.pack.id] ?? null} onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run("issue", { packId: dialog.pack.id, version: dialog.pack.version, ...input })) setDialog(null); }} /> : null}
  </div>;
}

function AddDocument({ kinds, onAdd }: { kinds: Record<HandoverKind, string>; onAdd: (kind: HandoverKind, title: string, file: File) => Promise<void> }) {
  const t = useT();
  const [kind, setKind] = useState<HandoverKind>("warranty");
  const [title, setTitle] = useState("");
  return <div className={styles.row}>
    <SelectField aria-label={t("Kind")} label={null} selectedKey={kind} onSelectionChange={(key) => setKind((key ?? "other") as HandoverKind)}
      items={(Object.keys(kinds) as HandoverKind[]).map((id) => ({ id, label: kinds[id] }))} />
    <TextInput aria-label={t("Title")} label={null} placeholder={t("Title")} value={title} onChange={setTitle} />
    <FileUploader appearance="button" accept="application/pdf,image/*" label={t("Add a document")}
      onFiles={(files) => { for (const file of files) void onAdd(kind, title.trim() || file.name, file); setTitle(""); }} />
  </div>;
}

function PackDialog({ areas, onClose, onSave }: { areas: Array<{ id: string; name: string }>; onClose: () => void; onSave: (title: string, areaIds: string[]) => Promise<void> }) {
  const t = useT();
  const [title, setTitle] = useState(t("Handover"));
  const [chosen, setChosen] = useState<string[]>([]);
  return <FormDialog size="md" title={t("New pack")} onClose={onClose} isSubmitDisabled={!title.trim()} submitLabel={t("Save")} onSubmit={async () => { await onSave(title.trim(), chosen); }}>
      <TextInput label={t("Title")} isRequired value={title} onChange={setTitle} />
      {areas.length ? <fieldset className={styles.group}>
        <legend>{t("Areas (none: the whole project)")}</legend>
        {areas.map((area) => <Checkbox key={area.id} isSelected={chosen.includes(area.id)}
          onChange={(on) => setChosen(on ? [...chosen, area.id] : chosen.filter((id) => id !== area.id))}>{area.name}</Checkbox>)}
      </fieldset> : null}
  </FormDialog>;
}

/** The client's decision on an issued revision: accepted (with anything outstanding) or refused with why. */
const hasOpenWork = (open: HandoverState["open"] | undefined) => Boolean(open && (open.stages.length || open.snags.length));

/** What's still open on the project, listed before a handover is issued or accepted while it's open. */
function OpenWorkList({ open }: { open: HandoverState["open"] }) {
  const t = useT();
  return <div className={styles.stack}>
    {open.stages.length ? <InlineNotice tone="info" message={`${t("Stages not finished")}: ${open.stages.join(", ")}`} /> : null}
    {open.snags.length ? <InlineNotice tone="info" message={`${t("Snags open")}: ${open.snags.join(", ")}`} /> : null}
  </div>;
}

/**
 * Issuing a pack: the firm's handover checklist (Setup → Questionnaires) is answered first, and while stages or snags
 * are still open it's confirmed on purpose, with why. Never one click: the pack goes to the client.
 */
function IssueDialog({ pack, open, checklist, onClose, onSave }: { pack: HandoverPack; open: HandoverState["open"]; checklist: QuestionnaireAnswers | null; onClose: () => void;
  onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [answers, setAnswers] = useState(() => initialAnswers(checklist));
  const withOpen = hasOpenWork(open);
  const missing = unansweredRequired(checklist?.questions ?? [], answers);
  return <FormDialog size="md" title={withOpen ? t("Issue with work still open") : t("Issue")} description={pack.title} icon={<PackageCheck />} onClose={onClose}
    isDirty={Boolean(reason.trim()) || JSON.stringify(answers) !== JSON.stringify(initialAnswers(checklist))}
    isSubmitDisabled={(withOpen && !reason.trim()) || missing.length > 0} submitLabel={withOpen ? t("Issue anyway") : t("Issue")}
    onSubmit={async () => { await onSave({ answers, ...(withOpen ? { confirmOpen: true, openReason: reason.trim() } : {}) }); }}>
      {checklist?.questions.length ? <QuestionnaireFields questions={checklist.questions} answers={answers} onChange={(key, value) => setAnswers((current) => ({ ...current, [key]: value }))} /> : null}
      {withOpen ? <>
        <OpenWorkList open={open} />
        <TextAreaField label={t("Why hand over with work still open")} isRequired value={reason} onChange={setReason} />
      </> : null}
  </FormDialog>;
}

function DecisionDialog({ workspaceId, mode, methods, today, open, balance, onClose, onSave }: {
  workspaceId: string; mode: "accept" | "refuse"; methods: Record<HandoverMethod, string>; today: string; open?: HandoverState["open"];
  /** Money still due at acceptance: its amount, and whether this person may accept anyway (with why). */
  balance?: { text: string; allowed: boolean };
  onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void>;
}) {
  const t = useT();
  const [decidedOn, setDecidedOn] = useState(today);
  const [name, setName] = useState("");
  const [method, setMethod] = useState<HandoverMethod>("signed_document");
  const [items, setItems] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [openReason, setOpenReason] = useState("");
  const [balanceReason, setBalanceReason] = useState("");
  // §0.3 P0: a signed form or an email is attached as the client's decision; in person, a photo of the signed page if there is one.
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRequired = method === "signed_document" || method === "email";
  const confirmOpen = mode === "accept" && hasOpenWork(open);
  const valid = name.trim() && (mode === "accept" || reason.trim()) && (!confirmOpen || openReason.trim()) && (!balance || (balance.allowed && balanceReason.trim()))
    && !uploading && (!fileRequired || files.length > 0);
  return <FormDialog size="md" title={mode === "accept" ? t("Record acceptance") : t("Record refusal")} onClose={onClose} isSubmitDisabled={!valid} submitLabel={t("Save")} onSubmit={async () => {
        await onSave({ decidedOn, decidedByName: name.trim(), method, evidenceFileIds: files.map((file) => file.id), ...(mode === "accept" ? { outstanding: items.map((item) => item.trim()).filter(Boolean) } : { reason: reason.trim() }),
          ...(confirmOpen ? { confirmOpen: true, openReason: openReason.trim() } : {}), ...(balance ? { balanceReason: balanceReason.trim() } : {}) });
      }}>
      <FormSection title={t("Client decision")}>
        <DateField label={t("Day")} isRequired value={parseDate(decidedOn)} onChange={(value) => setDecidedOn(value ? value.toString() : today)} />
        <SelectField label={t("How")} selectedKey={method} onSelectionChange={(key) => setMethod((key ?? "signed_document") as HandoverMethod)}
          items={(Object.keys(methods) as HandoverMethod[]).map((id) => ({ id, label: methods[id] }))} />
        <TextInput label={t("Who decided for the client")} isRequired value={name} onChange={setName} />
        {mode === "accept" ? null : <TextAreaField label={t("Why the client refused it")} isRequired value={reason} onChange={setReason} />}
        <EvidenceField workspaceId={workspaceId} kind="handover_acceptance" isRequired={fileRequired} label={fileRequired ? t("The signed form or email") : undefined} value={files} onChange={setFiles} onBusy={setUploading} />
      </FormSection>
      {mode === "accept" ? <FormSection title={t("Still outstanding")}>
        {items.map((item, index) => <div key={index} className={styles.row}>
          <TextInput aria-label={t("Outstanding item")} label={null} value={item} onChange={(value) => setItems(items.map((row, at) => (at === index ? value : row)))} />
          <IconButton aria-label={t("Remove")} size="compact" variant="quiet" onPress={() => setItems(items.filter((_, at) => at !== index))}><X aria-hidden="true" size={13} /></IconButton>
        </div>)}
        <Button className={styles.addLine} size="compact" variant="quiet" onPress={() => setItems([...items, ""])}><Plus aria-hidden="true" size={14} />{t("Add an item")}</Button>
      </FormSection> : null}
      {(confirmOpen && open) || balance ? <FormSection title={t("Before you accept")}>
        {confirmOpen && open ? <><OpenWorkList open={open} /><TextAreaField label={t("Why hand over with work still open")} isRequired value={openReason} onChange={setOpenReason} /></> : null}
        {balance ? balance.allowed
          ? <><InlineNotice tone="info" message={t("Balance due {amount}", { amount: balance.text })} />
              <TextAreaField label={t("Why accept before it's paid")} isRequired value={balanceReason} onChange={setBalanceReason} /></>
          : <InlineNotice tone="error" message={t("{amount} is still due. Someone who manages projects accepts a handover with a balance.", { amount: balance.text })} /> : null}
      </FormSection> : null}
  </FormDialog>;
}
