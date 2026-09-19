"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Eye, Plus, QrCode } from "lucide-react";
import { Badge, Button, Callout, ControlledModalDialog, DataGrid, IconButton, SelectField, Tabs, TextInput, useConfirmationDialog } from "@/design-system";
import type { LeadsPageData } from "@/lib/crm/leads";
import { type LeadFormRecord } from "@/lib/crm/lead-forms";
import { crmRequest } from "@/lib/crm/client";
import { PublicEnquiryFormView } from "./public-enquiry-form";
import { LeadFormEditor } from "./lead-form-editor";
import styles from "./lead-forms.module.css";

export function LeadFormBuilder({ initialData, onDirtyChange }: { initialData: LeadsPageData; onDirtyChange?: (dirty: boolean) => void }) {
  const [forms, setForms] = useState<LeadFormRecord[]>([]);
  const [record, setRecord] = useState<LeadFormRecord>();
  const [draft, setDraft] = useState<LeadFormRecord["draft"]>();
  const [tab, setTab] = useState("questions");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [qr, setQr] = useState("");
  const [responses, setResponses] = useState<Array<{ id: string; reference: string | null; name: string; status: string; receivedAt: string; answers: Array<{ title: string; value: unknown }>; consentStatus: string; candidateCount: number }>>([]);
  const [responseCursor, setResponseCursor] = useState<string | null>(null);
  const [loadingResponses, setLoadingResponses] = useState(false);
  const [response, setResponse] = useState<(typeof responses)[number]>();
  const [reload, setReload] = useState(0);
  const responseRequest = useRef<AbortController | null>(null);
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  const dirty = Boolean(record && draft && JSON.stringify(record.draft) !== JSON.stringify(draft));
  const url = record && typeof window !== "undefined" ? `${window.location.origin}/enquiry/${record.token}` : "";
  const options = initialData.leadOptions;
  useEffect(() => {
    const controller = new AbortController();
    crmRequest<{ data: LeadFormRecord[] }>(initialData.workspaceId, "lead-forms", "GET", undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) setForms(result.data); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Forms could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialData.workspaceId, reload]);
  useEffect(() => () => responseRequest.current?.abort(), []);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.getAttribute("target") === "_blank" || event.metaKey || event.ctrlKey) return;
      event.preventDefault(); event.stopPropagation();
      requestConfirmation({
        title: "Discard unsaved form changes?",
        body: "Your saved form stays unchanged. Unsaved questions and settings will be discarded.",
        confirmLabel: "Discard changes",
        onConfirm: () => window.location.assign(anchor.href),
      });
    };
    window.addEventListener("beforeunload", warn); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", navigate, true); };
  }, [dirty, requestConfirmation]);
  useEffect(() => {
    if (!sharing || !url) return;
    let mounted = true;
    import("qrcode").then(module => module.toDataURL(url, { width: 300, margin: 4, errorCorrectionLevel: "M" })).then(value => { if (mounted) setQr(value); }).catch(() => setError("QR code could not be generated."));
    return () => { mounted = false; };
  }, [sharing, url]);
  const open = (form: LeadFormRecord) => { responseRequest.current?.abort(); setResponses([]); setResponseCursor(null); setResponse(undefined); setLoadingResponses(false); setPreview(false); setSharing(false); setQr(""); setRecord(form); setDraft(structuredClone(form.draft)); setTab("questions"); setError(""); setNotice(""); };
  const create = async () => {
    setBusy(true); setError("");
    try { const form = await crmRequest<LeadFormRecord>(initialData.workspaceId, "lead-forms", "POST", {}); setForms(previous => [form, ...previous]); open(form); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Form could not be created."); }
    finally { setBusy(false); }
  };
  const save = async (action = "save") => {
    if (!record || !draft) return;
    const issue = validateDraft(draft, action === "publish");
    if (issue) { setError(issue); setNotice(""); setTab("questions"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await crmRequest<LeadFormRecord>(initialData.workspaceId, `lead-forms/${record.id}`, "PATCH", { version: record.version, draft, action });
      setRecord(result); setDraft(structuredClone(result.draft)); setForms(previous => previous.map(form => form.id === result.id ? result : form));
      setNotice(action === "publish" ? "Form published. Its link is ready to share." : action === "pause" ? "Form paused. New submissions are disabled." : "Draft saved.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Form could not be saved."); }
    finally { setBusy(false); }
  };
  const loadResponses = async (cursor?: string) => {
    if (!record) return;
    responseRequest.current?.abort();
    const controller = new AbortController(); responseRequest.current = controller;
    setLoadingResponses(true);
    try { const result = await crmRequest<{ data: typeof responses; nextCursor: string | null }>(initialData.workspaceId, `lead-forms/${record.id}/responses?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, "GET", undefined, controller.signal); if (!controller.signal.aborted) { setResponses(previous => cursor ? [...previous, ...result.data] : result.data); setResponseCursor(result.nextCursor); } }
    catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Responses could not be loaded."); }
    finally { if (!controller.signal.aborted) setLoadingResponses(false); }
  };
  const closeForm = () => { setRecord(undefined); setDraft(undefined); };
  const requestCloseForm = () => {
    if (!dirty) { closeForm(); return; }
    requestConfirmation({
      title: "Discard unsaved form changes?",
      body: "Your saved form stays unchanged. Unsaved questions and settings will be discarded.",
      confirmLabel: "Discard changes",
      onConfirm: closeForm,
    });
  };
  return <section className={styles.forms} aria-label="Enquiry form builder">
    {error && <Callout title="Forms" tone="danger">{error}{!record && !loading && <Button size="compact" onPress={() => { setLoading(true); setError(""); setReload(value => value + 1); }}>Retry loading forms</Button>}</Callout>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!record || !draft ? <>
      <header className={styles.toolbar}><div><h2>Enquiry forms</h2><p>Share a link or QR to capture enquiries. This does not connect social inboxes or lead ads.</p></div><Button variant="primary" size="compact" onPress={() => void create()} isLoading={busy}><Plus size={15} />New form</Button></header>
      {loading ? <p role="status">Loading forms…</p> : <DataGrid ariaLabel="Enquiry forms" columns={[
        { id: "title", header: "Form", accessorFn: form => form.draft.title, size: 350 },
        { id: "source", header: "Source", accessorFn: form => { const live = form.published ?? form.draft; return options?.sources.find(source => source.id === live.source)?.label ?? live.source; }, size: 160 },
        { id: "channel", header: "Channel", accessorFn: form => { const live = form.published ?? form.draft; return options?.channels[live.source]?.find(channel => channel.id === live.channel)?.label ?? live.channel; }, size: 160 },
        { accessorKey: "status", header: "Status", size: 140 },
        { accessorKey: "updatedAt", header: "Updated", cell: ({ getValue }) => new Date(String(getValue())).toLocaleDateString(), size: 150 },
        { id: "edit", header: "", cell: ({ row }) => <Button size="compact" variant="quiet" onPress={() => open(row.original)}>Edit form</Button>, size: 120 },
      ]} data={forms} getRowId={form => form.id} onRowAction={open} pageSize={25} emptyTitle="Create your first enquiry form" emptyDescription="Start with the essential customer questions, then make it your own." />}
    </> : <>
      <header className={styles.toolbar}>
        <div className={styles.toolbarTitle}><IconButton aria-label="Back to forms" size="compact" isDisabled={busy} onPress={requestCloseForm}><ArrowLeft size={17} /></IconButton><div><h2>{draft.title}</h2><p>{dirty ? "Unsaved changes" : record.status === "published" ? "Published · saved edits stay in draft until republished" : "Draft changes are saved separately"}</p></div><Badge>{record.status}</Badge></div>
        <div className={styles.actions}><Button size="compact" variant="quiet" onPress={() => setPreview(true)}><Eye size={16} />Preview form</Button>{record.status === "published" && <Button size="compact" onPress={() => setSharing(true)}><QrCode size={16} />Share form</Button>}<Button size="compact" isDisabled={!dirty || busy} onPress={() => void save()}>Save draft</Button><Button size="compact" variant="primary" isLoading={busy} onPress={() => void save("publish")}>{record.published ? "Publish changes" : "Publish"}</Button></div>
      </header>
      <fieldset disabled={busy} className={styles.editorFieldset}><Tabs variant="segmented" selectedKey={tab} onSelectionChange={key => { setTab(key); if (key === "responses") void loadResponses(); }} items={[
        { id: "questions", label: "Build form", panel: <LeadFormEditor key={record.id} draft={draft} setDraft={setDraft} busy={busy} /> },
        { id: "settings", label: "Settings", panel: <div className={styles.settings}><h3>Where these enquiries come from</h3><p>These values are recorded automatically. Customers won’t see internal routing fields.</p><div className={styles.questionFields}><SelectField label="Source" items={options?.sources ?? []} selectedKey={draft.source} onSelectionChange={key => { const source = String(key); setDraft({ ...draft, source, channel: options?.channels[source]?.[0]?.id ?? "" }); }} /><SelectField label="Channel" items={options?.channels[draft.source] ?? []} selectedKey={draft.channel} onSelectionChange={key => setDraft({ ...draft, channel: String(key) })} /></div><p>Intake method: Form · Assignment: Routing rules and default sales team</p><p>For walk-in QR enquiries, choose Company → Walk-in. Social channels here identify where the link was shared; they do not import platform leads.</p>{record.status === "published" && <Button isDisabled={busy} onPress={() => void save("pause")}>Pause submissions</Button>}</div> },
        { id: "responses", label: "Responses", panel: <>{loadingResponses && <p role="status">Loading responses…</p>}<Button size="compact" variant="quiet" isDisabled={loadingResponses} onPress={() => void loadResponses()}>Refresh responses</Button><DataGrid ariaLabel="Form responses" data={responses} columns={[{ accessorKey: "reference", header: "Enquiry ref", size: 140, cell: ({ row }) => row.original.reference ?? "Pending review" }, { accessorKey: "name", header: "Customer", size: 240 }, { accessorKey: "status", header: "Processing status", size: 180, cell: ({ row }) => row.original.status === "duplicate_candidate" ? `Duplicate review · ${row.original.candidateCount}` : row.original.status.replaceAll("_", " ") }, { accessorKey: "consentStatus", header: "Contact consent", size: 150 }, { accessorKey: "receivedAt", header: "Received", size: 180, cell: ({ getValue }) => new Date(String(getValue())).toLocaleString() }]} getRowId={entry => entry.id} onRowAction={setResponse} pageSize={25} hasMoreRows={Boolean(responseCursor)} footerActions={responseCursor ? <Button size="compact" isLoading={loadingResponses} onPress={() => void loadResponses(responseCursor)}>Load more responses</Button> : undefined} emptyTitle={loadingResponses ? "Loading responses…" : "No responses yet"} emptyDescription="Responses appear here when customers submit the published form." /></> },
      ]} /></fieldset>
      {preview && <ControlledModalDialog isOpen onOpenChange={setPreview} title="Form preview" size="lg"><PublicEnquiryFormView key={JSON.stringify(draft)} preview form={{ ...draft, revision: "preview", consentLabel: "I agree to be contacted about this enquiry." }} /></ControlledModalDialog>}
      {sharing && <ControlledModalDialog isOpen onOpenChange={setSharing} title="Share enquiry form" size="md"><div className={styles.share}><TextInput label="Form link" value={url} isReadOnly /><Button onPress={() => { void navigator.clipboard.writeText(url).then(() => setNotice("Form link copied.")).catch(() => setError("Select and copy the form link manually.")); }}>Copy link</Button>{qr && <><Image unoptimized src={qr} alt="QR code for this enquiry form" width={240} height={240} /><a className={styles.download} href={qr} download="enquiry-form-qr.png">Download QR code</a></>}</div></ControlledModalDialog>}
      {response && <ControlledModalDialog isOpen onOpenChange={open => { if (!open) setResponse(undefined); }} title={response.reference || "Enquiry response"} size="md">{response.status === "duplicate_candidate" && <Callout title="Duplicate review required" tone="warning">This response is preserved with {response.candidateCount} possible customer match{response.candidateCount === 1 ? "" : "es"}. Review it in Incoming enquiries.</Callout>}<div className={styles.responseAnswers}>{response.answers.map((answer, index) => <div key={index}><h4>{answer.title}</h4><p>{Array.isArray(answer.value) ? answer.value.join(", ") : String(answer.value ?? "Not provided")}</p></div>)}</div></ControlledModalDialog>}
    </>}
    {confirmationDialog}
  </section>;
}

export function validateDraft(draft: LeadFormRecord["draft"], publishing: boolean) {
  if (!draft.title.trim()) return "Enter a form title before saving.";
  for (const [index, question] of draft.questions.entries()) {
    const name = question.title.trim() || `Field ${index + 1}`;
    if (publishing && !question.title.trim()) return `Give field ${index + 1} a label before publishing.`;
    if (question.options.some(option => !option.label.trim())) return `${name}: enter a label for every option, or remove the empty option.`;
    if (publishing && ["radio", "dropdown", "checkboxes"].includes(question.type) && !question.options.length) return `${name}: add at least one answer choice${question.field && question.field !== "custom" ? " in Enquiries → Field options" : ""} before publishing.`;
  }
  return "";
}
