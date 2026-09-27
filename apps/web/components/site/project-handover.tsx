"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Plus, X } from "lucide-react";
import { Button, Checkbox, ControlledModalDialog, DateField, EmptyState, ErrorState, FileUploader, IconButton, InlineNotice, SelectField, Skeleton, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { siteApi } from "@/lib/site/client";
import type { HandoverKind, HandoverMethod, HandoverPack, HandoverState } from "@/lib/site/types";
import { useProjectFormat } from "../project-core/format";
import styles from "./site.module.css";

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
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "accept" | "refuse"; pack: HandoverPack } | null>(null);
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
  const areaNames = (pack: HandoverPack) => (pack.areaIds.length ? state.areas.filter((area) => pack.areaIds.includes(area.id)).map((area) => area.name).join(", ") : t("Whole project"));

  return <div className={styles.site}>
    <div className={styles.toolbar}>
      <span className={styles.muted}>{state.covered ? t("Handed over") : t("Not handed over yet")}</span>
      <span className={styles.spacer} />
      {state.canManage ? <Button size="compact" variant="primary" onPress={() => setDialog({ kind: "new" })}><Plus aria-hidden="true" size={14} />{t("New pack")}</Button> : null}
    </div>
    {notice ? <InlineNotice tone="error" message={notice} /> : null}
    {!state.packs.length ? <EmptyState illustration={null} title={t("No handover pack yet")} description={t("Gather the drawings, warranties, manuals and care guides the client receives.")} />
      : <ul className={styles.reports} aria-label={t("Handover packs")}>{state.packs.map((pack) => <li key={pack.id} className={styles.report}>
        <div className={styles.reportHead}>
          <strong>{`R${pack.revision} · ${pack.title}`}</strong>
          <span className={styles.muted}>{areaNames(pack)}</span>
          <span className={styles.status} data-status={pack.status === "accepted" ? "approved" : pack.status === "refused" ? "returned" : pack.status === "issued" ? "submitted" : "draft"}>{statusLabel[pack.status]}</span>
        </div>
        {pack.status === "accepted" || pack.status === "refused" ? <InlineNotice tone="info" message={pack.status === "accepted"
          ? pack.decisionNote ? t("Accepted by {name} on {date} ({how}), with outstanding: {items}", { name: pack.decidedByName ?? "", date: format.day(pack.decidedOn),
              how: methods[pack.decisionMethod ?? "signed_document"], items: pack.decisionNote.split("\n").join(", ") })
            : t("Accepted by {name} on {date} ({how})", { name: pack.decidedByName ?? "", date: format.day(pack.decidedOn), how: methods[pack.decisionMethod ?? "signed_document"] })
          : t("Refused by {name} on {date}: {reason}", { name: pack.decidedByName ?? "", date: format.day(pack.decidedOn), reason: pack.decisionNote })} /> : null}
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
          {pack.status === "draft" ? <Button size="compact" variant="primary" isDisabled={!pack.documents.length} onPress={() => void run("issue", { packId: pack.id, version: pack.version })}>{t("Issue")}</Button> : <>
            <Button size="compact" variant="quiet" onPress={() => setDialog({ kind: "refuse", pack })}>{t("Record refusal")}</Button>
            <Button size="compact" variant="primary" onPress={() => setDialog({ kind: "accept", pack })}>{t("Record acceptance")}</Button>
          </>}
        </div> : null}
      </li>)}</ul>}
    {dialog?.kind === "new" ? <PackDialog areas={state.areas} onClose={() => setDialog(null)}
      onSave={async (title, areaIds) => { if (await run("create_pack", { id: crypto.randomUUID(), title, areaIds })) setDialog(null); }} /> : null}
    {dialog && dialog.kind !== "new" ? <DecisionDialog mode={dialog.kind} methods={methods} today={format.today()} onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run(dialog.kind, { packId: dialog.pack.id, version: dialog.pack.version, ...input })) setDialog(null); }} /> : null}
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
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("New pack")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!title.trim()} onPress={async () => { setBusy(true); await onSave(title.trim(), chosen); setBusy(false); }}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      <TextInput label={t("Title")} isRequired value={title} onChange={setTitle} />
      {areas.length ? <fieldset className={styles.group}>
        <legend>{t("Areas (none: the whole project)")}</legend>
        {areas.map((area) => <Checkbox key={area.id} isSelected={chosen.includes(area.id)}
          onChange={(on) => setChosen(on ? [...chosen, area.id] : chosen.filter((id) => id !== area.id))}>{area.name}</Checkbox>)}
      </fieldset> : null}
    </div>
  </ControlledModalDialog>;
}

/** The client's decision on an issued revision: accepted (with anything outstanding) or refused with why. */
function DecisionDialog({ mode, methods, today, onClose, onSave }: {
  mode: "accept" | "refuse"; methods: Record<HandoverMethod, string>; today: string; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void>;
}) {
  const t = useT();
  const [decidedOn, setDecidedOn] = useState(today);
  const [name, setName] = useState("");
  const [method, setMethod] = useState<HandoverMethod>("signed_document");
  const [items, setItems] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = name.trim() && (mode === "accept" || reason.trim());
  return <ControlledModalDialog isOpen size="md" title={mode === "accept" ? t("Record acceptance") : t("Record refusal")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={async () => {
        setBusy(true);
        await onSave({ decidedOn, decidedByName: name.trim(), method, ...(mode === "accept" ? { outstanding: items.map((item) => item.trim()).filter(Boolean) } : { reason: reason.trim() }) });
        setBusy(false);
      }}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      <div className={styles.pair}>
        <DateField label={t("Day")} isRequired value={parseDate(decidedOn)} onChange={(value) => setDecidedOn(value ? value.toString() : today)} />
        <SelectField label={t("How")} selectedKey={method} onSelectionChange={(key) => setMethod((key ?? "signed_document") as HandoverMethod)}
          items={(Object.keys(methods) as HandoverMethod[]).map((id) => ({ id, label: methods[id] }))} />
      </div>
      <TextInput label={t("Who decided for the client")} isRequired value={name} onChange={setName} />
      {mode === "accept" ? <fieldset className={styles.group}>
        <legend>{t("Still outstanding")}</legend>
        {items.map((item, index) => <div key={index} className={styles.row}>
          <TextInput aria-label={t("Outstanding item")} label={null} value={item} onChange={(value) => setItems(items.map((row, at) => (at === index ? value : row)))} />
          <IconButton aria-label={t("Remove")} size="compact" variant="quiet" onPress={() => setItems(items.filter((_, at) => at !== index))}><X aria-hidden="true" size={13} /></IconButton>
        </div>)}
        <Button size="compact" variant="quiet" onPress={() => setItems([...items, ""])}><Plus aria-hidden="true" size={14} />{t("Add an item")}</Button>
      </fieldset> : <TextAreaField label={t("Why the client refused it")} isRequired value={reason} onChange={setReason} />}
    </div>
  </ControlledModalDialog>;
}
