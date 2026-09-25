"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, Eye, FileText, Palette, Plus, QrCode, Search, Upload } from "lucide-react";
import { Badge, Button, Callout, ControlledModalDialog, DataGrid, IconButton, SelectField, Tabs, TextInput, useConfirmationDialog } from "@/design-system";
import type { LeadsPageData } from "@/lib/crm/leads";
import { type LeadFormRecord } from "@/lib/crm/lead-forms";
import { crmRequest } from "@/lib/crm/client";
import { PublicEnquiryFormView } from "./public-enquiry-form";
import { LeadFormEditor } from "./lead-form-editor";
import styles from "./lead-forms.module.css";

export type LeadFormBranding = { logoUrl: string | null; primaryColor: string | null; secondaryColor: string | null; workspaceName: string; canManage: boolean };

type FormResponse = { id: string; reference: string | null; leadId: string | null; name: string; status: string; receivedAt: string; answers: Array<{ title: string; value: unknown }>; consentStatus: string; candidateCount: number };

export function LeadFormBuilder({ initialData, initialBranding, onDirtyChange, onEditingChange }: { initialData: LeadsPageData; initialBranding?: LeadFormBranding; onDirtyChange?: (dirty: boolean) => void; onEditingChange?: (editing: boolean) => void }) {
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
  const [brandOpen, setBrandOpen] = useState(false);
  const [branding, setBranding] = useState(initialBranding);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [search, setSearch] = useState("");
  const logoInput = useRef<HTMLInputElement | null>(null);
  const [qr, setQr] = useState("");
  const [responses, setResponses] = useState<FormResponse[]>([]);
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
  const open = (form: LeadFormRecord) => { responseRequest.current?.abort(); setResponses([]); setResponseCursor(null); setResponse(undefined); setLoadingResponses(false); setPreview(false); setSharing(false); setBrandOpen(false); setQr(""); setRecord(form); setDraft(structuredClone(form.draft)); setTab("questions"); setError(""); setNotice(""); onEditingChange?.(true); };
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
      if (action === "publish") setSharing(true);
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
  const uploadLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !branding?.canManage || uploadingLogo) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError("Choose a PNG, JPEG, or WebP logo no larger than 5 MB."); return;
    }
    setUploadingLogo(true); setError("");
    try {
      const started = await fetch("/api/workspace/company-profile/logo-uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: initialData.workspaceId, filename: file.name, mimeType: file.type, byteSize: file.size }) });
      if (!started.ok) throw new Error("The logo upload could not be started.");
      const session = await started.json() as { assetId: string; uploadMode: string; uploadUrl?: string; uploadHeaders: Record<string, string> };
      const uploadUrl = session.uploadMode === "signed" && session.uploadUrl ? session.uploadUrl : `/api/workspace/company-profile/logo-uploads/${session.assetId}/content?workspaceId=${initialData.workspaceId}`;
      const uploaded = await fetch(uploadUrl, { method: "PUT", headers: session.uploadHeaders, body: file });
      if (!uploaded.ok) throw new Error("The logo could not be uploaded.");
      const completed = await fetch(`/api/workspace/company-profile/logo-uploads/${session.assetId}/complete?workspaceId=${initialData.workspaceId}`, { method: "POST" });
      if (!completed.ok) throw new Error("The logo could not be activated.");
      const result = await completed.json() as { logoUrl: string };
      setBranding(current => current ? { ...current, logoUrl: result.logoUrl } : current);
      setNotice("Brand logo updated for this workspace and its enquiry forms.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The logo could not be uploaded."); }
    finally { setUploadingLogo(false); }
  };
  const closeForm = () => { setRecord(undefined); setDraft(undefined); onEditingChange?.(false); };
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
      <div className={styles.formListToolbar}><label className={styles.formSearch}><Search size={17} aria-hidden="true" /><input aria-label="Search forms" placeholder="Search forms" value={search} onChange={event => setSearch(event.target.value)} /></label><Button variant="primary" size="compact" onPress={() => void create()} isLoading={busy}><Plus size={15} />New form</Button></div>
      {loading ? <p role="status">Loading forms…</p> : <div className={styles.formGallery} aria-label="Enquiry forms">
        {forms.filter(form => form.draft.title.toLowerCase().includes(search.trim().toLowerCase())).map(form => <button type="button" className={styles.formTile} key={form.id} onClick={() => open(form)} aria-label={`Edit form ${form.draft.title}`}>
          <span className={styles.formTilePreview}>{branding?.logoUrl && <Image src={branding.logoUrl} alt="" width={96} height={36} unoptimized />}<span>{form.draft.title}</span><i /><i /><i /></span>
          <span className={styles.formTileFooter}><FileText size={17} aria-hidden="true" /><span><strong>{form.draft.title}</strong><small>{form.status === "published" ? "Live · responses in Enquiries" : form.status === "paused" ? "Paused" : "Draft · publish to create enquiries"} · Updated {new Date(form.updatedAt).toLocaleDateString()}</small></span></span>
        </button>)}
        {!forms.length && <div className={styles.emptyForms}><FileText size={23} aria-hidden="true" /><p>Your first form starts with the required enquiry questions and sends submissions directly to Enquiries.</p><Button size="compact" variant="primary" onPress={() => void create()}>Create default enquiry form</Button></div>}
        {forms.length > 0 && !forms.some(form => form.draft.title.toLowerCase().includes(search.trim().toLowerCase())) && <p>No matching forms.</p>}
      </div>}
    </> : <>
      <header className={styles.toolbar}>
        <div className={styles.toolbarTitle}><IconButton aria-label="Back to forms" size="compact" isDisabled={busy} onPress={requestCloseForm}><ArrowLeft size={17} /></IconButton><span className={styles.editorName}>{draft.title}</span><Badge>{dirty ? "Unsaved" : record.status}</Badge></div>
        <div className={styles.actions}><Button size="compact" variant="quiet" onPress={() => setBrandOpen(value => !value)}><Palette size={16} />Brand</Button><Button size="compact" variant="quiet" onPress={() => setPreview(true)}><Eye size={16} />Preview form</Button>{record.status === "published" && <Button size="compact" onPress={() => setSharing(true)}><QrCode size={16} />Share form</Button>}<Button size="compact" isDisabled={!dirty || busy} onPress={() => void save()}>Save draft</Button><Button size="compact" variant="primary" isLoading={busy} onPress={() => void save("publish")}>{record.published ? "Publish changes" : "Publish"}</Button></div>
      </header>
      {brandOpen && <aside className={styles.brandPanel} aria-label="Form branding"><div className={styles.brandIdentity}>{branding?.logoUrl ? <Image src={branding.logoUrl} alt={`${branding.workspaceName} logo`} width={104} height={52} unoptimized /> : <span>{branding?.workspaceName ?? "Company"}</span>}<div><strong>Workspace brand</strong><small>This logo and your brand colours appear on all published enquiry forms.</small></div></div><input ref={logoInput} className={styles.visuallyHidden} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choose brand logo" onChange={event => void uploadLogo(event)} /><Button size="compact" isDisabled={!branding?.canManage || uploadingLogo} isLoading={uploadingLogo} onPress={() => logoInput.current?.click()}><Upload size={15} />{branding?.logoUrl ? "Replace logo" : "Upload logo"}</Button>{!branding?.canManage && <small>Ask a workspace administrator to update the brand logo.</small>}</aside>}
      <fieldset disabled={busy} className={styles.editorFieldset}><Tabs selectedKey={tab} onSelectionChange={key => { setTab(key); if (key === "responses") void loadResponses(); }} items={[
        { id: "questions", label: "Questions", panel: <LeadFormEditor key={record.id} draft={draft} setDraft={setDraft} busy={busy} /> },
        { id: "responses", label: `Responses${responses.length ? ` (${responses.length}${responseCursor ? "+" : ""})` : ""}`, panel: <div className={styles.responsesPanel}><div className={styles.responsesHeading}><p>Each submitted response is linked to an enquiry, or held for duplicate review.</p><Button size="compact" variant="quiet" isDisabled={loadingResponses} onPress={() => void loadResponses()}>Refresh</Button></div>{loadingResponses && <p role="status">Loading responses…</p>}<DataGrid ariaLabel="Form responses" data={responses} columns={[{ accessorKey: "reference", header: "Enquiry ID", size: 140, cell: ({ row }) => row.original.reference ?? "Pending review" }, { accessorKey: "name", header: "Customer", size: 240 }, { accessorKey: "status", header: "Status", size: 180, cell: ({ row }) => row.original.status === "duplicate_candidate" ? `Duplicate review · ${row.original.candidateCount}` : row.original.status.replaceAll("_", " ") }, { accessorKey: "receivedAt", header: "Received", size: 180, cell: ({ getValue }) => new Date(String(getValue())).toLocaleString() }]} getRowId={entry => entry.id} onRowAction={setResponse} pageSize={25} hasMoreRows={Boolean(responseCursor)} footerActions={responseCursor ? <Button size="compact" isLoading={loadingResponses} onPress={() => void loadResponses(responseCursor)}>Load more responses</Button> : undefined} emptyTitle={loadingResponses ? "Loading responses…" : "No responses yet"} emptyDescription="Responses from the published form appear here and in Enquiries." /></div> },
        { id: "settings", label: "Settings", panel: <div className={styles.settings}><h3>Enquiry destination</h3><p>Every submission creates an intake record and an enquiry. Routing rules assign it to the sales team; possible duplicates wait for review.</p><div className={styles.questionFields}><SelectField label="Source" items={options?.sources ?? []} selectedKey={draft.source} onSelectionChange={key => { const source = String(key); setDraft({ ...draft, source, channel: options?.channels[source]?.[0]?.id ?? "" }); }} /><SelectField label="Channel" items={options?.channels[draft.source] ?? []} selectedKey={draft.channel} onSelectionChange={key => setDraft({ ...draft, channel: String(key) })} /></div><p>These attribution settings are internal. Choosing a social channel records where you shared the link; it does not import social lead ads.</p>{record.status === "published" && <Button isDisabled={busy} onPress={() => void save("pause")}>Pause submissions</Button>}</div> },
      ]} /></fieldset>
      {preview && <ControlledModalDialog isOpen onOpenChange={setPreview} title="Form preview" size="lg"><PublicEnquiryFormView key={JSON.stringify(draft)} preview form={{ ...draft, areas: options?.areas, revision: "preview", consentLabel: "I agree to be contacted about this enquiry.", branding: branding ? { displayName: branding.workspaceName, logoUrl: branding.logoUrl, primaryColor: branding.primaryColor, secondaryColor: branding.secondaryColor, headingFont: null, bodyFont: null } : null }} /></ControlledModalDialog>}
      {sharing && <ControlledModalDialog isOpen onOpenChange={setSharing} title="Share enquiry form" size="md"><div className={styles.share}><TextInput label="Form link" value={url} isReadOnly /><Button onPress={() => { void navigator.clipboard.writeText(url).then(() => setNotice("Form link copied.")).catch(() => setError("Select and copy the form link manually.")); }}>Copy link</Button>{qr && <><Image unoptimized src={qr} alt="QR code for this enquiry form" width={240} height={240} /><a className={styles.download} href={qr} download="enquiry-form-qr.png">Download QR code</a></>}</div></ControlledModalDialog>}
      {response && <ControlledModalDialog isOpen onOpenChange={open => { if (!open) setResponse(undefined); }} title={response.reference || "Enquiry response"} size="md">{response.status === "duplicate_candidate" && <Callout title="Duplicate review required" tone="warning">This response is preserved with {response.candidateCount} possible customer match{response.candidateCount === 1 ? "" : "es"}. Review it in Incoming enquiries.</Callout>}<div className={styles.responseAnswers}>{response.answers.map((answer, index) => <div key={index}><h4>{answer.title}</h4><p>{Array.isArray(answer.value) ? answer.value.join(", ") : String(answer.value ?? "Not provided")}</p></div>)}</div>{response.leadId && <a className={styles.enquiryLink} href={`/workspace/crm/leads?lead=${response.leadId}`}>Open {response.reference ?? "enquiry"} in Enquiries</a>}</ControlledModalDialog>}
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
    if (publishing && ["radio", "dropdown", "checkboxes"].includes(question.type) && question.field !== "area" && !question.options.length) return `${name}: add at least one answer choice${question.field && question.field !== "custom" ? " in Enquiries → Field options" : ""} before publishing.`;
  }
  return "";
}
