"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import type { HrmsBootstrap, HrmsCrewState, HrmsDocument, HrmsDocumentKind, HrmsDocuments, HrmsPerson } from "@wodana/contracts";
import {
  Button, ControlledModalDialog, DataGrid, DateField, EmptyState, ErrorState, FileUploader, FormRow, FormSection, InlineNotice, InspectorSheet, NoResultsState, SegmentedControl, SelectField, Skeleton,
  TextAreaField, TextInput, type DataGridColumn, type ToolbarFilter,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { HrmsApi } from "@/lib/hrms/api";
import { Facts } from "./hrms-controls";
import { useHrmsFormat } from "./hrms-format";
import { DOCUMENT_KINDS, DocumentStatus, useDocumentKinds } from "./hrms-labels";
import styles from "./hrms.module.css";

type Status = HrmsDocument["status"];
type Subjects = { people: HrmsPerson[]; crews: HrmsCrewState | null };
const subjectKey = (document: Pick<HrmsDocument, "membershipId" | "workerId">) => (document.membershipId ? `m:${document.membershipId}` : `w:${document.workerId}`);

/**
 * Documents with expiry — identity papers, work permits, licences, inductions — for staff and for crew
 * workers. HR keeps everyone's; everyone else sees their own. Expired first, then the soonest to expire.
 */
export function DocumentsTab({ api, boot, creating, onCreateDone, openId, onOpen }: {
  api: HrmsApi; boot: HrmsBootstrap; creating: boolean; onCreateDone: () => void; openId: string | null; onOpen: (id: string | null) => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const kinds = useDocumentKinds();
  const [data, setData] = useState<HrmsDocuments | null>(null);
  const [subjects, setSubjects] = useState<Subjects | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status | "all">("all");
  const [kind, setKind] = useState<HrmsDocumentKind | "all">("all");
  const [person, setPerson] = useState("all");
  const manage = data?.canManage ?? boot.permissions.manage;
  const load = useCallback(async () => {
    try { setData(await api.documents()); setError(""); } catch (cause) { setError(format.failure(cause, t("Documents didn't load."))); }
  }, [api, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  // HR files documents against people and workers.
  useEffect(() => {
    if (!boot.permissions.manage) return;
    let live = true;
    Promise.all([api.people().catch(() => []), api.crews().catch(() => null)]).then(([people, crews]) => { if (live) setSubjects({ people, crews }); });
    return () => { live = false; };
  }, [api, boot.permissions.manage]);
  const columns = useMemo<DataGridColumn<HrmsDocument>[]>(() => [
    ...(manage ? [{ id: "person", header: t("Person"), enableColumnFilter: false, accessorFn: (row: HrmsDocument) => row.personName ?? "", size: 200, meta: { primary: true,
      renderCell: (row: HrmsDocument) => <span className={styles.nameCell}><span>{row.personName}</span>{row.workerId ? <small>{t("Crew worker")}</small> : null}</span> } }] : []),
    { id: "document", header: t("Document"), accessorFn: (row) => row.title, size: 260, meta: { primary: !manage,
      renderCell: (row) => <span className={styles.nameCell}><span>{row.title}</span><small>{[kinds[row.kind], row.number].filter(Boolean).join(" · ")}</small></span> } },
    { id: "expires", header: t("Expires"), accessorFn: (row) => row.expiresOn ?? "9999", size: 140, meta: { renderCell: (row) => (row.expiresOn ? format.date(row.expiresOn) : <span className={styles.muted}>{t("No expiry")}</span>) } },
    { id: "status", header: t("Status"), enableColumnFilter: false, accessorFn: (row) => row.status, size: 130, meta: { renderCell: (row) => <DocumentStatus status={row.status} /> } },
  ], [t, format, kinds, manage]);
  if (error && !data) return <ErrorState description={error} onRetry={() => void load()} />;
  const documents = data?.documents ?? [];
  const people = [...new Map(documents.map((document) => [subjectKey(document), document.personName ?? ""])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const needle = search.trim().toLocaleLowerCase();
  const order: Record<Status, number> = { expired: 0, expiring: 1, valid: 2 };
  const rows = documents.filter((document) => (status === "all" || document.status === status) && (kind === "all" || document.kind === kind)
    && (person === "all" || subjectKey(document) === person)
    && (!needle || [document.personName, document.title, document.number, kinds[document.kind]].some((value) => value?.toLocaleLowerCase().includes(needle))))
    .sort((a, b) => order[a.status] - order[b.status] || (a.expiresOn ?? "9999").localeCompare(b.expiresOn ?? "9999"));
  const filters: ToolbarFilter[] = manage ? [
    { id: "status", label: t("Status"), value: status === "all" ? undefined : status, onChange: (value) => setStatus((value as Status | undefined) ?? "all"),
      options: [{ id: "expired", label: t("Expired") }, { id: "expiring", label: t("Expiring") }, { id: "valid", label: t("Valid") }] },
    { id: "kind", label: t("Kind"), value: kind === "all" ? undefined : kind, onChange: (value) => setKind((value as HrmsDocumentKind | undefined) ?? "all"),
      options: DOCUMENT_KINDS.map((item) => ({ id: item, label: kinds[item] })) },
    { id: "person", label: t("Person"), value: person === "all" ? undefined : person, onChange: (value) => setPerson(value ?? "all"),
      options: people.map(([id, name]) => ({ id, label: name })) },
  ] : [];
  const filtered = needle || status !== "all" || kind !== "all" || person !== "all";
  const open = openId ? documents.find((document) => document.id === openId) ?? null : null;
  const done = () => { void load(); if (creating) onCreateDone(); else onOpen(null); };
  return <>
    <DataGrid<HrmsDocument> ariaLabel={t("Documents")} columns={columns} data={rows} getRowId={(row) => row.id} isLoading={!data} onRowAction={(row) => onOpen(row.id)}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search documents")} rowNumbers={false} selectable={false} filters={filters}
      emptyContent={filtered ? <NoResultsState onClear={() => { setSearch(""); setStatus("all"); setKind("all"); setPerson("all"); }} /> : <EmptyState title={t("No documents yet")} />} />
    {data && (open || creating) ? <DocumentSheet key={open?.id ?? "new"} api={api} document={creating ? null : open} manage={manage} subjects={subjects}
      onClose={() => (creating ? onCreateDone() : onOpen(null))} onDone={done} /> : null}
  </>;
}

type Draft = { subject: "member" | "worker"; subjectId: string | null; kind: HrmsDocumentKind | null; title: string; number: string; issuedOn: string | null; expiresOn: string | null; note: string };

/** One document: whose, what kind, its number and dates, and its scan (a PDF or an image). HR changes or removes it. */
function DocumentSheet({ api, document, manage, subjects, onClose, onDone }: {
  api: HrmsApi; document: HrmsDocument | null; manage: boolean; subjects: Subjects | null; onClose: () => void; onDone: () => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const kinds = useDocumentKinds();
  const [id] = useState(() => document?.id ?? crypto.randomUUID());
  const initial: Draft = {
    subject: document?.workerId ? "worker" : "member", subjectId: document?.membershipId ?? document?.workerId ?? null, kind: document?.kind ?? null, title: document?.title ?? "",
    number: document?.number ?? "", issuedOn: document?.issuedOn ?? null, expiresOn: document?.expiresOn ?? null, note: document?.note ?? "",
  };
  const [draft, setDraft] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  // Once saved here, a retry (say, after the scan failed to upload) changes that saved document.
  const [version, setVersion] = useState(document?.version ?? 0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const backwards = Boolean(draft.issuedOn && draft.expiresOn && draft.expiresOn < draft.issuedOn);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || Boolean(file);
  const valid = Boolean(draft.subjectId && draft.kind && draft.title.trim()) && !backwards;
  const options = draft.subject === "member"
    ? (subjects?.people ?? []).filter((person) => person.status === "active" || person.membershipId === draft.subjectId).map((person) => ({ id: person.membershipId, label: person.name, description: person.designation || undefined }))
    : (subjects?.crews?.workers ?? []).filter((worker) => worker.active || worker.id === draft.subjectId).map((worker) => ({ id: worker.id, label: worker.name,
      description: [worker.workerCode, worker.trade].filter(Boolean).join(" · ") || undefined }));
  const save = async () => {
    setBusy(true); setError("");
    try {
      const saved = await api.saveDocument(id, { version, membershipId: draft.subject === "member" ? draft.subjectId : null, workerId: draft.subject === "worker" ? draft.subjectId : null,
        kind: draft.kind!, title: draft.title.trim(), number: draft.number.trim(), issuedOn: draft.issuedOn, expiresOn: draft.expiresOn, note: draft.note.trim() });
      setVersion(saved.version);
      if (file) await api.uploadDocumentFile(id, file);
      onDone();
    } catch (cause) { setError(format.failure(cause, t("Could not save."))); setBusy(false); }
  };
  const fileLink = document?.fileName ? <a href={api.documentFileUrl(document.id)} target="_blank" rel="noreferrer">{document.fileName}</a> : null;
  return <InspectorSheet isOpen size="md" title={document ? document.title : t("New document")} description={document ? [document.personName, kinds[document.kind]].filter(Boolean).join(" · ") : undefined}
    isDirty={manage && dirty && !busy} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={manage ? <div className="wd-dialog-actions">
      {document ? <Button variant="quiet" isDisabled={busy} onPress={() => setRemoving(true)}>{t("Remove")}</Button> : null}
      <span className={styles.spacer} />
      <Button variant="primary" isLoading={busy} isDisabled={!dirty || !valid} onPress={() => void save()}>{t("Save")}</Button>
    </div> : null}>
    <div className={styles.sheet}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {manage ? <>
        <FormSection>
          {document ? null : <>
            <SegmentedControl label={t("Whose")} value={draft.subject} onChange={(value) => setDraft((current) => ({ ...current, subject: value as Draft["subject"], subjectId: null }))}
              options={[{ id: "member", label: t("Person") }, { id: "worker", label: t("Crew worker") }]} />
            {subjects ? <SelectField label={draft.subject === "member" ? t("Person") : t("Crew worker")} isRequired placeholder={t("Choose")} selectedKey={draft.subjectId} items={options}
              onSelectionChange={(key) => set("subjectId", key ? String(key) : null)} /> : <Skeleton lines={1} />}
          </>}
          <SelectField label={t("Kind")} isRequired placeholder={t("Choose")} selectedKey={draft.kind} items={DOCUMENT_KINDS.map((item) => ({ id: item, label: kinds[item] }))}
            onSelectionChange={(key) => {
              const next = key ? (key as HrmsDocumentKind) : null;
              // A new document is named after its kind until someone names it.
              setDraft((current) => ({ ...current, kind: next, title: !current.title.trim() || (current.kind && current.title === kinds[current.kind]) ? next ? kinds[next] : "" : current.title }));
            }} />
          <TextInput label={t("Title")} isRequired value={draft.title} onChange={(value) => set("title", value)} maxLength={120} />
          <TextInput label={t("Number")} value={draft.number} onChange={(value) => set("number", value)} maxLength={80} />
        </FormSection>
        <FormSection title={t("Validity")}>
          <FormRow>
            <DateField label={t("Issued")} value={draft.issuedOn ? parseDate(draft.issuedOn) : null} onChange={(value) => set("issuedOn", value ? value.toString() : null)} />
            <DateField label={t("Expires")} value={draft.expiresOn ? parseDate(draft.expiresOn) : null} onChange={(value) => set("expiresOn", value ? value.toString() : null)}
              isInvalid={backwards} errorMessage={backwards ? t("It expires after it's issued.") : undefined} />
          </FormRow>
        </FormSection>
        <FormSection title={t("File")}>
          <div className={styles.inline}>
            <FileUploader appearance="button" accept="application/pdf,image/*" multiple={false} label={file || document?.fileName ? t("Replace file") : t("Attach file")}
              onFiles={(files) => setFile(files[0] ?? null)} />
            {file ? <span>{file.name}</span> : fileLink}
          </div>
          <TextAreaField label={t("Note")} value={draft.note} onChange={(value) => set("note", value)} />
        </FormSection>
      </> : document ? <Facts items={[
        [t("Status"), <DocumentStatus key="status" status={document.status} />],
        [t("Kind"), kinds[document.kind]],
        document.number ? [t("Number"), <span key="number" dir="ltr">{document.number}</span>] : null,
        document.issuedOn ? [t("Issued"), format.date(document.issuedOn)] : null,
        [t("Expires"), document.expiresOn ? format.date(document.expiresOn) : t("No expiry")],
        document.note ? [t("Note"), document.note] : null,
        fileLink ? [t("File"), fileLink] : null,
      ]} /> : null}
    </div>
    {removing && document ? <RemoveDocumentDialog api={api} document={document} onClose={() => setRemoving(false)} onRemoved={onDone} /> : null}
  </InspectorSheet>;
}

function RemoveDocumentDialog({ api, document, onClose, onRemoved }: { api: HrmsApi; document: HrmsDocument; onClose: () => void; onRemoved: () => void }) {
  const t = useT();
  const format = useHrmsFormat();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Remove {document}?", { document: document.title })} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button isDisabled={busy} onPress={onClose}>{t("Keep")}</Button>
      <Button variant="danger" isLoading={busy} onPress={async () => {
        setBusy(true); setError("");
        try { await api.removeDocument(document.id, document.version); onRemoved(); } catch (cause) { setError(format.failure(cause, t("Could not remove."))); setBusy(false); }
      }}>{t("Remove")}</Button></div>}>
    {error ? <InlineNotice tone="error" message={error} /> : <p className={styles.muted}>{document.personName}</p>}
  </ControlledModalDialog>;
}

/** A person's or a worker's documents, on their own record; each opens in Documents. */
export function PersonDocuments({ api, membershipId, workerId, onOpen }: { api: HrmsApi; membershipId?: string; workerId?: string; onOpen: (id: string) => void }) {
  const t = useT();
  const format = useHrmsFormat();
  const kinds = useDocumentKinds();
  const [documents, setDocuments] = useState<HrmsDocument[] | null>(null);
  useEffect(() => {
    let live = true;
    api.documents({ membershipId, workerId }).then((data) => { if (live) setDocuments(data.documents); }).catch(() => { if (live) setDocuments([]); });
    return () => { live = false; };
  }, [api, membershipId, workerId]);
  return <section className={styles.part} aria-label={t("Documents")}>
    <h3 className={styles.subhead}>{t("Documents")}</h3>
    {!documents ? <Skeleton lines={2} /> : !documents.length ? <p className={styles.muted}>{t("No documents yet")}</p>
      : <ul className={styles.list}>{documents.map((document) => <li key={document.id}>
        <button type="button" className={styles.rowButton} onClick={() => onOpen(document.id)}>
          <span className={styles.grow}><span>{document.title}</span>
            <small>{[kinds[document.kind], document.number, document.expiresOn ? t("Expires {date}", { date: format.date(document.expiresOn) }) : ""].filter(Boolean).join(" · ")}</small></span>
          <DocumentStatus status={document.status} />
        </button>
      </li>)}</ul>}
  </section>;
}
